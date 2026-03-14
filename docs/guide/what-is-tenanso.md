# What is tenanso?

tenanso is a TypeScript library that provides **database-per-tenant** multi-tenancy using [Drizzle ORM](https://orm.drizzle.team/) and [Turso](https://turso.tech/).

## The Problem

In a multi-tenant application, you need to isolate each tenant's data. There are two common approaches:

### Commingled Data (single database)

All tenants share one database. Every query must include `WHERE tenant_id = ?`. A single missed filter leaks data across tenants.

```typescript
// Every query must remember the tenant filter
const users = await db
  .select()
  .from(usersTable)
  .where(eq(usersTable.tenantId, currentTenantId)); // forget this = data leak
```

### Separate Databases (database-per-tenant)

Each tenant gets their own database. No tenant filtering needed — the connection itself is scoped.

```typescript
// Just query — the db is already tenant-scoped
const users = await db.select().from(usersTable);
```

tenanso implements the second approach.

## How It Works

1. **Turso** manages SQLite databases in the cloud. Each tenant gets a separate database.
2. **tenanso** routes connections to the right database based on the tenant.
3. **Drizzle ORM** provides type-safe queries against each tenant's database.

```
Request → Resolve Tenant → Get DB from Pool → Query
                                  ↓
                          libsql://acme-org.turso.io
                          libsql://other-org.turso.io
                          libsql://new-org.turso.io
```

## Design Principles

- **Runtime-agnostic** — Core uses only `fetch` and `Map`. No `node:` imports. Works on Cloudflare Workers, Deno, Bun, and Node.js.
- **Tenant resolution, not authentication** — tenanso resolves which database to use. Auth is your application's responsibility.
- **Explicit over implicit** — Core passes `db` explicitly via callbacks. Framework adapters (Hono) provide implicit context using their own mechanisms.

## Inspired By

tenanso is inspired by Rails 8's [activerecord-tenanted](https://github.com/basecamp/activerecord-tenanted), which provides database-per-tenant isolation using Rails' horizontal sharding infrastructure.
