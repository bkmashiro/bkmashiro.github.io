import { defineUserConfig } from "vuepress";
import { viteBundler } from "@vuepress/bundler-vite";
// import viteImagemin from "@vheemstra/vite-plugin-imagemin";
import viteImagemin from "vite-plugin-imagemin";
// The minifiers you want to use:
// import imageminMozjpeg from "imagemin-mozjpeg";
// import imageminWebp from "imagemin-webp";

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
  // debug: true,
  // Enable it with pwa
  // shouldPrefetch: false,
  plugins: [],

  bundler: viteBundler({
    viteOptions: {
      assetsInclude: ["**/*.(png|jpg|JPG|PNG|jpeg|webp|svg|gif)"],
      plugins: [
        // @ts-ignore
        viteImagemin({
          gifsicle: {
            optimizationLevel: 3,
          },
          optipng: {
            optimizationLevel: 7,
          },
          mozjpeg: {
            quality: 80,
          },
          pngquant: {
            quality: [0.7, 0.9],
            speed: 4,
          },
          svgo: {
            plugins: [
              {
                removeViewBox: false,
              },
              {
                removeDimensions: true,
              },
            ],
          },
          webp: {
            quality: 75,
          },
        }),
      ],
    },
  }),
});
