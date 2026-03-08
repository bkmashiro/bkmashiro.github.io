import { sidebar } from "vuepress-theme-hope";

export const jaSidebar = sidebar({
  "/ja/": [
    "",
    {
      text: "プロジェクト",
      icon: "book",
      prefix: "projects/",
      children: "structure",
    },
  ],
});
