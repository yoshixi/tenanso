import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { tenantMiddleware, type TenansoEnv } from "../middleware/hono.js";
import type { TenansoInstance, DrizzleDb } from "../types.js";

function createMockTenanso(): TenansoInstance {
  const dbs = new Map<string, DrizzleDb>();

  return {
    dbFor(tenant: string): DrizzleDb {
      let db = dbs.get(tenant);
      if (!db) {
        db = { _tenant: tenant, _isDrizzle: true } as unknown as DrizzleDb;
        dbs.set(tenant, db);
      }
      return db;
    },
    async withTenant<T>(
      tenant: string,
      fn: (db: DrizzleDb) => Promise<T>
    ): Promise<T> {
      return fn(this.dbFor(tenant));
    },
    async createTenant() {},
    async deleteTenant() {},
    async listTenants() {
      return [];
    },
    async tenantExists() {
      return false;
    },
  };
}

describe("tenantMiddleware", () => {
  let tenanso: TenansoInstance;

  beforeEach(() => {
    tenanso = createMockTenanso();
  });

  it("sets tenant and db on context from header", async () => {
    const app = new Hono<TenansoEnv>();

    app.use(
      "*",
      tenantMiddleware(tenanso, {
        resolve: (c) => c.req.header("x-tenant-id"),
      })
    );

    app.get("/test", (c) => {
      return c.json({
        tenant: c.var.tenant,
        hasDb: c.var.db !== undefined,
      });
    });

    const res = await app.request("/test", {
      headers: { "x-tenant-id": "acme" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tenant: "acme", hasDb: true });
  });

  it("returns 400 when tenant is not specified", async () => {
    const app = new Hono<TenansoEnv>();

    app.use(
      "*",
      tenantMiddleware(tenanso, {
        resolve: (c) => c.req.header("x-tenant-id"),
      })
    );

    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: "Tenant not specified" });
  });

  it("supports async resolve", async () => {
    const app = new Hono<TenansoEnv>();

    app.use(
      "*",
      tenantMiddleware(tenanso, {
        resolve: async (c) => {
          // Simulate async lookup
          return c.req.header("x-tenant-id");
        },
      })
    );

    app.get("/test", (c) => c.json({ tenant: c.var.tenant }));

    const res = await app.request("/test", {
      headers: { "x-tenant-id": "async-tenant" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ tenant: "async-tenant" });
  });

  it("scopes middleware to specific routes", async () => {
    const app = new Hono();

    // Health check — no tenant
    app.get("/health", (c) => c.json({ status: "ok" }));

    // Tenant-scoped routes
    const api = new Hono<TenansoEnv>();
    api.use(
      "*",
      tenantMiddleware(tenanso, {
        resolve: (c) => c.req.header("x-tenant-id"),
      })
    );
    api.get("/users", (c) => c.json({ tenant: c.var.tenant }));

    app.route("/api", api);

    // Health check works without tenant
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);

    // API requires tenant
    const apiRes = await app.request("/api/users");
    expect(apiRes.status).toBe(400);

    // API works with tenant
    const apiResOk = await app.request("/api/users", {
      headers: { "x-tenant-id": "acme" },
    });
    expect(apiResOk.status).toBe(200);
    expect(await apiResOk.json()).toEqual({ tenant: "acme" });
  });

  it("resolves tenant from JWT payload via c.get", async () => {
    type AppEnv = {
      Variables: {
        jwtPayload: { tenant: string };
        tenant: string;
        db: DrizzleDb;
      };
    };

    const app = new Hono<AppEnv>();

    // Simulate JWT middleware
    app.use("*", async (c, next) => {
      c.set("jwtPayload", { tenant: "jwt-tenant" });
      await next();
    });

    app.use(
      "*",
      tenantMiddleware(tenanso, {
        resolve: (c) => {
          const payload = c.get("jwtPayload") as
            | { tenant: string }
            | undefined;
          return payload?.tenant;
        },
      })
    );

    app.get("/test", (c) => c.json({ tenant: c.var.tenant }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenant: "jwt-tenant" });
  });
});
