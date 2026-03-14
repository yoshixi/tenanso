# Tenant Lifecycle

tenanso manages tenant databases through the [Turso Platform API](https://docs.turso.tech/api-reference/introduction). All API calls use `fetch` — no Node.js runtime dependency.

## Creating a Tenant

Creates a new database in your Turso organization:

```typescript
await tenanso.createTenant("acme-corp");
```

This calls `POST /v1/organizations/{org}/databases` with:

```json
{
  "name": "acme-corp",
  "group": "default"
}
```

### Typical signup flow

```typescript
app.post("/signup", async (c) => {
  const { tenantSlug, email, name } = await c.req.json();

  // 1. Create the tenant database
  await tenanso.createTenant(tenantSlug);

  // 2. Seed initial data
  await tenanso.withTenant(tenantSlug, async (db) => {
    await db.insert(users).values({ email, name, role: "admin" });
  });

  return c.json({ tenant: tenantSlug }, 201);
});
```

## Deleting a Tenant

Deletes the database from Turso and removes the cached connection:

```typescript
await tenanso.deleteTenant("acme-corp");
```

## Listing Tenants

Returns the names of all databases in your organization:

```typescript
const tenants = await tenanso.listTenants();
// ["acme-corp", "other-corp", "startup-inc"]
```

This calls the Turso Platform API, so it has some latency. For per-request validation, consider caching the result in your application.

## Checking if a Tenant Exists

```typescript
const exists = await tenanso.tenantExists("acme-corp");
```

This calls `listTenants()` under the hood. If you need fast per-request checks, maintain your own cache or use an external auth provider that embeds the tenant in a JWT.
