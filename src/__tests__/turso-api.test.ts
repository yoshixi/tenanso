import { describe, it, expect, vi, beforeEach } from "vitest";
import { TursoApi } from "../turso-api.js";
import type { TursoConfig } from "../types.js";

const tursoConfig: TursoConfig = {
  organizationSlug: "test-org",
  apiToken: "test-api-token",
  group: "default",
};

describe("TursoApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createDatabase", () => {
    it("sends POST to Turso API without seed", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ database: { Name: "my-tenant" } }), {
          status: 200,
        })
      );

      const api = new TursoApi(tursoConfig, undefined);
      await api.createDatabase("my-tenant");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(
        "https://api.turso.tech/v1/organizations/test-org/databases"
      );
      expect(opts?.method).toBe("POST");

      const body = JSON.parse(opts?.body as string);
      expect(body).toEqual({ name: "my-tenant", group: "default" });
    });

    it("includes seed when configured", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 })
      );

      const api = new TursoApi(tursoConfig, { database: "seed-db" });
      await api.createDatabase("my-tenant");

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
      expect(body).toEqual({
        name: "my-tenant",
        group: "default",
        seed: {
          type: "database",
          name: "seed-db",
        },
      });
    });

    it("rejects invalid tenant names", async () => {
      const api = new TursoApi(tursoConfig, undefined);
      await expect(api.createDatabase("")).rejects.toThrow("Invalid tenant name");
      await expect(api.createDatabase("My Tenant")).rejects.toThrow("Invalid tenant name");
      await expect(api.createDatabase("-starts-with-hyphen")).rejects.toThrow("Invalid tenant name");
      await expect(api.createDatabase("has/slash")).rejects.toThrow("Invalid tenant name");
      await expect(api.createDatabase("has space")).rejects.toThrow("Invalid tenant name");
    });

    it("accepts valid tenant names", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 200 })
      );
      const api = new TursoApi(tursoConfig, undefined);
      await expect(api.createDatabase("valid-name")).resolves.not.toThrow();
      await expect(api.createDatabase("tenant123")).resolves.not.toThrow();
      await expect(api.createDatabase("a")).resolves.not.toThrow();
    });

    it("throws on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("quota exceeded", { status: 429 })
      );

      const api = new TursoApi(tursoConfig, undefined);
      await expect(api.createDatabase("my-tenant")).rejects.toThrow(
        'Failed to create database "my-tenant" in group(default) (without seed): 429 quota exceeded'
      );
    });
  });

  describe("deleteDatabase", () => {
    it("sends DELETE to Turso API after verifying group", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ database: { Name: "my-tenant", group: "default" } }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response("{}", { status: 200 })
        );

      const api = new TursoApi(tursoConfig, undefined);
      await api.deleteDatabase("my-tenant");

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // First call: GET to verify group
      const [getUrl] = fetchSpy.mock.calls[0]!;
      expect(getUrl).toBe(
        "https://api.turso.tech/v1/organizations/test-org/databases/my-tenant"
      );

      // Second call: DELETE
      const [deleteUrl, deleteOpts] = fetchSpy.mock.calls[1]!;
      expect(deleteUrl).toBe(
        "https://api.turso.tech/v1/organizations/test-org/databases/my-tenant"
      );
      expect(deleteOpts?.method).toBe("DELETE");
    });

    it("refuses to delete database from a different group", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ database: { Name: "my-tenant", group: "other-group" } }),
          { status: 200 }
        )
      );

      const api = new TursoApi(tursoConfig, undefined);
      await expect(api.deleteDatabase("my-tenant")).rejects.toThrow(
        'Database "my-tenant" belongs to group "other-group", not group "default". Refusing to operate on it.'
      );
    });
  });

  describe("listDatabases", () => {
    it("filters by group via query parameter", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            databases: [
              { Name: "tenant-a", group: "default" },
              { Name: "tenant-b", group: "default" },
            ],
          }),
          { status: 200 }
        )
      );

      const api = new TursoApi(tursoConfig, undefined);
      const result = await api.listDatabases();

      expect(result).toEqual(["tenant-a", "tenant-b"]);

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(
        "https://api.turso.tech/v1/organizations/test-org/databases?group=default"
      );
    });
  });

  describe("databaseExists", () => {
    it("returns true when database exists in the configured group", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ database: { Name: "my-tenant", group: "default" } }),
          { status: 200 }
        )
      );

      const api = new TursoApi(tursoConfig, undefined);
      expect(await api.databaseExists("my-tenant")).toBe(true);

      const [url] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe(
        "https://api.turso.tech/v1/organizations/test-org/databases/my-tenant"
      );
    });

    it("returns false when database exists in a different group", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ database: { Name: "my-tenant", group: "other-group" } }),
          { status: 200 }
        )
      );

      const api = new TursoApi(tursoConfig, undefined);
      expect(await api.databaseExists("my-tenant")).toBe(false);
    });

    it("returns false when database does not exist", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not found", { status: 404 })
      );

      const api = new TursoApi(tursoConfig, undefined);
      expect(await api.databaseExists("nonexistent")).toBe(false);
    });

    it("throws on non-404 errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("unauthorized", { status: 401 })
      );

      const api = new TursoApi(tursoConfig, undefined);
      await expect(api.databaseExists("my-tenant")).rejects.toThrow(
        'Failed to check database "my-tenant" in group(default): 401 unauthorized'
      );
    });
  });
});
