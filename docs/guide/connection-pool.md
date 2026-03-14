# Connection Pool

tenanso caches Drizzle ORM instances per tenant to avoid creating a new connection on every request.

## How It Works

When you call `dbFor(tenant)` or `withTenant(tenant, fn)`, tenanso:

1. Checks the cache for an existing Drizzle instance
2. If found, updates the last-used timestamp and returns it
3. If not found, creates a new `@libsql/client` connection and wraps it with Drizzle

```typescript
// First call: creates connection
const db1 = tenanso.dbFor("acme"); // new connection

// Second call: returns cached instance
const db2 = tenanso.dbFor("acme"); // same instance
db1 === db2; // true
```

## Max Connections

The pool has a configurable maximum size (default: 50). When the limit is reached, the **least recently used** connection is evicted.

```typescript
const tenanso = createTenanso({
  // ...
  maxConnections: 20, // cap at 20 cached connections
});
```


### Tuning

- **Too low** — Frequent evictions cause connection churn and increased latency
- **Too high** — More memory and file descriptors consumed

For most applications, the default of 50 is a good starting point.
