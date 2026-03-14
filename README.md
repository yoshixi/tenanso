# tenanso

Multi-tenant SQLite for TypeScript — database-per-tenant isolation using [Drizzle ORM](https://orm.drizzle.team/) and [Turso](https://turso.tech/).

Each tenant gets their own SQLite database managed by Turso. Your application code stays tenant-unaware — tenanso handles connection routing, tenant lifecycle, and framework integration.

Inspired by Rails 8's [activerecord-tenanted](https://github.com/basecamp/activerecord-tenanted).

