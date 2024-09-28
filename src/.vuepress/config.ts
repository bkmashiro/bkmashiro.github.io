import { defineUserConfig } from "vuepress";

import viteImagemin from "@vheemstra/vite-plugin-imagemin";

// The minifiers you want to use:
import imageminMozjpeg from "imagemin-mozjpeg";
import imageminWebp from "imagemin-webp";

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
  plugins: [
    viteImagemin({
      plugins: {
        jpg: imageminMozjpeg(),
      },
      makeWebp: {
        plugins: {
          jpg: imageminWebp(),
        },
      },
    }) as any,
  ],
});
