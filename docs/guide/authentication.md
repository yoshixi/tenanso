# Authentication

tenanso handles **tenant resolution**, not authentication. Auth is your application's responsibility. But how you wire them together matters for security.

## The Key Principle

**The tenant must come from a verified source.**

Never trust a raw client-supplied value without authentication. The `resolve` function in the tenant middleware should read from an already-verified auth context.

## Recommended Patterns

### JWT with tenant claim

The JWT payload contains the tenant. Since the JWT is signed by your auth provider, the tenant can't be spoofed.

```typescript
import { jwt } from "hono/jwt";

// 1. Verify JWT (runs first)
app.use("/api/*", jwt({ secret: "your-secret", alg: "HS256" }));

// 2. Extract tenant from verified payload
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.get("jwtPayload").tenant,
}));
```

This avoids any centralized database lookup at request time — JWT verification is pure cryptography.

### External auth provider (Clerk, Auth0)

Use the provider's middleware to verify the session, then map their organization concept to your tenant.

```typescript
app.use("/api/*", clerkMiddleware());
app.use("/api/*", tenantMiddleware(tenanso, {
  resolve: (c) => c.get("clerkAuth").tenantSlug,
}));
```

### API key

For B2B APIs where each API key maps to a tenant. The key simultaneously authenticates and identifies the tenant.

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

## Anti-Patterns

### Trusting a raw header

```typescript
// BAD: anyone can set this header to any value
resolve: (c) => c.req.header("x-tenant-id") // no auth verification
```

### Subdomain without auth

```typescript
// BAD: subdomain alone is not authentication
// anyone can visit acme.yourapp.com
resolve: (c) => new URL(c.req.url).hostname.split(".")[0]
```

If you use subdomains, you still need auth middleware to verify the user belongs to that tenant:

```typescript
app.use("*", authMiddleware());
app.use("*", tenantMiddleware(tenanso, {
  resolve: (c) => {
    const subdomain = new URL(c.req.url).hostname.split(".")[0];
    const user = c.get("user");
    // Verify the user actually belongs to this tenant
    if (!user.tenants.includes(subdomain)) return undefined;
    return subdomain;
  },
}));
```

## Where Do Users Live?

With database-per-tenant, user credentials need to be somewhere accessible before you know the tenant. Common approaches:

| Approach | Central DB? | Notes |
|---|---|---|
| External auth provider (Clerk, Auth0) | No | They manage users + org mapping. Issues JWT with tenant claim. |
| Subdomain-scoped login | No | User visits `acme.myapp.com/login` — tenant is known from URL. Credentials live in tenant DB. |
| Central user-tenant mapping | Yes (small) | A tiny `(email → tenant)` table for login routing. Credentials still in tenant DB. |

The first two approaches avoid needing any centralized database.
