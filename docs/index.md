---
layout: home
hero:
  name: tenanso
  text: Multi-Tenant SQLite for TypeScript
  tagline: Database-per-tenant isolation using Drizzle ORM and Turso. Runtime-agnostic.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/
    - theme: alt
      text: GitHub
      link: https://github.com/yoshixi/tenanso
features:
  - title: Database-per-Tenant
    details: Each tenant gets their own SQLite database. Complete data isolation with no WHERE tenant_id = ? needed.
  - title: Runtime-Agnostic
    details: Works on Cloudflare Workers, Deno, Bun, and Node.js. Zero node:-specific imports in the core.
  - title: Hono Integration
    details: Optional first-class middleware for Hono. Type-safe access to tenant db via c.var.db.
  - title: Turso Managed
    details: Create, delete, and list tenant databases via Turso Platform API. Connection pooling with LRU eviction.
---
