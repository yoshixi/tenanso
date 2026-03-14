# Hono Integration

tenanso provides an optional middleware for [Hono](https://hono.dev/) that automatically resolves the tenant from each request and makes the database available via `c.var.db`.

## Setup

```typescript
import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { createTenanso } from "tenanso";
import { tenantMiddleware, type TenansoEnv } from "tenanso/hono";
import * as schema from "./db/schema.js";

const tenanso = createTenanso({ /* ... */ });

const app = new Hono<TenansoEnv>();

// Enable Hono's contextStorage for getContext() access outside handlers
app.use(contextStorage());

// Resolve tenant from request
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.req.header("x-tenant-id"),
}));
```

## Accessing the Database

### In route handlers

The middleware sets `c.var.db` (a Drizzle instance) and `c.var.tenant` (the tenant name):

```typescript
app.get("/api/users", async (c) => {
  const db = c.var.db;       // DrizzleDb — fully typed
  const tenant = c.var.tenant; // string
  const users = await db.select().from(usersTable);
  return c.json(users);
});
```

### Outside handlers

With `contextStorage()` enabled, use the helper functions from anywhere in the async call stack:

```typescript
import { getTenantDb, getTenantName } from "tenanso/hono";

async function getActiveUserCount(): Promise<number> {
  const db = getTenantDb();
  const result = await db.select().from(usersTable);
  return result.length;
}
```

## Tenant Resolution Strategies

The `resolve` function extracts the tenant identifier from the request. It can return a string or `undefined` (which results in a 400 response).

### Header

```typescript
resolve: (c) => c.req.header("x-tenant-id")
```

### URL path parameter

```typescript
// Route: /t/:tenantId/*
resolve: (c) => c.req.param("tenantId")
```

### Subdomain

```typescript
resolve: (c) => {
  const url = new URL(c.req.url);
  const subdomain = url.hostname.split(".")[0];
  return subdomain === "www" ? undefined : subdomain;
}
```

### From verified JWT payload

```typescript
resolve: (c) => {
  const payload = c.get("jwtPayload");
  return payload.tenant;
}
```

See the [Authentication](/guide/authentication) guide for details on securely wiring auth with tenant resolution.

## Scoping to Specific Routes

You don't need tenant resolution on every route. Use Hono's routing to scope the middleware:

```typescript
const app = new Hono();

// No tenant needed
app.get("/health", (c) => c.json({ status: "ok" }));

// Tenant-scoped routes
const api = new Hono<TenansoEnv>();
api.use("*", tenantMiddleware(tenanso, {
  resolve: (c) => c.req.header("x-tenant-id"),
}));
api.get("/users", async (c) => {
  return c.json({ tenant: c.var.tenant });
});

app.route("/api", api);
```

## Runtime Compatibility

The Hono middleware uses Hono's built-in `contextStorage()`, which manages `AsyncLocalStorage` internally. This works across all runtimes that Hono supports:

- Cloudflare Workers (with `nodejs_compat` flag)
- Deno
- Bun
- Node.js

tenanso itself has no `node:` imports — the runtime abstraction is handled entirely by Hono.
