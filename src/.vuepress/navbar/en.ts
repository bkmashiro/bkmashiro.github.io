import { navbar } from "vuepress-theme-hope";

export const enNavbar = navbar([
  "/",
  {
    text: "Blog",
    icon: "pen-to-square",
    prefix: "/",
    children: [
      {
        text: "typescript",
        icon: "pen-to-square",
        prefix: "posts",
        children: [
          { text: "index", icon: "pen-to-square", link: "index" },
          { text: "easy series", icon: "pen-to-square", link: "typescript/easy-series" },
          { text: "medium series", icon: "pen-to-square", link: "typescript/medium-index" },
        ],
      },
    ],
  },
  // {
  //   text: "Posts",
  //   icon: "pen-to-square",
  //   prefix: "/posts/",
  //   children: [
  //     {
  //       text: "Apple",
  //       icon: "pen-to-square",
  //       prefix: "apple/",
  //       children: [
  //         { text: "Apple1", icon: "pen-to-square", link: "1" },
  //         { text: "Apple2", icon: "pen-to-square", link: "2" },
  //       ],
  //     },
  //     {
  //       text: "Banana",
  //       icon: "pen-to-square",
  //       prefix: "banana/",
  //       children: [
  //         {
  //           text: "Banana 1",
  //           icon: "pen-to-square",
  //           link: "1",
  //         },
  //         {
  //           text: "Banana 2",
  //           icon: "pen-to-square",
  //           link: "2",
  //         },
  //       ],
  //     },
  //     { text: "Cherry", icon: "pen-to-square", link: "cherry" },
  //     { text: "Dragon Fruit", icon: "pen-to-square", link: "dragonfruit" },
  //     "tomato",
  //     "strawberry",
  //   ],
  // },
  // {
  //   text: "V2 Docs",
  //   icon: "book",
  //   link: "https://theme-hope.vuejs.press/",
  // },
]);
