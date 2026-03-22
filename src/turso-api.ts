import type { SeedConfig, TursoConfig } from "./types.js";

interface TursoDatabase {
  Name: string;
  group?: string;
}

interface ListDatabasesResponse {
  databases: TursoDatabase[];
}

const TENANT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function validateTenantName(name: string): void {
  if (!name || !TENANT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid tenant name "${name}". Must match ${TENANT_NAME_PATTERN} (lowercase alphanumeric and hyphens, cannot start with a hyphen).`
    );
  }
}

export class TursoApi {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly group: string;
  private readonly seed: SeedConfig | undefined;

  constructor(config: TursoConfig, seed: SeedConfig | undefined) {
    const base = config.baseUrl ?? "https://api.turso.tech";
    this.baseUrl = `${base}/v1/organizations/${config.organizationSlug}`;
    this.apiToken = config.apiToken;
    this.group = config.group;
    this.seed = seed;
  }

  async createDatabase(name: string): Promise<void> {
    validateTenantName(name);

    const body: Record<string, unknown> = {
      name,
      group: this.group,
    };

    if (this.seed) {
      body["seed"] = {
        type: "database",
        name: this.seed.database,
      };
    }

    const res = await fetch(`${this.baseUrl}/databases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to create database "${name}": ${res.status} ${text}`
      );
    }
  }

  async deleteDatabase(name: string): Promise<void> {
    validateTenantName(name);

    const res = await fetch(`${this.baseUrl}/databases/${name}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to delete database "${name}": ${res.status} ${text}`
      );
    }
  }

  async listDatabases(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/databases`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to list databases: ${res.status}`);
    }

    const data = (await res.json()) as ListDatabasesResponse;
    return data.databases
      .filter((db) => db.group === this.group)
      .map((db) => db.Name);
  }

  async databaseExists(name: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/databases/${name}`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (res.ok) return true;
    if (res.status === 404) return false;

    const text = await res.text();
    throw new Error(
      `Failed to check database "${name}": ${res.status} ${text}`
    );
  }
}
