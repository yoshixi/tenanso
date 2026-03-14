# Turso Setup

tenanso uses the [Turso Platform API](https://docs.turso.tech/api-reference/introduction) to manage tenant databases. This guide covers the Turso-side setup.

## Prerequisites

1. A [Turso account](https://turso.tech/)
2. The [Turso CLI](https://docs.turso.tech/cli/introduction) installed

## Create a Group

All tenant databases live in a [group](https://docs.turso.tech/features/groups). Use a group per application to keep databases organized — especially important if your Turso account hosts multiple services.

```bash
turso group create my-app --location nrt  # Tokyo
```

## Group Auth Token

A group auth token works for **all databases in the group** — one token for all tenants. This is what tenanso uses for `authToken`.

```bash
turso group tokens create my-app
```

Save this as `TURSO_GROUP_AUTH_TOKEN` in your environment.

## Platform API Token

tenanso uses the Platform API to create and delete tenant databases. Generate a token:

```bash
turso auth api-tokens mint tenanso
```

Save this as `TURSO_API_TOKEN` in your environment.

## Seed Database

tenanso creates new tenant databases by cloning a **seed database**. The seed database has your schema and any initial data already applied — so new tenants are ready instantly without running migrations.

### Create the seed database

```bash
turso db create seed-db --group my-app
```

### Apply your schema to the seed

```bash
# Using drizzle-kit
npx drizzle-kit push --url libsql://seed-db-my-app-my-account.turso.io --auth-token $TURSO_GROUP_AUTH_TOKEN
```

### Configure tenanso

```typescript
const tenanso = createTenanso({
  turso: {
    organizationSlug: "my-org",
    apiToken: process.env.TURSO_API_TOKEN!,
    group: "my-app",
  },
  databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io",
  authToken: process.env.TURSO_GROUP_AUTH_TOKEN!,
  schema,
  seed: { database: "seed-db" },
});
```

When `tenanso.createTenant("acme")` is called, Turso clones `seed-db` — the new database has the schema and seed data ready immediately.

### Updating the schema

When your schema changes:

1. Apply migrations to the seed database (so new tenants get the latest schema)
2. Apply migrations to existing tenant databases

```typescript
// Update existing tenants
const tenants = await tenanso.listTenants();
for (const tenant of tenants) {
  await tenanso.withTenant(tenant, async (db) => {
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
}
```

## Environment Variables

| Variable | Description |
|---|---|
| `TURSO_API_TOKEN` | Turso Platform API token (for `createTenant`, `deleteTenant`, `listTenants`) |
| `TURSO_GROUP_AUTH_TOKEN` | Group auth token (for database queries via `@libsql/client`) |

## Database URL Pattern

The `databaseUrl` config uses `{tenant}` as a placeholder. Turso database URLs follow the pattern:

```
libsql://{database-name}-{app}-{account-slug}.turso.io
```

For example, if your account is `my-account` and tenant is `acme`:

```
libsql://acme-my-app-my-account.turso.io
```

Configure as:

```typescript
databaseUrl: "libsql://{tenant}-my-app-my-account.turso.io"
```
