import { navbar } from "vuepress-theme-hope";

export const jaNavbar = navbar([
  "/ja/",
  {
    text: "ブログ",
    icon: "pen-to-square",
    prefix: "/ja/",
    children: [
      {
        text: "プロジェクト",
        icon: "pen-to-square",
        prefix: "projects/",
        children: [
          { text: "一覧", icon: "pen-to-square", link: "" },
        ],
      },
    ],
  },
]);
