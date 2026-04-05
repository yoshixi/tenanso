import type { drizzle } from "drizzle-orm/libsql";

/**
 * Drizzle ORM database instance type.
 *
 * This is the return type of `drizzle()` from `drizzle-orm/libsql`.
 * You can use this type to annotate variables or function parameters
 * that accept a Drizzle database instance.
 *
 * @example
 * ```typescript
 * import type { DrizzleDb } from "tenanso";
 *
 * async function getUsers(db: DrizzleDb) {
 *   return db.select().from(usersTable);
 * }
 * ```
 */
export type DrizzleDb = ReturnType<typeof drizzle>;

/**
 * Turso Platform API configuration.
 *
 * These credentials are used to manage tenant databases (create, delete, list)
 * via the [Turso Platform API](https://docs.turso.tech/api-reference/introduction).
 *
 * @example
 * ```typescript
 * const tursoConfig: TursoConfig = {
 *   organizationSlug: "my-org",
 *   apiToken: process.env.TURSO_API_TOKEN!,
 *   group: "my-app",
 * };
 * ```
 */
export interface TursoConfig {
  /**
   * Your Turso organization slug.
   *
   * Found in your Turso dashboard URL: `https://app.turso.tech/{organizationSlug}`
   */
  organizationSlug: string;
  /**
   * Turso Platform API token for managing databases.
   *
   * Generate one with:
   * ```bash
   * turso auth api-tokens mint tenanso
   * ```
   */
  apiToken: string;
  /**
   * Database group name. All tenant databases are created within this group.
   *
   * Use a group per application to organize databases — especially important
   * when your Turso account hosts multiple services.
   *
   * Create a group with:
   * ```bash
   * turso group create my-app --location nrt
   * ```
   */
  group: string;
  /**
   * Override the Turso Platform API base URL.
   *
   * Defaults to `https://api.turso.tech`. Useful for testing with a
   * mock server or for self-hosted Turso deployments.
   *
   * @defaultValue `"https://api.turso.tech"`
   */
  baseUrl?: string | undefined;
}

/**
 * Seed database configuration.
 *
 * When configured, new tenant databases are created by cloning an existing
 * "seed" database. This seed database should have your schema and any initial
 * data already applied, so new tenants are ready instantly without running migrations.
 *
 * To set up a seed database:
 * ```bash
 * turso db create seed-db --group my-app
 * npx drizzle-kit push --url libsql://seed-db-my-app-my-account.turso.io --auth-token $TURSO_GROUP_AUTH_TOKEN
 * ```
 *
 * @example
 * ```typescript
 * const tenanso = createTenanso({
 *   // ...
 *   seed: { database: "seed-db" },
 * });
 *
 * // New tenant is cloned from seed-db with schema ready
 * await tenanso.createTenant("acme");
 * ```
 */
export interface SeedConfig {
  /**
   * Name of an existing Turso database to clone when creating new tenants.
   *
   * This database should be in the same group as the tenant databases
   * and have the current schema applied.
   */
  database: string;
}

/**
 * Configuration for creating a tenanso instance.
 *
 * @example
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
 *   drizzleOptions: { casing: "snake_case" },
 * });
 * ```
 */
export interface TenansoConfig {
  /** Turso Platform API configuration. See {@link TursoConfig}. */
  turso: TursoConfig;
  /**
   * URL template with `{tenant}` placeholder.
   *
   * The `{tenant}` placeholder is replaced with the tenant name when creating connections.
   * Turso database URLs follow the pattern `libsql://{database-name}-{app}-{account}.turso.io`.
   *
   * @example
   * ```typescript
   * databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io"
   * // For tenant "acme" → "libsql://acme-my-app-my-account.turso.io"
   * ```
   */
  databaseUrl: string;
  /**
   * Turso group auth token.
   *
   * A single token that works for all databases in a group.
   * Generate one with:
   * ```bash
   * turso group tokens create my-app
   * ```
   */
  authToken: string;
  /**
   * Drizzle schema for type-safe queries.
   *
   * Pass your Drizzle table definitions so that the Drizzle instances
   * created for each tenant support relational queries.
   *
   * @example
   * ```typescript
   * import * as schema from "./db/schema.js";
   *
   * const tenanso = createTenanso({
   *   // ...
   *   schema,
   * });
   * ```
   */
  schema: Record<string, unknown>;
  /**
   * Seed database configuration.
   *
   * When set, {@link TenansoInstance.createTenant} clones the seed database
   * instead of creating an empty database. The seed database should have
   * your schema and any initial data already applied.
   *
   * See {@link SeedConfig} for setup instructions.
   */
  seed?: SeedConfig | undefined;
  /**
   * Maximum number of cached Drizzle connections.
   *
   * When this limit is reached, the least recently used connection is evicted.
   * Tune this based on your memory constraints and expected number of
   * concurrently active tenants.
   *
   * @defaultValue 50
   */
  maxConnections?: number | undefined;
  /**
   * Additional options passed to `drizzle()` when creating database instances.
   *
   * Use this to configure Drizzle ORM behavior such as column name casing.
   * The `schema` option is always set from {@link TenansoConfig.schema} and
   * cannot be overridden here.
   *
   * @example
   * ```typescript
   * const tenanso = createTenanso({
   *   // ...
   *   drizzleOptions: { casing: "snake_case" },
   * });
   * ```
   */
  drizzleOptions?: Record<string, unknown> | undefined;
}

/**
 * The main tenanso instance returned by {@link createTenanso}.
 *
 * Provides methods for tenant lifecycle management (create, delete, list)
 * and tenant-scoped database access (dbFor, withTenant).
 *
 * @example
 * ```typescript
 * const tenanso = createTenanso({ ... });
 *
 * // Lifecycle
 * await tenanso.createTenant("acme");
 * const tenants = await tenanso.listTenants();
 *
 * // Database access
 * const db = tenanso.dbFor("acme");
 * await tenanso.withTenant("acme", async (db) => {
 *   const users = await db.select().from(usersTable);
 * });
 * ```
 */
export interface TenansoInstance {
  /**
   * Create a new tenant database via Turso Platform API.
   *
   * If {@link TenansoConfig.seed} is configured, the new database is cloned
   * from the seed database with the schema already applied.
   * Otherwise, an empty database is created and you must apply migrations separately.
   *
   * @param name - Unique tenant identifier, used as the Turso database name.
   *   Must be valid as a Turso database name (lowercase alphanumeric and hyphens).
   * @throws Error if the Turso API call fails (e.g., database already exists, quota exceeded).
   *
   * @example
   * ```typescript
   * // During user signup
   * await tenanso.createTenant("acme-corp");
   *
   * // Seed initial data
   * await tenanso.withTenant("acme-corp", async (db) => {
   *   await db.insert(usersTable).values({ name: "Admin", email: "admin@acme.com" });
   * });
   * ```
   */
  createTenant(name: string): Promise<void>;

  /**
   * Delete a tenant database via Turso Platform API and remove it from the connection pool.
   *
   * This permanently destroys the database and all its data. The cached
   * connection is also removed from the pool.
   *
   * @param name - Tenant identifier to delete.
   * @throws Error if the Turso API call fails (e.g., database not found).
   *
   * @example
   * ```typescript
   * await tenanso.deleteTenant("acme-corp");
   * ```
   */
  deleteTenant(name: string): Promise<void>;

  /**
   * List all tenant database names via Turso Platform API.
   *
   * Returns the names of databases in the configured Turso organization
   * that belong to the configured group.
   *
   * This calls the Turso Platform API, so it has network latency (~100-200ms).
   * For per-request tenant validation, consider caching the result or using
   * a JWT-based approach where the tenant is embedded in the token.
   *
   * @returns Array of database names.
   *
   * @example
   * ```typescript
   * const tenants = await tenanso.listTenants();
   * // ["acme-corp", "other-corp", "startup-inc"]
   *
   * // Iterate over all tenants
   * for (const tenant of tenants) {
   *   await tenanso.withTenant(tenant, async (db) => {
   *     // Run migrations, aggregate stats, etc.
   *   });
   * }
   * ```
   */
  listTenants(): Promise<string[]>;

  /**
   * Check if a tenant database exists.
   *
   * Calls {@link listTenants} under the hood, so it has the same
   * network latency considerations.
   *
   * @param name - Tenant identifier to check.
   * @returns `true` if the database exists, `false` otherwise.
   *
   * @example
   * ```typescript
   * if (await tenanso.tenantExists("acme-corp")) {
   *   // Tenant exists
   * }
   * ```
   */
  tenantExists(name: string): Promise<boolean>;

  /**
   * Get a cached Drizzle db instance for a specific tenant.
   *
   * Returns an existing cached connection or creates a new one.
   * The connection is cached in an LRU pool — the least recently used
   * connection is evicted when {@link TenansoConfig.maxConnections} is reached.
   *
   * @param tenant - Tenant identifier.
   * @returns A Drizzle database instance connected to the tenant's database.
   *
   * @example
   * ```typescript
   * const db = tenanso.dbFor("acme-corp");
   * const users = await db.select().from(usersTable);
   *
   * // In a Hono handler (without middleware)
   * app.get("/api/users", async (c) => {
   *   const tenantId = c.get("jwtPayload").tenant;
   *   const db = tenanso.dbFor(tenantId);
   *   return c.json(await db.select().from(usersTable));
   * });
   * ```
   */
  dbFor(tenant: string): DrizzleDb;

  /**
   * Run a callback with a tenant-scoped Drizzle db instance.
   *
   * A convenience wrapper around {@link dbFor} that passes the db
   * instance to a callback. Useful when you want to scope a block of
   * operations to a specific tenant.
   *
   * @param tenant - Tenant identifier.
   * @param fn - Async callback receiving the tenant's Drizzle db instance.
   * @returns The return value of the callback.
   *
   * @example
   * ```typescript
   * // Signup flow: create tenant and seed data
   * await tenanso.createTenant("acme-corp");
   * await tenanso.withTenant("acme-corp", async (db) => {
   *   await db.insert(usersTable).values({
   *     name: "Admin",
   *     email: "admin@acme.com",
   *     role: "admin",
   *   });
   * });
   *
   * // Cross-tenant aggregation
   * const stats = await tenanso.withTenant("acme-corp", async (db) => {
   *   const users = await db.select().from(usersTable);
   *   return { userCount: users.length };
   * });
   * ```
   */
  withTenant<T>(tenant: string, fn: (db: DrizzleDb) => Promise<T>): Promise<T>;
}
