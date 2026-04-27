import { defineConfig } from "vitepress";
// @ts-ignore generated at build time
import typedocSidebar from "../api/typedoc-sidebar.json";

export default defineConfig({
  title: "foxdb",
  description: "A typed SQLite ORM for Bun - zero codegen, fully typed, tiny",
  base: "/",
  lang: "en-US",
  cleanUrls: true,

  head: [
    ["link", { rel: "icon", href: "/Logo.svg", type: "image/svg+xml" }],
    ["meta", { name: "theme-color", content: "#c4b5fd" }],
  ],

  appearance: "dark",

  markdown: {
    theme: {
      light: "github-light",
      dark: "catppuccin-mocha",
    },
    lineNumbers: true,
  },

  themeConfig: {
    logo: "/Logo.svg",

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
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Core Concepts", link: "/guide/core-concepts" },
            { text: "Examples", link: "/guide/examples" },
            { text: "API Reference", link: "/guide/api-reference" },
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
