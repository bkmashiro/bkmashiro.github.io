import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  locales: {
    "/": {
      lang: "en-US",
      title: "BakaWorks",
      description: "baka_mashiro's blog",
    },
    "/zh/": {
      lang: "zh-CN",
      title: "BakaWorks",
      description: "baka_mashiro's blog",
    },
  },

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});
