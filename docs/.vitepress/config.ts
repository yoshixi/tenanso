import { defineConfig } from "vitepress";
import typedocSidebar from "../api/typedoc-sidebar.json" with { type: "json" };

export default defineConfig({
  title: "tenanso",
  description: "Multi-tenant SQLite with Drizzle ORM and Turso",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is tenanso?", link: "/guide/what-is-tenanso" },
            { text: "Getting Started", link: "/guide/getting-started" },
          ],
        },
        {
          text: "Core Concepts",
          items: [
            { text: "Tenant Lifecycle", link: "/guide/tenant-lifecycle" },
            { text: "Connection Pool", link: "/guide/connection-pool" },
          ],
        },
        {
          text: "Framework Integration",
          items: [
            { text: "Hono", link: "/guide/hono" },
            { text: "Authentication", link: "/guide/authentication" },
          ],
        },
        {
          text: "Infrastructure",
          items: [
            { text: "Turso Setup", link: "/guide/turso-setup" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API Reference",
          items: typedocSidebar,
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/yoshixi/tenanso" },
    ],
  },
});
