import { defineConfig } from "vitepress";
// @ts-ignore generated at build time
import typedocSidebar from "../api/typedoc-sidebar.json";

export default defineConfig({
  title: "foxdb",
  description: "itty bitty typebox-powered ORM for Bun :3 (might bite~)",
  base: "/",
  lang: "en-US",
  cleanUrls: true,
  

  head: [
    ["link", { rel: "icon", href: "/logo.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#1e1e2e" }],
  ],

  appearance: "dark",

  markdown: {
    theme: {
      light: "catppuccin-latte",
      dark: "catppuccin-mocha",
    },
    lineNumbers: true,
  },

  lastUpdated: true,
  
  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      { text: "GitHub", link: "https://github.com/xwxfox/foxdb" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Hi! :3", link: "/guide/readme" },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Core Concepts", link: "/guide/core-concepts" },
            { text: "Examples", link: "/guide/examples" },
            { text: "API Reference", link: "/api" },
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
      { icon: "github", link: "https://github.com/xwxfox/foxdb" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/xwxfox/foxdb/edit/master/docs/:path",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © xwxfox",
    },
  },
});
