// 主题独有配置
import { getThemeConfig } from '@sugarat/theme/node'

// 开启RSS支持（RSS配置）
// import type { Theme } from '@sugarat/theme'

const baseUrl = 'https://blog.yuzhes.com'
// const RSS: Theme.RSSOptions = {
//   title: '粥里有勺糖',
//   baseUrl,
//   copyright: 'Copyright (c) 2018-present, 粥里有勺糖',
//   description: '你的指尖,拥有改变世界的力量（大前端相关技术分享）',
//   language: 'zh-cn',
//   image: 'https://img.cdn.sugarat.top/mdImg/MTY3NDk5NTE2NzAzMA==674995167030',
//   favicon: 'https://sugarat.top/favicon.ico',
// }

// 所有配置项，详见文档: https://theme.sugarat.top/
const blogTheme = getThemeConfig({
  // 开启RSS支持
  // RSS,

  // 搜索
  // 默认开启pagefind离线的全文搜索支持（如使用其它的可以设置为false）
  // 如果npx pagefind 时间过长，可以手动将其安装为项目依赖 pnpm add pagefind
  // search: false,

  // 页脚
  footer: {
    // message 字段支持配置为HTML内容，配置多条可以配置为数组
    // message: '下面 的内容和图标都是可以修改的噢（当然本条内容也是可以隐藏的）',
    copyright: 'baka_mashiro',
    // icpRecord: {
    //   name: '蜀ICP备19011724号',
    //   link: 'https://beian.miit.gov.cn/'
    // },
    // securityRecord: {
    //   name: '公网安备xxxxx',
    //   link: 'https://www.beian.gov.cn/portal/index.do'
    // },
    version: false,
  },

  // 主题色修改
  themeColor: 'el-blue',

  // 文章默认作者
  author: 'baka_mashiro',

  // 友链
  friend: [
    {
      nickname: 'Vitepress',
      des: 'Vite & Vue Powered Static Site Generator',
      avatar:
        'https://vitepress.dev/vitepress-logo-large.webp',
      url: 'https://vitepress.dev/',
    },
  ],

  // 公告
  // popover: {
  //   title: '公告',
  //   body: [
  //     { type: 'text', content: '👇公众号👇---👇 微信 👇' },
  //     {
  //       type: 'image',
  //       src: 'https://img.cdn.sugarat.top/mdImg/MTYxNTAxODc2NTIxMA==615018765210~fmt.webp'
  //     },
  //     {
  //       type: 'text',
  //       content: '欢迎大家加群&私信交流'
  //     },
  //     {
  //       type: 'text',
  //       content: '文章首/文尾有群二维码',
  //       style: 'padding-top:0'
  //     },
  //     {
  //       type: 'button',
  //       content: '作者博客',
  //       link: 'https://sugarat.top'
  //     },
  //     {
  //       type: 'button',
  //       content: '加群交流',
  //       props: {
  //         type: 'success'
  //       },
  //       link: 'https://theme.sugarat.top/group.html',
  //     }
  //   ],
  //   duration: 0
  // },
  /*
  <script src="https://giscus.app/client.js"
        data-repo="bkmashiro/bkmashiro.github.io"
        data-repo-id="MDEwOlJlcG9zaXRvcnkzMTY3MDI3MzU="
        data-category="Announcements"
        data-category-id="DIC_kwDOEuCAD84CfHPV"
        data-mapping="pathname"
        data-strict="0"
        data-reactions-enabled="1"
        data-emit-metadata="0"
        data-input-position="bottom"
        data-theme="preferred_color_scheme"
        data-lang="zh-CN"
        crossorigin="anonymous"
        async>
</script>
  */
  comment: {
    type: 'giscus',
    options: {
      repo: 'bkmashiro/bkmashiro.github.io',
      repoId: 'MDEwOlJlcG9zaXRvcnkzMTY3MDI3MzU=',
      category: 'Announcements',
      categoryId: 'DIC_kwDOEuCAD84CfHPV',
      inputPosition: 'top'
    },
    mobileMinify: true
  },
  search: 'pagefind',
  authorList: [
    {
      nickname: 'baka_mashiro',
      url: 'https://yuzhes.com',
      des: '本站村长'
    }
  ],
  RSS: {
    title: 'baka_mashiro\'s cave',
    baseUrl,
    description: 'bakamashiro\'s cave',
    language: 'zh-cn',
    favicon: 'https://blog.yuzhes.com/favicon.ico',
    copyright: `Copyright (c) ${new Date().getFullYear()} baka_mashiro`,
  }
})

export { blogTheme }
