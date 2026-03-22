import { ConnectionPool } from "./connection-pool.js";
import { TursoApi } from "./turso-api.js";
import type { TenansoConfig, TenansoInstance, DrizzleDb } from "./types.js";

/**
 * Create a tenanso instance for multi-tenant database management.
 *
 * This is the main entry point for the library. It returns a {@link TenansoInstance}
 * that provides tenant lifecycle management and tenant-scoped database access.
 *
 * Internally, it creates:
 * - A {@link ConnectionPool} that caches Drizzle instances per tenant with LRU eviction
 * - A Turso Platform API client for creating, deleting, and listing tenant databases
 *
 * @param config - Configuration options. See {@link TenansoConfig}.
 * @returns A {@link TenansoInstance} for managing tenants and accessing their databases.
 *
 * @example Basic setup
 * ```typescript
 * import { createTenanso } from "tenanso";
 * import * as schema from "./db/schema.js";
 *
 * const tenanso = createTenanso({
 *   turso: {
 *     organizationSlug: "my-org",
 *     apiToken: process.env.TURSO_API_TOKEN!,
 *     group: "my-app",
 *   },
 *   databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
 *   authToken: process.env.TURSO_GROUP_AUTH_TOKEN!,
 *   schema,
 *   seed: { database: "seed-db" },
 * });
 * ```
 *
 * @example Tenant lifecycle
 * ```typescript
 * // Create a tenant (cloned from seed-db)
 * await tenanso.createTenant("acme");
 *
 * // Query tenant's database
 * await tenanso.withTenant("acme", async (db) => {
 *   const users = await db.select().from(usersTable);
 * });
 *
 * // Or get the db directly
 * const db = tenanso.dbFor("acme");
 * ```
 *
 * @example With Hono middleware
 * ```typescript
 * import { tenantMiddleware, type TenansoEnv } from "tenanso/hono";
 *
 * const app = new Hono<TenansoEnv>();
 * app.use("/api/*", tenantMiddleware(tenanso, {
 *   resolve: (c) => c.get("jwtPayload").tenant,
 * }));
 *
 * app.get("/api/users", async (c) => {
 *   const users = await c.var.db.select().from(usersTable);
 *   return c.json(users);
 * });
 * ```
 */
export function createTenanso(config: TenansoConfig): TenansoInstance {
  if (!config.databaseUrl.includes("{tenant}")) {
    throw new Error(
      `databaseUrl must contain a {tenant} placeholder. Got: "${config.databaseUrl}"`
    );
  }

  const pool = new ConnectionPool(config);
  const api = new TursoApi(config.turso, config.seed, config.waitForReady ?? true, config.authToken);

  return {
    async createTenant(name: string): Promise<void> {
      await api.createDatabase(name);
    },

    async deleteTenant(name: string): Promise<void> {
      await api.deleteDatabase(name);
      pool.remove(name);
    },

    async listTenants(): Promise<string[]> {
      return api.listDatabases();
    },

    async tenantExists(name: string): Promise<boolean> {
      return api.databaseExists(name);
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
