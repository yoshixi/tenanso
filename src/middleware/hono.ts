import { createMiddleware } from "hono/factory";
import { getContext } from "hono/context-storage";
import type { TenansoInstance, DrizzleDb } from "../types.js";

/**
 * Hono environment type for tenanso middleware.
 *
 * Pass this as the generic to `new Hono<TenansoEnv>()` to get type-safe
 * access to `c.var.tenant` and `c.var.db` in your route handlers.
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import type { TenansoEnv } from "tenanso/hono";
 *
 * const app = new Hono<TenansoEnv>();
 *
 * app.get("/api/users", async (c) => {
 *   const db = c.var.db;       // DrizzleDb — fully typed
 *   const tenant = c.var.tenant; // string
 * });
 * ```
 */
export type TenansoEnv = {
  Variables: {
    /** Current tenant name, as resolved by {@link tenantMiddleware} */
    tenant: string;
    /** Drizzle db instance scoped to the current tenant */
    db: DrizzleDb;
  };
};

/**
 * Options for {@link tenantMiddleware}.
 */
export interface TenantMiddlewareOptions {
  /**
   * Resolve the tenant identifier from the request context.
   *
   * This function is called on every request. It should extract the tenant
   * identifier from a trusted source — typically a verified JWT claim,
   * an auth provider's organization ID, or an API key lookup.
   *
   * Return `undefined` to reject the request with a 400 response.
   *
   * **Security note:** Never trust raw client-supplied values without
   * authentication. The tenant should come from a verified source.
   *
   * @param c - A subset of the Hono context with request accessors.
   * @returns The tenant identifier, or `undefined` to reject.
   *
   * @example From a request header
   * ```typescript
   * resolve: (c) => c.req.header("x-tenant-id")
   * ```
   *
   * @example From a verified JWT payload (recommended)
   * ```typescript
   * resolve: (c) => {
   *   const payload = c.get("jwtPayload") as { tenant: string };
   *   return payload.tenant;
   * }
   * ```
   *
   * @example From a URL path parameter
   * ```typescript
   * // Route: /t/:tenantId/*
   * resolve: (c) => c.req.param("tenantId")
   * ```
   *
   * @example From a subdomain
   * ```typescript
   * resolve: (c) => {
   *   const url = new URL(c.req.url);
   *   const subdomain = url.hostname.split(".")[0];
   *   return subdomain === "www" ? undefined : subdomain;
   * }
   * ```
   *
   * @example Async resolution (e.g., API key lookup)
   * ```typescript
   * resolve: async (c) => {
   *   const apiKey = c.req.header("Authorization")?.slice(7);
   *   return apiKey ? await lookupTenantByApiKey(apiKey) : undefined;
   * }
   * ```
   */
  resolve: (c: {
    req: {
      header: (name: string) => string | undefined;
      param: (name: string) => string | undefined;
      url: string;
    };
    get: (key: string) => unknown;
  }) => string | undefined | Promise<string | undefined>;
}

/**
 * Hono middleware that resolves the tenant from each request and sets
 * `c.var.db` and `c.var.tenant`.
 *
 * This middleware:
 * 1. Calls `options.resolve(c)` to extract the tenant identifier from the request
 * 2. If `undefined`, responds with `400 { error: "Tenant not specified" }`
 * 3. Otherwise, gets a Drizzle db instance via `tenanso.dbFor(tenant)`
 * 4. Sets `c.var.tenant` and `c.var.db` for downstream handlers
 *
 * Combine with Hono's `contextStorage()` middleware to enable
 * {@link getTenantDb} and {@link getTenantName} outside of handlers.
 *
 * @param tenanso - The tenanso instance created by `createTenanso()`.
 * @param options - Middleware options. See {@link TenantMiddlewareOptions}.
 * @returns A Hono middleware function.
 *
 * @example Basic usage
 * ```typescript
 * import { Hono } from "hono";
 * import { contextStorage } from "hono/context-storage";
 * import { createTenanso } from "tenanso";
 * import { tenantMiddleware, type TenansoEnv } from "tenanso/hono";
 *
 * const tenanso = createTenanso({ ... });
 * const app = new Hono<TenansoEnv>();
 *
 * app.use(contextStorage());
 * app.use("/api/*", tenantMiddleware(tenanso, {
 *   resolve: (c) => c.req.header("x-tenant-id"),
 * }));
 *
 * app.get("/api/users", async (c) => {
 *   const users = await c.var.db.select().from(usersTable);
 *   return c.json(users);
 * });
 * ```
 *
 * @example Scoped to specific routes
 * ```typescript
 * const app = new Hono();
 *
 * // No tenant needed
 * app.get("/health", (c) => c.json({ status: "ok" }));
 *
 * // Tenant-scoped routes
 * const api = new Hono<TenansoEnv>();
 * api.use("*", tenantMiddleware(tenanso, {
 *   resolve: (c) => c.get("jwtPayload").tenant,
 * }));
 * api.get("/users", async (c) => {
 *   return c.json({ tenant: c.var.tenant });
 * });
 * app.route("/api", api);
 * ```
 */
export function tenantMiddleware(
  tenanso: TenansoInstance,
  options: TenantMiddlewareOptions
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

/**
 * Get the current tenant's Drizzle db from Hono's `contextStorage()`.
 *
 * This allows you to access the tenant-scoped database from anywhere
 * in the async call stack — not just inside Hono route handlers.
 * Requires Hono's `contextStorage()` middleware to be active.
 *
 * @returns The Drizzle database instance for the current tenant.
 * @throws If called outside of a request context or without `contextStorage()` middleware.
 *
 * @example
 * ```typescript
 * import { getTenantDb } from "tenanso/hono";
 *
 * // Can be called from any async function during request handling
 * async function getActiveUserCount(): Promise<number> {
 *   const db = getTenantDb();
 *   const users = await db.select().from(usersTable);
 *   return users.length;
 * }
 *
 * app.get("/api/stats", async (c) => {
 *   const count = await getActiveUserCount();
 *   return c.json({ activeUsers: count });
 * });
 * ```
 */
export function getTenantDb(): DrizzleDb {
  return getContext<TenansoEnv>().var.db;
}

/**
 * Get the current tenant name from Hono's `contextStorage()`.
 *
 * This allows you to access the current tenant identifier from anywhere
 * in the async call stack — not just inside Hono route handlers.
 * Requires Hono's `contextStorage()` middleware to be active.
 *
 * @returns The current tenant name as a string.
 * @throws If called outside of a request context or without `contextStorage()` middleware.
 *
 * @example
 * ```typescript
 * import { getTenantName } from "tenanso/hono";
 *
 * function logAction(action: string) {
 *   console.log(`[${getTenantName()}] ${action}`);
 * }
 * ```
 */
export function getTenantName(): string {
  return getContext<TenansoEnv>().var.tenant;
}
