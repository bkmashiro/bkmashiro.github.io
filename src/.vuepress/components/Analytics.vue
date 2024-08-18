<template>
  <div>
    <SpeedInsights />
  </div>
</template>

<script lang="ts" setup>
import { SpeedInsights } from "@vercel/speed-insights/vue"
import { inject } from "@vercel/analytics"
import { onMounted } from "vue/dist/vue.mjs";

onMounted(() => {
  inject()
})

</script>

<style scoped>

</style>