/**
 * Simulation: tenanso + Hono integration (runtime-agnostic)
 *
 * tenanso core has ZERO Node.js dependencies.
 * Context propagation is handled by Hono's built-in contextStorage()
 * which works on Cloudflare Workers, Deno, Bun, and Node.js.
 */

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { contextStorage, getContext } from "hono/context-storage";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

// ============================================================
// 1. tenanso core — NO runtime-specific imports
// ============================================================

// --- Types ---
interface TenansoConfig {
  turso: {
    organizationSlug: string;
    apiToken: string;
    group: string;
  };
  databaseUrl: string; // "libsql://{tenant}-my-app-my-account.turso.io"
  authToken: string;
  schema: Record<string, unknown>;
}

type DrizzleDb = ReturnType<typeof drizzle>;

// --- Errors ---
class TenantNotFoundError extends Error {
  constructor(tenant: string) {
    super(`Tenant "${tenant}" does not exist.`);
    this.name = "TenantNotFoundError";
  }
}

// --- Connection Pool (runtime-agnostic, just a Map) ---
class ConnectionPool {
  private cache = new Map<string, DrizzleDb>();
  private config: TenansoConfig;

  constructor(config: TenansoConfig) {
    this.config = config;
  }

  getDb(tenant: string): DrizzleDb {
    let db = this.cache.get(tenant);
    if (!db) {
      const url = this.config.databaseUrl.replace("{tenant}", tenant);
      const client = createClient({
        url,
        authToken: this.config.authToken,
      });
      db = drizzle(client, { schema: this.config.schema });
      this.cache.set(tenant, db);
    }
    return db;
  }

  remove(tenant: string): void {
    this.cache.delete(tenant);
  }
}

// --- Turso Platform API client (uses fetch — works everywhere) ---
class TursoApi {
  private baseUrl: string;
  private apiToken: string;
  private group: string;
  constructor(config: TenansoConfig) {
    this.baseUrl = `https://api.turso.tech/v1/organizations/${config.turso.organizationSlug}`;
    this.apiToken = config.turso.apiToken;
    this.group = config.turso.group;
  }

  async createDatabase(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/databases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, group: this.group }),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to create database "${name}": ${res.status} ${await res.text()}`
      );
    }
  }

  async deleteDatabase(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/databases/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to delete database "${name}": ${res.status} ${await res.text()}`
      );
    }
  }

  async listDatabases(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/databases`, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to list databases: ${res.status}`);
    }
    const data = (await res.json()) as {
      databases: Array<{ Name: string }>;
    };
    return data.databases.map((db) => db.Name);
  }
}

// --- Tenanso Instance ---
interface TenansoInstance {
  // Tenant lifecycle (Turso Platform API — uses fetch)
  createTenant(name: string): Promise<void>;
  deleteTenant(name: string): Promise<void>;
  listTenants(): Promise<string[]>;
  tenantExists(name: string): Promise<boolean>;

  // Get a db for a specific tenant (explicit — no implicit context)
  dbFor(tenant: string): DrizzleDb;

  // Run a callback with a tenant-scoped db (explicit passing)
  withTenant<T>(tenant: string, fn: (db: DrizzleDb) => Promise<T>): Promise<T>;
}

function createTenanso(config: TenansoConfig): TenansoInstance {
  const pool = new ConnectionPool(config);
  const api = new TursoApi(config);

  return {
    async createTenant(name: string) {
      await api.createDatabase(name);
    },

    async deleteTenant(name: string) {
      await api.deleteDatabase(name);
      pool.remove(name);
    },

    async listTenants() {
      return api.listDatabases();
    },

    async tenantExists(name: string) {
      const tenants = await this.listTenants();
      return tenants.includes(name);
    },

    dbFor(tenant: string): DrizzleDb {
      return pool.getDb(tenant);
    },

    async withTenant<T>(
      tenant: string,
      fn: (db: DrizzleDb) => Promise<T>
    ): Promise<T> {
      const db = pool.getDb(tenant);
      return fn(db);
    },
  };
}

// ============================================================
// 2. tenanso/hono — Hono middleware adapter
//    Uses Hono's contextStorage() for implicit context.
//    contextStorage() uses AsyncLocalStorage internally but
//    is managed by Hono — works on CF Workers, Deno, Bun, Node.
// ============================================================

// Hono Env type that tenanso/hono exports for users
type TenansoEnv = {
  Variables: {
    tenant: string;
    db: DrizzleDb;
  };
};

// Middleware factory
function tenantMiddleware(
  tenanso: TenansoInstance,
  options: {
    resolve: (c: {
      req: {
        header: (name: string) => string | undefined;
        param: (name: string) => string | undefined;
        url: string;
      };
    }) => string | undefined | Promise<string | undefined>;
  }
) {
  return createMiddleware<TenansoEnv>(async (c, next) => {
    const tenantName = await options.resolve(c);
    if (!tenantName) {
      return c.json({ error: "Tenant not specified" }, 400);
    }

    const db = tenanso.dbFor(tenantName);
    c.set("tenant", tenantName);
    c.set("db", db);
    await next();
  });
}

// Helper to get tenant db from Hono context outside of handlers
// (requires contextStorage() middleware to be enabled)
function getTenantDb(): DrizzleDb {
  return getContext<TenansoEnv>().var.db;
}

function getTenantName(): string {
  return getContext<TenansoEnv>().var.tenant;
}

// ============================================================
// 3. Example App — Hono-native approach
// ============================================================

function exampleApp() {
  const tenanso = createTenanso({
    turso: {
      organizationSlug: "my-org",
      apiToken: "token",
      group: "default",
    },
    databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
    authToken: "group-token",
    schema: {},
  });

  const app = new Hono<TenansoEnv>();

  // Enable Hono's contextStorage — allows getContext() outside handlers
  // Works on CF Workers (with nodejs_compat), Deno, Bun, Node.js
  app.use(contextStorage());

  // Resolve tenant from request header
  app.use(
    "/api/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => c.req.header("x-tenant-id"),
    })
  );

  // --- Route handlers: access db via c.var.db (type-safe) ---

  app.get("/api/users", async (c) => {
    const db = c.var.db; // DrizzleDb — fully typed
    const tenant = c.var.tenant;
    // const users = await db.select().from(usersTable);
    return c.json({ tenant, message: "queried tenant db" });
  });

  // --- Utility function outside handler: uses getContext() ---

  async function getActiveUserCount(): Promise<number> {
    const db = getTenantDb(); // works via Hono's contextStorage
    // return (await db.select().from(usersTable)).length;
    return 42;
  }

  app.get("/api/stats", async (c) => {
    const count = await getActiveUserCount();
    return c.json({ activeUsers: count, tenant: c.var.tenant });
  });

  // --- Non-tenant routes (no middleware, no db) ---

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

// ============================================================
// 4. Example: Signup flow — tenant creation
// ============================================================

function exampleSignupFlow() {
  const tenanso = createTenanso({
    turso: {
      organizationSlug: "my-org",
      apiToken: "token",
      group: "default",
    },
    databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
    authToken: "group-token",
    schema: {},
  });

  const app = new Hono();

  // Public route — no tenant context needed
  app.post("/signup", async (c) => {
    const { tenantSlug, email, name } = await c.req.json();

    // 1. Create tenant database via Turso Platform API (uses fetch)
    await tenanso.createTenant(tenantSlug);

    // 2. Seed initial data — explicit db passing, no ALS needed
    await tenanso.withTenant(tenantSlug, async (db) => {
      // await db.insert(usersTable).values({ email, name, role: "admin" });
      console.log(`Created admin user ${email} in tenant ${tenantSlug}`);
    });

    return c.json({ success: true, tenant: tenantSlug }, 201);
  });

  return app;
}

// ============================================================
// 5. Example: Subdomain-based tenant resolution
// ============================================================

function exampleSubdomainRouting() {
  const tenanso = createTenanso({
    turso: {
      organizationSlug: "my-org",
      apiToken: "token",
      group: "default",
    },
    databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
    authToken: "group-token",
    schema: {},
  });

  const app = new Hono<TenansoEnv>();

  app.use(contextStorage());
  app.use(
    "*",
    tenantMiddleware(tenanso, {
      // Extract tenant from subdomain: acme.myapp.com → "acme"
      resolve: (c) => {
        const url = new URL(c.req.url);
        const subdomain = url.hostname.split(".")[0];
        return subdomain === "www" ? undefined : subdomain;
      },
    })
  );

  app.get("/dashboard", async (c) => {
    return c.json({ tenant: c.var.tenant });
  });

  return app;
}

// ============================================================
// 6. Example: Route param-based tenant resolution
// ============================================================

function exampleRouteParamTenant() {
  const tenanso = createTenanso({
    turso: {
      organizationSlug: "my-org",
      apiToken: "token",
      group: "default",
    },
    databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
    authToken: "group-token",
    schema: {},
  });

  const app = new Hono<TenansoEnv>();

  app.use(contextStorage());

  // Tenant from route param: /t/:tenantId/users
  app.use(
    "/t/:tenantId/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => c.req.param("tenantId"),
    })
  );

  app.get("/t/:tenantId/users", async (c) => {
    return c.json({ tenant: c.var.tenant });
  });

  return app;
}

export {
  // Core (runtime-agnostic)
  createTenanso,
  type TenansoInstance,
  type TenansoConfig,
  type DrizzleDb,
  TenantNotFoundError,

  // Hono adapter
  tenantMiddleware,
  getTenantDb,
  getTenantName,
  type TenansoEnv,

  // Examples
  exampleApp,
  exampleSignupFlow,
  exampleSubdomainRouting,
  exampleRouteParamTenant,
};
