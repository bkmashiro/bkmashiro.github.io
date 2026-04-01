import { defineClientConfig } from "vuepress/client";
import Analytics from "./components/Analytics.vue";
import NetherPage from "./components/NetherPage.vue";

export default defineClientConfig({
  rootComponents: [Analytics],
  enhance({ app }) {
    app.component("NetherPage", NetherPage);
  },
});
