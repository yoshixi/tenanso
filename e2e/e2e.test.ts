/**
 * E2E tests for tenanso + Hono integration.
 *
 * Runs a mock Turso Platform API server that creates/deletes/lists
 * local SQLite files. tenanso.createTenant() hits this mock server,
 * which creates the database file (cloning from seed if configured).
 *
 * Tests the full flow:
 *   Mock Turso API → tenant creation → schema cloning →
 *   Hono request → tenant middleware → Drizzle query → SQLite database
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

import { createTenanso } from "../src/tenanso.js";
import { tenantMiddleware, type TenansoEnv } from "../src/middleware/hono.js";
import type { TenansoConfig, TenansoInstance } from "../src/types.js";

// ============================================================
// Schema
// ============================================================

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
});

const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
});

const dbSchema = { users, projects };

// ============================================================
// Mock Turso Platform API server
// ============================================================

const TEST_DIR = path.join(import.meta.dirname, ".test-dbs");
let MOCK_BASE_URL: string;

const SQL_CREATE_USERS = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
)`;

const SQL_CREATE_PROJECTS = `CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT
)`;

async function applySchema(dbPath: string): Promise<void> {
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await db.run(SQL_CREATE_USERS);
  await db.run(SQL_CREATE_PROJECTS);
}

function createMockTursoApi() {
  const api = new Hono();

  // POST /v1/organizations/:org/databases — create database
  api.post("/v1/organizations/:org/databases", async (c) => {
    const body = await c.req.json();
    const dbName = body.name as string;
    const dbPath = path.join(TEST_DIR, `${dbName}.db`);

    if (fs.existsSync(dbPath)) {
      return c.json({ error: `Database "${dbName}" already exists` }, 409);
    }

    // If seed is specified, clone from seed database
    const seed = body.seed as { type: string; name: string } | undefined;
    if (seed?.type === "database") {
      const seedPath = path.join(TEST_DIR, `${seed.name}.db`);
      if (!fs.existsSync(seedPath)) {
        return c.json({ error: `Seed database "${seed.name}" not found` }, 404);
      }
      fs.copyFileSync(seedPath, dbPath);
    } else {
      // Create empty database and apply schema
      await applySchema(dbPath);
    }

    return c.json({ database: { Name: dbName } }, 200);
  });

  // DELETE /v1/organizations/:org/databases/:name — delete database
  api.delete("/v1/organizations/:org/databases/:name", async (c) => {
    const dbName = c.req.param("name");
    const dbPath = path.join(TEST_DIR, `${dbName}.db`);

    if (!fs.existsSync(dbPath)) {
      return c.json({ error: `Database "${dbName}" not found` }, 404);
    }

    fs.unlinkSync(dbPath);
    return c.json({ database: dbName }, 200);
  });

  // GET /v1/organizations/:org/databases/:name — check database exists
  api.get("/v1/organizations/:org/databases/:name", async (c) => {
    const dbName = c.req.param("name");
    const dbPath = path.join(TEST_DIR, `${dbName}.db`);

    if (!fs.existsSync(dbPath)) {
      return c.json({ error: "not found" }, 404);
    }

    return c.json({ database: { Name: dbName } }, 200);
  });

  // GET /v1/organizations/:org/databases — list databases
  api.get("/v1/organizations/:org/databases", async (c) => {
    const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith(".db"));
    const databases = files.map((f) => ({
      Name: f.replace(".db", ""),
    }));
    return c.json({ databases }, 200);
  });

  return api;
}

// ============================================================
// App under test
// ============================================================

function createApp(tenanso: TenansoInstance) {
  const app = new Hono<TenansoEnv>();

  app.use(
    "/api/*",
    tenantMiddleware(tenanso, {
      resolve: (c) => c.req.header("x-tenant-id"),
    })
  );

  app.get("/api/users", async (c) => {
    const result = await c.var.db.select().from(users);
    return c.json(result);
  });

  app.post("/api/users", async (c) => {
    const body = await c.req.json();
    await c.var.db.insert(users).values(body);
    return c.json({ success: true }, 201);
  });

  app.get("/api/projects", async (c) => {
    const result = await c.var.db.select().from(projects);
    return c.json(result);
  });

  app.post("/api/projects", async (c) => {
    const body = await c.req.json();
    await c.var.db.insert(projects).values(body);
    return c.json({ success: true }, 201);
  });

  app.get("/api/tenant", async (c) => {
    return c.json({ tenant: c.var.tenant });
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}

// ============================================================
// Tests
// ============================================================

describe("e2e: tenanso + Hono with mock Turso API", () => {
  let tenanso: TenansoInstance;
  let app: ReturnType<typeof createApp>;
  let mockServer: ReturnType<typeof serve>;

  beforeAll(async () => {
    // Clean up and create test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Start mock Turso API server on a random available port
    const mockApi = createMockTursoApi();
    mockServer = serve({ fetch: mockApi.fetch, port: 0 });

    // Wait for server to be ready and get the assigned port
    await new Promise<void>((resolve) => {
      mockServer.on("listening", resolve);
    });
    const addr = mockServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    MOCK_BASE_URL = `http://127.0.0.1:${port}`;

    // Create tenanso pointing at the mock API
    const config: TenansoConfig = {
      turso: {
        organizationSlug: "test-org",
        apiToken: "test-token",
        group: "test-group",
        baseUrl: MOCK_BASE_URL,
      },
      databaseUrl: `file:${TEST_DIR}/{tenant}.db`,
      authToken: "",
      schema: dbSchema,
      seed: { database: "seed-db" },
    };

    tenanso = createTenanso(config);
    app = createApp(tenanso);
  });

  afterAll(async () => {
    mockServer?.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  // --------------------------------------------------------
  // Seed database setup
  // --------------------------------------------------------

  describe("seed database setup", () => {
    it("creates a seed database with schema applied", async () => {
      const seedPath = path.join(TEST_DIR, "seed-db.db");
      await applySchema(seedPath);
      expect(fs.existsSync(seedPath)).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Tenant creation via createTenant()
  // --------------------------------------------------------

  describe("tenant creation via createTenant()", () => {
    it("creates tenant-a by calling tenanso.createTenant()", async () => {
      // This calls the mock Turso API, which clones seed-db
      await tenanso.createTenant("tenant-a");

      expect(fs.existsSync(path.join(TEST_DIR, "tenant-a.db"))).toBe(true);

      // Verify the cloned database has the schema
      const result = await tenanso.withTenant("tenant-a", async (db) => {
        return db.select().from(dbSchema.users);
      });
      expect(result).toHaveLength(0);
    });

    it("creates tenant-b by calling tenanso.createTenant()", async () => {
      await tenanso.createTenant("tenant-b");

      expect(fs.existsSync(path.join(TEST_DIR, "tenant-b.db"))).toBe(true);
    });

    it("creates tenant-c by calling tenanso.createTenant()", async () => {
      await tenanso.createTenant("tenant-c");

      expect(fs.existsSync(path.join(TEST_DIR, "tenant-c.db"))).toBe(true);
    });

    it("fails to create a tenant that already exists", async () => {
      await expect(tenanso.createTenant("tenant-a")).rejects.toThrow("409");
    });
  });

  // --------------------------------------------------------
  // Signup flow: create tenant → seed data → query via HTTP
  // --------------------------------------------------------

  describe("signup flow", () => {
    it("seeds initial data after tenant creation", async () => {
      await tenanso.withTenant("tenant-a", async (db) => {
        await db.insert(dbSchema.users).values({
          name: "Alice",
          email: "alice@acme.com",
          role: "admin",
        });
      });

      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: "Alice",
        email: "alice@acme.com",
        role: "admin",
      });
    });
  });

  // --------------------------------------------------------
  // Middleware
  // --------------------------------------------------------

  describe("middleware", () => {
    it("health check works without tenant header", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });

    it("returns 400 when tenant header is missing", async () => {
      const res = await app.request("/api/users");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Tenant not specified" });
    });

    it("resolves tenant from header", async () => {
      const res = await app.request("/api/tenant", {
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect(await res.json()).toEqual({ tenant: "tenant-a" });
    });
  });

  // --------------------------------------------------------
  // CRUD
  // --------------------------------------------------------

  describe("CRUD operations", () => {
    it("creates and reads users via HTTP", async () => {
      await app.request("/api/users", {
        method: "POST",
        headers: {
          "x-tenant-id": "tenant-b",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Bob",
          email: "bob@other.com",
          role: "member",
        }),
      });

      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-b" },
      });
      const result = await res.json();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: "Bob" });
    });

    it("creates and reads projects via HTTP", async () => {
      await app.request("/api/projects", {
        method: "POST",
        headers: {
          "x-tenant-id": "tenant-a",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Project Alpha",
          description: "First project",
        }),
      });

      const res = await app.request("/api/projects", {
        headers: { "x-tenant-id": "tenant-a" },
      });
      const result = await res.json();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: "Project Alpha" });
    });
  });

  // --------------------------------------------------------
  // Tenant isolation
  // --------------------------------------------------------

  describe("tenant isolation", () => {
    it("tenant-b cannot see tenant-a users", async () => {
      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-b" },
      });
      const result = (await res.json()) as Array<{ name: string }>;
      expect(result.every((u) => u.name !== "Alice")).toBe(true);
    });

    it("tenant-c has no data from other tenants", async () => {
      const usersRes = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-c" },
      });
      expect(await usersRes.json()).toHaveLength(0);

      const projectsRes = await app.request("/api/projects", {
        headers: { "x-tenant-id": "tenant-c" },
      });
      expect(await projectsRes.json()).toHaveLength(0);
    });

    it("writes to one tenant don't affect others", async () => {
      await app.request("/api/users", {
        method: "POST",
        headers: {
          "x-tenant-id": "tenant-b",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Charlie", email: "charlie@other.com" }),
      });

      // tenant-a: 1 user (Alice)
      const aRes = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect((await aRes.json() as unknown[]).length).toBe(1);

      // tenant-b: 2 users (Bob, Charlie)
      const bRes = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-b" },
      });
      expect((await bRes.json() as unknown[]).length).toBe(2);

      // tenant-c: 0 users
      const cRes = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-c" },
      });
      expect((await cRes.json() as unknown[]).length).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Direct API
  // --------------------------------------------------------

  describe("withTenant / dbFor", () => {
    it("withTenant reads data written via HTTP", async () => {
      const result = await tenanso.withTenant("tenant-a", async (db) => {
        return db.select().from(dbSchema.users);
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: "Alice" });
    });

    it("withTenant writes data readable via HTTP", async () => {
      await tenanso.withTenant("tenant-c", async (db) => {
        await db.insert(dbSchema.users).values({
          name: "Dave",
          email: "dave@startup.com",
          role: "admin",
        });
      });

      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-c" },
      });
      const result = await res.json();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: "Dave" });
    });

    it("dbFor returns cached instances", () => {
      expect(tenanso.dbFor("tenant-a")).toBe(tenanso.dbFor("tenant-a"));
      expect(tenanso.dbFor("tenant-a")).not.toBe(tenanso.dbFor("tenant-b"));
    });
  });

  // --------------------------------------------------------
  // Tenant listing
  // --------------------------------------------------------

  describe("listTenants / tenantExists", () => {
    it("lists all tenant databases", async () => {
      const tenants = await tenanso.listTenants();
      expect(tenants).toContain("tenant-a");
      expect(tenants).toContain("tenant-b");
      expect(tenants).toContain("tenant-c");
      expect(tenants).toContain("seed-db");
    });

    it("tenantExists returns true for existing tenant", async () => {
      expect(await tenanso.tenantExists("tenant-a")).toBe(true);
    });

    it("tenantExists returns false for non-existing tenant", async () => {
      expect(await tenanso.tenantExists("nonexistent")).toBe(false);
    });
  });

  // --------------------------------------------------------
  // Concurrent access
  // --------------------------------------------------------

  describe("concurrent access", () => {
    it("handles parallel requests to different tenants", async () => {
      const [resA, resB, resC] = await Promise.all([
        app.request("/api/users", { headers: { "x-tenant-id": "tenant-a" } }),
        app.request("/api/users", { headers: { "x-tenant-id": "tenant-b" } }),
        app.request("/api/users", { headers: { "x-tenant-id": "tenant-c" } }),
      ]);

      expect((await resA.json() as unknown[]).length).toBe(1); // Alice
      expect((await resB.json() as unknown[]).length).toBe(2); // Bob, Charlie
      expect((await resC.json() as unknown[]).length).toBe(1); // Dave
    });
  });

  // --------------------------------------------------------
  // Tenant deletion
  // --------------------------------------------------------

  describe("tenant deletion via deleteTenant()", () => {
    it("creates and then deletes a tenant", async () => {
      // Create
      await tenanso.createTenant("tenant-temp");
      expect(fs.existsSync(path.join(TEST_DIR, "tenant-temp.db"))).toBe(true);

      // Seed data
      await tenanso.withTenant("tenant-temp", async (db) => {
        await db.insert(dbSchema.users).values({
          name: "Temp",
          email: "temp@example.com",
        });
      });

      // Verify it works
      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-temp" },
      });
      expect((await res.json() as unknown[]).length).toBe(1);

      // Delete via tenanso (calls mock Turso API)
      await tenanso.deleteTenant("tenant-temp");
      expect(fs.existsSync(path.join(TEST_DIR, "tenant-temp.db"))).toBe(false);

      // Verify it's gone from the list
      expect(await tenanso.tenantExists("tenant-temp")).toBe(false);
    });

    it("other tenants are unaffected by deletion", async () => {
      const res = await app.request("/api/users", {
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect((await res.json() as unknown[]).length).toBe(1);
    });
  });
});
