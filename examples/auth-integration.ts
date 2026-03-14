/**
 * Simulation: How authentication feeds into tenant resolution
 *
 * tenanso does NOT implement auth. But the composition pattern matters
 * because getting it wrong = tenant impersonation vulnerability.
 *
 * The key principle:
 *   Auth verifies WHO the user is → tenant is derived from the verified identity.
 *   Never trust a raw "x-tenant-id" header from the client.
 */

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { contextStorage } from "hono/context-storage";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/libsql";

// Simulated tenanso imports (from core example)
type DrizzleDb = ReturnType<typeof drizzle>;

interface TenansoInstance {
  dbFor(tenant: string): DrizzleDb;
  createTenant(name: string): Promise<void>;
  withTenant<T>(tenant: string, fn: (db: DrizzleDb) => Promise<T>): Promise<T>;
}

declare function createTenanso(config: unknown): TenansoInstance;
declare function tenantMiddleware(
  tenanso: TenansoInstance,
  options: { resolve: (c: any) => string | undefined | Promise<string | undefined> }
): any;

// ============================================================
// Pattern 1: JWT with tenant claim (RECOMMENDED)
//
// The JWT itself contains the tenant. Since the JWT is signed
// by your auth provider, the tenant can't be spoofed.
//
// JWT payload: { sub: "user_123", tenant: "acme-corp", ... }
// ============================================================

function pattern1_JwtWithTenantClaim() {
  type JwtPayload = {
    sub: string;
    tenant: string;
    role: string;
  };

  type AppEnv = {
    Variables: {
      jwtPayload: JwtPayload;
      tenant: string;
      db: DrizzleDb;
    };
  };

  const app = new Hono<AppEnv>();
  const tenanso = createTenanso({/* ... */});

  app.use(contextStorage());

  // 1. Auth middleware verifies the JWT (runs first)
  app.use(
    "/api/*",
    jwt({ secret: "your-secret", alg: "HS256" })
  );

  // 2. Tenant middleware derives tenant from VERIFIED JWT payload
  app.use(
    "/api/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => {
        const payload = c.get("jwtPayload") as JwtPayload;
        return payload.tenant; // trusted — came from signed JWT
      },
    })
  );

  // 3. Handlers are both auth-aware and tenant-aware
  app.get("/api/users", async (c) => {
    const db = c.var.db;
    const user = c.var.jwtPayload;
    // db is scoped to user's tenant — no way to access another tenant's data
    return c.json({ tenant: c.var.tenant, userId: user.sub });
  });

  return app;
}

// ============================================================
// Pattern 2: Clerk / Auth.js / external auth provider
//
// Auth provider middleware sets the user. You look up the
// user's tenant from a mapping (e.g., central DB or the
// provider's metadata).
// ============================================================

function pattern2_ClerkAuth() {
  // Simulate Clerk-like middleware that sets auth context
  type ClerkAuth = {
    userId: string;
    orgId: string;       // Clerk organizations = tenants
    tenantSlug: string;
  };

  const clerkMiddleware = createMiddleware<{
    Variables: { clerkAuth: ClerkAuth };
  }>(async (c, next) => {
    // In reality, this verifies the session token with Clerk's API
    const auth: ClerkAuth = {
      userId: "user_123",
      orgId: "org_abc",
      tenantSlug: "acme-corp",
    };
    c.set("clerkAuth", auth);
    await next();
  });

  type AppEnv = {
    Variables: {
      clerkAuth: ClerkAuth;
      tenant: string;
      db: DrizzleDb;
    };
  };

  const app = new Hono<AppEnv>();
  const tenanso = createTenanso({/* ... */});

  app.use(contextStorage());

  // 1. Clerk verifies the session
  app.use("/api/*", clerkMiddleware);

  // 2. Tenant = Clerk organization slug (verified by Clerk)
  app.use(
    "/api/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => {
        const auth = c.get("clerkAuth") as ClerkAuth;
        return auth.tenantSlug; // trusted — verified by Clerk
      },
    })
  );

  app.get("/api/projects", async (c) => {
    return c.json({ tenant: c.var.tenant });
  });

  return app;
}

// ============================================================
// Pattern 3: API key → tenant lookup
//
// For B2B APIs where each customer has an API key.
// The key is verified and mapped to a tenant.
// ============================================================

function pattern3_ApiKey() {
  // Simulated API key → tenant lookup
  async function lookupTenantByApiKey(
    apiKey: string
  ): Promise<string | undefined> {
    // In reality: query your central DB or cache
    const keyMap: Record<string, string> = {
      "sk_live_abc123": "acme-corp",
      "sk_live_def456": "other-corp",
    };
    return keyMap[apiKey];
  }

  type AppEnv = {
    Variables: {
      tenant: string;
      db: DrizzleDb;
      apiKey: string;
    };
  };

  const app = new Hono<AppEnv>();
  const tenanso = createTenanso({/* ... */});

  app.use(contextStorage());

  // Combined auth + tenant resolution in one step
  // (API key simultaneously authenticates AND identifies the tenant)
  app.use("/api/*", createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing API key" }, 401);
    }

    const apiKey = authHeader.slice(7);
    const tenant = await lookupTenantByApiKey(apiKey);
    if (!tenant) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    const db = tenanso.dbFor(tenant);
    c.set("apiKey", apiKey);
    c.set("tenant", tenant);
    c.set("db", db);
    await next();
  }));

  app.get("/api/data", async (c) => {
    return c.json({ tenant: c.var.tenant });
  });

  return app;
}

// ============================================================
// Pattern 4: Signup flow — creating tenant + first user
//
// This is the only place where tenant creation and auth
// registration happen together.
// ============================================================

function pattern4_Signup() {
  const app = new Hono();
  const tenanso = createTenanso({/* ... */});

  // No auth middleware — this is the registration endpoint
  app.post("/signup", async (c) => {
    const { orgName, email, password } = await c.req.json();
    const tenantSlug = orgName.toLowerCase().replace(/\s+/g, "-");

    // 1. Create tenant database
    await tenanso.createTenant(tenantSlug);

    // 2. Create first user in tenant DB
    await tenanso.withTenant(tenantSlug, async (db) => {
      // await db.insert(users).values({
      //   email,
      //   passwordHash: await hash(password),
      //   role: "admin",
      // });
    });

    // 3. Generate JWT with tenant claim
    //    (or create session in your auth provider with org metadata)
    // const token = await sign({ sub: newUserId, tenant: tenantSlug }, secret);

    return c.json({ tenant: tenantSlug }, 201);
  });

  return app;
}

// ============================================================
// ANTI-PATTERNS — what NOT to do
// ============================================================

function antiPattern_TrustClientHeader() {
  const app = new Hono();
  const tenanso = createTenanso({/* ... */});

  // BAD: trusting a raw header from the client without auth verification.
  // Any user can set x-tenant-id to any value and access other tenants' data.
  app.use(
    "/api/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => c.req.header("x-tenant-id"), // INSECURE
    })
  );

  return app;
}

function antiPattern_SubdomainWithoutAuth() {
  const app = new Hono();
  const tenanso = createTenanso({/* ... */});

  // BAD: subdomain alone is not authentication.
  // Anyone can visit acme.yourapp.com.
  // You still need auth to verify the user belongs to that tenant.
  app.use(
    "*",
    tenantMiddleware(tenanso, {
      resolve: (c) => {
        const url = new URL(c.req.url);
        return url.hostname.split(".")[0]; // NOT ENOUGH
      },
    })
  );

  // GOOD: subdomain for tenant resolution + auth to verify membership
  // app.use("*", authMiddleware());
  // app.use("*", tenantMiddleware(tenanso, {
  //   resolve: (c) => {
  //     const subdomain = new URL(c.req.url).hostname.split(".")[0];
  //     const user = c.get("user");
  //     if (!user.tenants.includes(subdomain)) throw new ForbiddenError();
  //     return subdomain;
  //   },
  // }));

  return app;
}

export {
  pattern1_JwtWithTenantClaim,
  pattern2_ClerkAuth,
  pattern3_ApiKey,
  pattern4_Signup,
  antiPattern_TrustClientHeader,
  antiPattern_SubdomainWithoutAuth,
};
