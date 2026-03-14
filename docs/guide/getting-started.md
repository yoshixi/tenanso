# Getting Started

## Installation

```bash
pnpm add tenanso drizzle-orm @libsql/client
```

If you're using the Hono middleware:

```bash
pnpm add hono
```

## Define Your Schema

Create a standard Drizzle schema. No tenant-specific columns needed.

```typescript
// db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});
```

## Create a tenanso Instance

```typescript
import { createTenanso } from "tenanso";
import * as schema from "./db/schema.js";

const tenanso = createTenanso({
  turso: {
    organizationSlug: "my-org",
    apiToken: process.env.TURSO_API_TOKEN!,
    group: "my-app",
  },
  // {tenant} is replaced with the tenant name
  databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
  // Group auth token works for all databases in the group
  authToken: process.env.TURSO_GROUP_AUTH_TOKEN!,
  schema,
  // New tenants are cloned from the seed database (schema + seed data)
  seed: { database: "seed-db" },
});
```

## Use It

### Create a tenant

```typescript
await tenanso.createTenant("acme-corp");
```

### Query a tenant's database

```typescript
// Option 1: withTenant callback
await tenanso.withTenant("acme-corp", async (db) => {
  await db.insert(users).values({ name: "Alice", email: "alice@acme.com" });
  const allUsers = await db.select().from(users);
  console.log(allUsers);
});

// Option 2: get db directly
const db = tenanso.dbFor("acme-corp");
const allUsers = await db.select().from(users);
```

## Next Steps

- [Hono Integration](/guide/hono) — Set up the tenant middleware
- [Tenant Lifecycle](/guide/tenant-lifecycle) — Create, delete, and list tenants
- [Turso Setup](/guide/turso-setup) — Configure Turso groups and auth tokens
