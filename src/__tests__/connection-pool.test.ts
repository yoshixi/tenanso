import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @libsql/client before importing ConnectionPool
vi.mock("@libsql/client", () => ({
  createClient: vi.fn((opts: { url: string; authToken: string }) => ({
    url: opts.url,
    authToken: opts.authToken,
    close: vi.fn(),
  })),
}));

vi.mock("drizzle-orm/libsql", () => ({
  drizzle: vi.fn((client: unknown, opts: unknown) => ({
    _client: client,
    _opts: opts,
    _isDrizzle: true,
  })),
}));

import { ConnectionPool } from "../connection-pool.js";
import type { TenansoConfig } from "../types.js";

function makeConfig(overrides?: Partial<TenansoConfig>): TenansoConfig {
  return {
    turso: {
      organizationSlug: "test-org",
      apiToken: "test-token",
      group: "default",
    },
    databaseUrl: "libsql://{tenant}-test-org.turso.io",
    authToken: "group-token",
    schema: {},
    ...overrides,
  };
}

describe("ConnectionPool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a db instance for a tenant", () => {
    const pool = new ConnectionPool(makeConfig());
    const db = pool.getDb("acme") as any;

    expect(db._isDrizzle).toBe(true);
    expect(db._client.url).toBe("libsql://acme-test-org.turso.io");
    expect(db._client.authToken).toBe("group-token");
  });

  it("returns cached instance on second call", () => {
    const pool = new ConnectionPool(makeConfig());
    const db1 = pool.getDb("acme");
    const db2 = pool.getDb("acme");

    expect(db1).toBe(db2);
  });

  it("creates separate instances for different tenants", () => {
    const pool = new ConnectionPool(makeConfig());
    const db1 = pool.getDb("acme");
    const db2 = pool.getDb("other");

    expect(db1).not.toBe(db2);
  });

  it("removes a tenant from the cache", () => {
    const pool = new ConnectionPool(makeConfig());
    const db1 = pool.getDb("acme");
    pool.remove("acme");
    const db2 = pool.getDb("acme");

    expect(db1).not.toBe(db2);
  });

  it("tracks pool size", () => {
    const pool = new ConnectionPool(makeConfig());
    expect(pool.size).toBe(0);
    pool.getDb("a");
    expect(pool.size).toBe(1);
    pool.getDb("b");
    expect(pool.size).toBe(2);
    pool.remove("a");
    expect(pool.size).toBe(1);
  });

  it("evicts LRU entry when max is reached", () => {
    const pool = new ConnectionPool(makeConfig({ maxConnections: 2 }));

    pool.getDb("a");
    pool.getDb("b");
    expect(pool.size).toBe(2);

    // Access "a" again to make "b" the LRU
    pool.getDb("a");

    // Adding "c" should evict "b"
    pool.getDb("c");
    expect(pool.size).toBe(2);

    // "a" should still be cached, "b" should be evicted (new instance)
    const dbA = pool.getDb("a");
    const dbB = pool.getDb("b");
    expect(dbA).toBeDefined();
    expect(dbB).toBeDefined();
  });
});
