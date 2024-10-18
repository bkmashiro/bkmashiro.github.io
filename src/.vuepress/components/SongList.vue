<template>
  <div>
    <!-- <li v-for="(song, index) in songs" :key="index">{{ song }}</li> -->

    <Song v-for="(song, index) in songs"
          :key="index"
          :no="index + 1"
          :song="song" />
  </div>
</template>

<script setup>
import Song from './Song.vue';
import { jpop_top_50 } from './data/songs-list';
const songs = jpop_top_50
</script>
