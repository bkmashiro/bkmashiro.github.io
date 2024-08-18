import { navbar } from "vuepress-theme-hope";

export const zhNavbar = navbar([
  "/zh/",
  {
    text: "博文",
    icon: "pen-to-square",
    prefix: "/zh/",
    children: [
      {
        text: "类型体操",
        icon: "pen-to-square",
        prefix: "typescript",
        children: [
          { text: "导航", icon: "pen-to-square", link: "index" },
          { text: "简单系列", icon: "pen-to-square", link: "easy-series" },
          { text: "中等系列", icon: "pen-to-square", link: "medium-index" },
        ],
      },
    ],
  },
  // {
  //   text: "V2 文档",
  //   icon: "book",
  //   link: "https://theme-hope.vuejs.press/zh/",
  // },
]);
