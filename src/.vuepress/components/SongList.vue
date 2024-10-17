<template>
  <ul>
    <!-- <li v-for="(song, index) in songs" :key="index">{{ song }}</li> -->

    <Song v-for="(song, index) in songs"
          :key="index"
          :song="song" />
  </ul>
</template>

<script setup>
import Song from './Song.vue';
import { jpop_top_50 } from './data/songs-list';
const songs = jpop_top_50
</script>
