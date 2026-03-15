# tenanso

Multi-tenant SQLite for TypeScript — database-per-tenant isolation using [Drizzle ORM](https://orm.drizzle.team/) and [Turso](https://turso.tech/).

Each tenant gets their own SQLite database managed by Turso. Your application code stays tenant-unaware — tenanso handles connection routing, tenant lifecycle, and framework integration.

Inspired by Rails 8's [activerecord-tenanted](https://github.com/basecamp/activerecord-tenanted).

## Features

- **Database-per-tenant isolation** — each tenant's data is physically separated, no `WHERE tenant_id = ?` needed
- **Runtime-agnostic** — core uses only `fetch` and `Map`, no `node:` imports. Works on Cloudflare Workers, Deno, Bun, and Node.js
- **Turso Platform API integration** — create and delete tenant databases dynamically
- **LRU connection pooling** — caps memory and file descriptor usage with configurable `maxConnections` (default 50)
- **Hono middleware** — optional peer dependency with first-class integration. `import "tenanso"` has zero Hono imports
- **Type-safe** — full TypeScript support with Drizzle's type inference

## Install

```bash
npm install tenanso drizzle-orm @libsql/client
# or
pnpm add tenanso drizzle-orm @libsql/client
# or
yarn add tenanso drizzle-orm @libsql/client
```

If using the Hono middleware:

```bash
npm install hono
```

## Quick Start

### 1. Define your Drizzle schema

```typescript
// db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});
```

### 2. Create a tenanso instance

```typescript
import { createTenanso } from "tenanso";
import * as schema from "./db/schema.js";

const tenanso = createTenanso({
  turso: {
    organizationSlug: "my-org",
    apiToken: process.env.TURSO_API_TOKEN!,
    group: "my-app",
  },
  databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
  authToken: process.env.TURSO_GROUP_AUTH_TOKEN!,
  schema,
  // New tenant databases are cloned from the seed database
  seed: { database: "seed-db" },
});
```

### 3. Use it

```typescript
// Create a tenant database
await tenanso.createTenant("acme-corp");

// Query a tenant's database
await tenanso.withTenant("acme-corp", async (db) => {
  await db.insert(users).values({ name: "Alice", email: "alice@acme.com" });
  const allUsers = await db.select().from(users);
});

// Or get a db instance directly
const db = tenanso.dbFor("acme-corp");
```

## Hono Integration

tenanso provides an optional Hono middleware that sets `c.var.db` and `c.var.tenant` for each request.

```typescript
import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { createTenanso } from "tenanso";
import { tenantMiddleware, type TenansoEnv } from "tenanso/hono";

const tenanso = createTenanso({ /* ... */ });
const app = new Hono<TenansoEnv>();

app.use(contextStorage());
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.req.header("x-tenant-id"),
}));

app.get("/api/users", async (c) => {
  const db = c.var.db;       // DrizzleDb — fully typed
  const tenant = c.var.tenant; // string
  const users = await db.select().from(usersTable);
  return c.json(users);
});
```

### Accessing the db outside handlers

With Hono's `contextStorage()` middleware enabled, you can access the tenant db from anywhere in the async call stack:

```typescript
import { getTenantDb, getTenantName } from "tenanso/hono";

async function getActiveUserCount(): Promise<number> {
  const db = getTenantDb();
  const result = await db.select().from(users);
  return result.length;
}
```

### Tenant resolution strategies

The `resolve` function determines which tenant a request belongs to. Here are common patterns:

```typescript
// From header
resolve: (c) => c.req.header("x-tenant-id")

// From URL path parameter (/t/:tenantId/*)
resolve: (c) => c.req.param("tenantId")

// From subdomain (acme.myapp.com → "acme")
resolve: (c) => {
  const url = new URL(c.req.url);
  return url.hostname.split(".")[0];
}

// From a verified JWT claim
resolve: (c) => {
  const payload = c.get("jwtPayload");
  return payload.tenant;
}
```

## Authentication

tenanso handles tenant resolution, not authentication. Auth is your application's responsibility, but how you wire them together matters for security.

**The tenant must come from a verified source.** Never trust a raw client header without authentication.

### Recommended: JWT with tenant claim

```typescript
import { jwt } from "hono/jwt";

// 1. Verify JWT first
app.use("/api/*", jwt({ secret: "your-secret", alg: "HS256" }));

// 2. Resolve tenant from the verified payload
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.get("jwtPayload").tenant,
}));
```

### External auth provider (Clerk, Auth0)

```typescript
app.use("/api/*", clerkMiddleware());
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.get("clerkAuth").tenantSlug,
}));
```

### API key

```typescript
app.use("/api/*", async (c, next) => {
  const key = c.req.header("Authorization")?.slice(7);
  const tenant = await lookupTenantByApiKey(key);
  if (!tenant) return c.json({ error: "Invalid API key" }, 401);
  c.set("resolvedTenant", tenant);
  await next();
});

app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.get("resolvedTenant"),
}));
```

## API Reference

### `createTenanso(config)`

Creates a tenanso instance.

```typescript
const tenanso = createTenanso({
  turso: {
    organizationSlug: string;   // Turso org slug
    apiToken: string;           // Turso Platform API token
    group: string;              // Database group (e.g. "my-app")
  },
  databaseUrl: string;          // URL template: "libsql://{tenant}-my-app-my-account.turso.io"
  authToken: string;            // Turso group auth token
  schema: Record<string, unknown>; // Drizzle schema
  seed?: { database: string };  // Clone new tenants from this database
  maxConnections?: number;      // Max cached connections (default: 50)
});
```

### `TenansoInstance`

| Method | Description |
|---|---|
| `dbFor(tenant)` | Returns a cached `DrizzleDb` instance for the tenant |
| `withTenant(tenant, fn)` | Runs a callback with the tenant's `DrizzleDb` |
| `createTenant(name)` | Creates a new database via Turso Platform API |
| `deleteTenant(name)` | Deletes a database via Turso Platform API |
| `listTenants()` | Lists all databases in the organization |
| `tenantExists(name)` | Checks if a tenant database exists |

### `tenantMiddleware(tenanso, options)` (from `tenanso/hono`)

Hono middleware that resolves the tenant from the request and sets `c.var.db` and `c.var.tenant`.

Returns `400` if `resolve` returns `undefined`.

### `getTenantDb()` / `getTenantName()` (from `tenanso/hono`)

Access the current tenant's db or name from outside Hono handlers. Requires Hono's `contextStorage()` middleware.

## Turso Setup

### Create a group

Use a [group](https://docs.turso.tech/features/groups) per application to organize databases:

```bash
turso group create my-app --location nrt
turso group tokens create my-app  # save as TURSO_GROUP_AUTH_TOKEN
```

### Create a seed database

New tenant databases are cloned from a seed database that has your schema already applied:

```bash
turso db create seed-db --group my-app
npx drizzle-kit push --url libsql://seed-db-my-app-my-account.turso.io --auth-token $TURSO_GROUP_AUTH_TOKEN
```

See the [Turso Setup guide](/guide/turso-setup) for more details.

## License

MIT
