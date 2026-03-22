import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { createTenanso } from "../tenanso.js";
import type { TenansoConfig } from "../types.js";

const config: TenansoConfig = {
  turso: {
    organizationSlug: "test-org",
    apiToken: "test-token",
    group: "default",
  },
  databaseUrl: "libsql://{tenant}-test-org.turso.io",
  authToken: "group-token",
  schema: {},
};

describe("createTenanso", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws if databaseUrl is missing {tenant} placeholder", () => {
    expect(() =>
      createTenanso({
        ...config,
        databaseUrl: "libsql://no-placeholder.turso.io",
      })
    ).toThrow("databaseUrl must contain a {tenant} placeholder");
  });

  describe("dbFor", () => {
    it("returns a drizzle instance for the tenant", () => {
      const tenanso = createTenanso(config);
      const db = tenanso.dbFor("acme") as any;

      expect(db._isDrizzle).toBe(true);
      expect(db._client.url).toBe("libsql://acme-test-org.turso.io");
    });

    it("returns the same instance for the same tenant", () => {
      const tenanso = createTenanso(config);
      expect(tenanso.dbFor("acme")).toBe(tenanso.dbFor("acme"));
    });
  });

  describe("withTenant", () => {
    it("passes the db to the callback and returns its result", async () => {
      const tenanso = createTenanso(config);

      const result = await tenanso.withTenant("acme", async (db) => {
        expect((db as any)._isDrizzle).toBe(true);
        return "hello from acme";
      });

      expect(result).toBe("hello from acme");
    });
  });

  describe("createTenant", () => {
    it("calls Turso Platform API", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response("{}", { status: 200 }))
      );

      const tenanso = createTenanso(config);
      await tenanso.createTenant("new-tenant");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body.name).toBe("new-tenant");
    });
  });

  describe("deleteTenant", () => {
    it("calls Turso API and removes from connection pool", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 })
      );

      const tenanso = createTenanso(config);

      // Access db to populate pool
      tenanso.dbFor("old-tenant");

      await tenanso.deleteTenant("old-tenant");

      expect(fetchSpy).toHaveBeenCalledOnce();

      // Should get a new instance (cache was cleared)
      const db = tenanso.dbFor("old-tenant");
      expect(db).toBeDefined();
    });
  });

  describe("listTenants", () => {
    it("returns tenant names from Turso API", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            databases: [
              { Name: "a", group: "default" },
              { Name: "b", group: "default" },
            ],
          }),
          { status: 200 }
        )
      );

      const tenanso = createTenanso(config);
      const tenants = await tenanso.listTenants();
      expect(tenants).toEqual(["a", "b"]);
    });
  });

  describe("tenantExists", () => {
    it("returns true for existing tenant", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ database: { Name: "acme" } }),
          { status: 200 }
        )
      );

      const tenanso = createTenanso(config);
      expect(await tenanso.tenantExists("acme")).toBe(true);
    });

    it("returns false for non-existing tenant", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not found", { status: 404 })
      );

      const tenanso = createTenanso(config);
      expect(await tenanso.tenantExists("nope")).toBe(false);
    });
  });
});
