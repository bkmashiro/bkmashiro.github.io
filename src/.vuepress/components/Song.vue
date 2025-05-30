<template>
  <div class="song-card">
    <img :src="`/assets/covers/${song.cover}`"
         alt="cover image"
         class="song-cover" />
    <div class="song-info">
      <h3 class="song-title">
        <p v-if="no"
           class="song-number">
          #{{ no }}
        </p>
        <a :href="song.link"
           target="_blank">
          {{ song.title }}
        </a>
        <div v-if="isRestrictedJp && !isArtistOnly"
             class="hint-text">
          <p>(Avaliable in Apple Music Japan)</p>
        </div>
        <div v-if="isArtistOnly && !isRestrictedJp"
             class="hint-text">
          <p>(Artist page Only)</p>
        </div>
        <div v-if="isArtistOnly && isRestrictedJp"
             class="hint-text">
          <p>(Artist page avaliable in Apple Music Japan)</p>
        </div>
      </h3>
      <p class="song-artist">{{ song.artist }}</p>
      <p class="song-genre">{{ song.genre }}</p>
      <p class="song-published">{{ song.published_at }}</p>
      <p class="song-description">{{ song.description }}</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

const props = defineProps<{
  song: {
    title: string,
    artist: string,
    published_at: string,
    description: string,
    genre: string,
    cover: string,
    link: string,
  },
  no: {
    type: Number,
    required: false,
  }
}>()

const isRestrictedJp = computed(() => props.song.link.startsWith("https://music.apple.com/jp"))
const isArtistOnly = computed(() => props.song.link.startsWith("https://music.apple.com/artist") ||
  props.song.link.startsWith("https://music.apple.com/jp/artist"))

</script>

<style scoped>
.hint-text {
  font-size: 14px;
  color: #888;
}

.song-number {
  font-size: 24px;
  font-weight: bold;
  margin: 0 16px 0 0;
}

.song-card {
  display: flex;
  flex-direction: column;
  /* justify-content: space-between; */
  justify-content: flex-start;
  width: 300px;
  padding: 16px;
  margin: 16px;
  border-radius: 12px;
  background-color: #f9f9f9;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;
}

.song-card:hover {
  transform: scale(1.05);
}

.song-cover {
  width: 100%;
  height: 180px;
  object-fit: cover;
  border-radius: 8px;
}

.song-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 12px;
}

.song-title {
  font-size: 18px;
  font-weight: bold;
  margin: 0 0 8px;

  display: flex;
  align-items: baseline;
}

.song-artist {
  font-size: 16px;
  color: #555;
  margin: 0 0 0px;
}

.song-genre,
.song-published {
  font-size: 14px;
  color: #888;
  margin: 0 0 0px;
}

.song-description {
  font-size: 14px;
  color: #666;
  margin-top: 12px;
  line-height: 1.5;
}

@media (min-width: 768px) {
  .song-card {
    flex-direction: row;
    width: auto;
    padding: 24px;
  }

  .song-cover {
    width: 150px;
    height: 150px;
    margin-right: 16px;
  }

  .song-info {
    margin-left: 16px;
    margin-top: 0;
  }
}
</style>
