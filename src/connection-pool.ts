import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import type { DrizzleDb, TenansoConfig } from "./types.js";

interface PoolEntry {
  client: Client;
  db: DrizzleDb;
  lastUsed: number;
}

export class ConnectionPool {
  private readonly cache = new Map<string, PoolEntry>();
  private readonly databaseUrl: string;
  private readonly authToken: string | undefined;
  private readonly schema: Record<string, unknown>;
  private readonly maxConnections: number;

  constructor(config: TenansoConfig) {
    this.databaseUrl = config.databaseUrl;
    this.authToken = config.authToken || undefined;
    this.schema = config.schema;
    this.maxConnections = config.maxConnections ?? 50;
  }

  getDb(tenant: string): DrizzleDb {
    const existing = this.cache.get(tenant);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.db;
    }

    this.evictIfNeeded();

    const url = this.databaseUrl.replace("{tenant}", tenant);
    const client = createClient({
      url,
      ...(this.authToken ? { authToken: this.authToken } : {}),
    });
    const db = drizzle(client, { schema: this.schema });

    this.cache.set(tenant, { client, db, lastUsed: Date.now() });
    return db;
  }

  remove(tenant: string): void {
    const entry = this.cache.get(tenant);
    if (entry) {
      entry.client.close();
      this.cache.delete(tenant);
    }
  }

  get size(): number {
    return this.cache.size;
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxConnections) return;

    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.remove(oldestKey);
    }
  }
}
