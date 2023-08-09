import { defineConfig } from 'vitepress'
import AutoConfigureNavSidebarPlugin from '@w3ctech-editorial-department/vitepress-auto-configure-nav-sidebar'

const { nav, sidebar } = AutoConfigureNavSidebarPlugin({
  collapsed: true,
  isCollapsible: true,
  showNavIcon: false,
  singleLayerNav: true,
  showSidebarIcon: true,
  ignoreFolders: ['.vuepress'],
})


// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Baka Mashiro's Home",
  description: "Homepage of baka_mashiro",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Examples', link: '/markdown-examples' },
      { text: 'Posts', link: '/posts/index'},
      { text: 'Workshop', link: '/workshop' },
    ],

    sidebar,

    socialLinks: [
      { icon: 'github', link: 'https://github.com/bkmashiro' }
    ]
  },

})
