<template>
  <div class="mc-farm-wrapper">
    <!-- Hint that fades after first interaction -->
    <div class="mc-hint" :class="{ hidden: interacted }">
      Click to interact
    </div>

    <div class="mc-scene" :class="{ shake: shaking }">
      <!-- 3x3 Farm Grid -->
      <div class="mc-farm-grid">
        <div
          v-for="(crop, idx) in crops"
          :key="idx"
          class="mc-tile"
          @click="handleTileClick(idx)"
        >
          <!-- Farmland block -->
          <!-- TODO: replace .mc-farmland with background-image: url('/mc-textures/farmland.png') -->
          <div class="mc-farmland"></div>

          <!-- Crop sprite -->
          <!-- TODO: replace .mc-crop with sprite sheet background-image per stage -->
          <div
            class="mc-crop"
            :class="[`stage-${crop.stage}`, { growing: crop.growing }]"
          ></div>

          <!-- Hover overlay -->
          <div class="mc-tile-hover"></div>
        </div>
      </div>

      <!-- Wooden Sign -->
      <!-- TODO: replace .mc-sign-post and .mc-sign-face with MC wood texture PNGs -->
      <div class="mc-sign-container">
        <div class="mc-sign-face">
          <div class="mc-sign-line name">Yuzhe (bkmashiro)</div>
          <div class="mc-sign-line school">Imperial College London</div>
          <div class="mc-sign-line role">Full-stack / Systems</div>
          <div class="mc-sign-line github">GitHub: bkmashiro</div>
        </div>
        <div class="mc-sign-post"></div>
      </div>
    </div>

    <!-- Physics item drops (portaled to scene root) -->
    <div class="mc-drops-layer">
      <div
        v-for="drop in activeDrops"
        :key="drop.id"
        class="mc-drop-item"
        :class="drop.type"
        :style="{
          left: drop.x + 'px',
          top: drop.y + 'px',
          transform: `rotate(${drop.angle}deg)`,
          opacity: drop.opacity,
        }"
      >
        <!-- TODO: replace with mc-wheat.png / mc-seeds.png sprite -->
        {{ drop.type === 'wheat' ? '🌾' : '🌱' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onUnmounted } from 'vue'

// ── State ────────────────────────────────────────────────────────────────────

const TOTAL_TILES = 9

const crops = reactive(
  Array.from({ length: TOTAL_TILES }, (_, i) => ({
    stage: Math.floor(Math.random() * 4), // random initial stage for visual variety
    growing: false,
  }))
)

const interacted = ref(false)
const shaking = ref(false)
let dropIdCounter = 0
const activeDrops = reactive([])

// ── Tile interaction ──────────────────────────────────────────────────────────

function handleTileClick(idx) {
  interacted.value = true
  const crop = crops[idx]

  if (crop.stage === 3) {
    harvest(idx)
  } else {
    grow(idx)
  }
}

function grow(idx) {
  const crop = crops[idx]
  crop.growing = true
  setTimeout(() => {
    crop.stage = Math.min(crop.stage + 1, 3)
    crop.growing = false
  }, 250)
}

function harvest(idx) {
  const tile = getTileCenter(idx)
  spawnDrops(tile.x, tile.y)
  triggerShake()
  crops[idx].stage = 0
}

// ── Physics drops ─────────────────────────────────────────────────────────────

function getTileCenter(idx) {
  // Scene is 400px wide; grid is 3 cols × ~80px tiles, left-padded ~20px
  const col = idx % 3
  const row = Math.floor(idx / 3)
  const TILE = 80
  const GRID_LEFT = 20
  const GRID_TOP = 20
  return {
    x: GRID_LEFT + col * TILE + TILE / 2,
    y: GRID_TOP + row * TILE + TILE / 2,
  }
}

function spawnDrops(originX, originY) {
  const count = 2 + Math.floor(Math.random() * 3) // 2-4
  for (let i = 0; i < count; i++) {
    const type = Math.random() > 0.4 ? 'wheat' : 'seeds'
    const vx = (Math.random() - 0.5) * 6
    const vy = -(4 + Math.random() * 4)
    const drop = reactive({
      id: ++dropIdCounter,
      type,
      x: originX - 8,
      y: originY - 8,
      vx,
      vy,
      angle: 0,
      angularV: (Math.random() - 0.5) * 18,
      opacity: 1,
      landed: false,
    })
    activeDrops.push(drop)
    animateDrop(drop)
  }
}

function animateDrop(drop) {
  const GRAVITY = 0.35
  const FLOOR_Y = 280 // rough scene bottom
  let frame

  function step() {
    if (drop.landed) return

    drop.vy += GRAVITY
    drop.x += drop.vx
    drop.y += drop.vy
    drop.angle += drop.angularV

    if (drop.y >= FLOOR_Y) {
      drop.y = FLOOR_Y
      drop.landed = true
      // Fade out
      fadeOut(drop)
      return
    }

    frame = requestAnimationFrame(step)
  }

  frame = requestAnimationFrame(step)

  // Cleanup guard
  onUnmounted(() => cancelAnimationFrame(frame))
}

function fadeOut(drop) {
  const FADE_STEPS = 40
  let step = 0
  let frame

  function tick() {
    step++
    drop.opacity = 1 - step / FADE_STEPS
    if (step < FADE_STEPS) {
      frame = requestAnimationFrame(tick)
    } else {
      const idx = activeDrops.findIndex((d) => d.id === drop.id)
      if (idx !== -1) activeDrops.splice(idx, 1)
    }
  }

  frame = requestAnimationFrame(tick)
  onUnmounted(() => cancelAnimationFrame(frame))
}

// ── Screen shake ──────────────────────────────────────────────────────────────

function triggerShake() {
  shaking.value = true
  setTimeout(() => (shaking.value = false), 350)
}
</script>

<style scoped>
/* ── Wrapper ─────────────────────────────────────────────────────────────── */
.mc-farm-wrapper {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  width: 420px;
  max-width: 100%;
  font-family: "Courier New", monospace;
  image-rendering: pixelated;
  user-select: none;
  margin: 1.5rem auto;
}

/* ── Hint ───────────────────────────────────────────────────────────────── */
.mc-hint {
  font-size: 11px;
  color: #a0a0a0;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 6px;
  transition: opacity 0.6s;
}
.mc-hint.hidden {
  opacity: 0;
  pointer-events: none;
}

/* ── Scene ───────────────────────────────────────────────────────────────── */
.mc-scene {
  position: relative;
  width: 420px;
  height: 310px;
  background: #1a2a1a;
  border: 3px solid #3a5a2a;
  box-shadow: 0 0 0 3px #1a3a0a, 4px 4px 0 6px #0a1a04;
  display: flex;
  align-items: flex-start;
  padding: 16px;
  gap: 16px;
  overflow: hidden;
}

/* Screen shake */
@keyframes shake {
  0%   { transform: translate(0, 0); }
  20%  { transform: translate(-3px, 2px); }
  40%  { transform: translate(3px, -2px); }
  60%  { transform: translate(-2px, 3px); }
  80%  { transform: translate(2px, -1px); }
  100% { transform: translate(0, 0); }
}
.mc-scene.shake {
  animation: shake 0.35s ease-out;
}

/* ── Farm Grid ───────────────────────────────────────────────────────────── */
.mc-farm-grid {
  display: grid;
  grid-template-columns: repeat(3, 76px);
  grid-template-rows: repeat(3, 76px);
  gap: 4px;
}

/* ── Tile ────────────────────────────────────────────────────────────────── */
.mc-tile {
  position: relative;
  width: 76px;
  height: 76px;
  cursor: pointer;
}

.mc-tile:hover .mc-tile-hover {
  opacity: 1;
}

.mc-tile-hover {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 200, 0.08);
  border: 2px solid rgba(255, 255, 200, 0.25);
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}

/* ── Farmland block ──────────────────────────────────────────────────────── */
/* TODO: swap background-color/gradient for:
   background-image: url('/mc-textures/farmland_wet.png');
   background-size: cover;
*/
.mc-farmland {
  position: absolute;
  inset: 0;
  background:
    /* top face highlight strips */
    repeating-linear-gradient(
      90deg,
      transparent 0px,
      transparent 9px,
      rgba(90, 58, 26, 0.4) 9px,
      rgba(90, 58, 26, 0.4) 10px
    ),
    repeating-linear-gradient(
      0deg,
      transparent 0px,
      transparent 9px,
      rgba(90, 58, 26, 0.3) 9px,
      rgba(90, 58, 26, 0.3) 10px
    ),
    /* base farmland color */
    #5a3a1a;
  border-bottom: 4px solid #3a2008;
  border-right: 3px solid #3a2008;
  border-top: 2px solid #7a5a2a;
  border-left: 2px solid #7a5a2a;
}

/* Grass border accent on outer edges */
.mc-tile:nth-child(1) .mc-farmland,
.mc-tile:nth-child(2) .mc-farmland,
.mc-tile:nth-child(3) .mc-farmland {
  border-top-color: #4a7a2a;
}
.mc-tile:nth-child(7) .mc-farmland,
.mc-tile:nth-child(8) .mc-farmland,
.mc-tile:nth-child(9) .mc-farmland {
  border-bottom-color: #4a7a2a;
}

/* ── Crop ────────────────────────────────────────────────────────────────── */
/* TODO: per stage, swap for sprite background:
   stage-0: url('/mc-textures/wheat_stage0.png')
   stage-1: url('/mc-textures/wheat_stage1.png')
   stage-2: url('/mc-textures/wheat_stage2.png')
   stage-3: url('/mc-textures/wheat_stage7.png')
*/
.mc-crop {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 12px;
  background: transparent;
  transition: height 0.18s ease-out, background-color 0.2s;
  image-rendering: pixelated;
}

/* Stage 0 – bare soil (just a tiny seed dot) */
.mc-crop.stage-0 {
  width: 6px;
  height: 4px;
  background: #8b6914;
  border-radius: 1px;
  bottom: 6px;
}

/* Stage 1 – sprout */
.mc-crop.stage-1 {
  width: 10px;
  height: 18px;
  background:
    linear-gradient(to top, #5a8a10 0%, #7ab820 60%, #5a8a10 100%);
  clip-path: polygon(40% 100%, 60% 100%, 70% 40%, 55% 0%, 45% 0%, 30% 40%);
}

/* Stage 2 – growing */
.mc-crop.stage-2 {
  width: 14px;
  height: 32px;
  background:
    linear-gradient(to top, #3a7010 0%, #6aaa10 50%, #b8960c 100%);
  clip-path: polygon(
    35% 100%, 65% 100%,
    70% 65%, 85% 55%, 80% 45%, 65% 50%,
    68% 20%, 55% 0%, 45% 0%, 32% 20%,
    35% 50%, 20% 45%, 15% 55%, 30% 65%
  );
}

/* Stage 3 – mature wheat */
.mc-crop.stage-3 {
  width: 20px;
  height: 50px;
  background:
    linear-gradient(to top, #5a7a10 0%, #8aaa10 30%, #d4b800 65%, #f0d700 100%);
  clip-path: polygon(
    40% 100%, 60% 100%,
    65% 70%, 80% 62%, 90% 48%, 75% 42%,
    72% 28%, 85% 18%, 78% 8%, 62% 14%,
    55% 0%, 45% 0%, 38% 14%,
    22% 8%, 15% 18%, 28% 28%,
    25% 42%, 10% 48%, 20% 62%, 35% 70%
  );
  filter: drop-shadow(0 0 4px rgba(240, 215, 0, 0.5));
}

/* Grow animation */
@keyframes pop-grow {
  0%   { transform: translateX(-50%) scale(0.7); }
  60%  { transform: translateX(-50%) scale(1.15); }
  100% { transform: translateX(-50%) scale(1); }
}
.mc-crop.growing {
  animation: pop-grow 0.25s ease-out forwards;
}

/* ── Wooden Sign ─────────────────────────────────────────────────────────── */
/* TODO: swap sign face/post for wood texture PNGs */
.mc-sign-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 8px;
  perspective: 300px;
}

.mc-sign-face {
  /* slight 3D tilt */
  transform: rotateY(-8deg);
  width: 110px;
  min-height: 80px;
  background: #c8a86a;
  border: 3px solid #8b6914;
  border-bottom: 4px solid #6b4a0a;
  border-right: 4px solid #6b4a0a;
  padding: 6px 7px;
  box-shadow: 2px 2px 0 #4a3008, inset 0 0 8px rgba(0,0,0,0.18);
  position: relative;
}

/* Faux wood grain on sign */
.mc-sign-face::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 7px,
    rgba(100, 60, 10, 0.12) 7px,
    rgba(100, 60, 10, 0.12) 8px
  );
  pointer-events: none;
}

.mc-sign-line {
  font-family: "Courier New", monospace;
  font-size: 9px;
  font-weight: bold;
  line-height: 1.6;
  color: #1a1008;
  letter-spacing: 0.5px;
  white-space: nowrap;
  position: relative; /* above ::before */
}

.mc-sign-line.name {
  font-size: 8px;
  color: #1a0a00;
  border-bottom: 1px solid rgba(0,0,0,0.2);
  padding-bottom: 2px;
  margin-bottom: 2px;
}

.mc-sign-post {
  width: 10px;
  height: 50px;
  background: linear-gradient(to right, #a07830, #c8a86a 40%, #a07830);
  border: 1px solid #6b4a0a;
}

/* ── Item Drops ──────────────────────────────────────────────────────────── */
.mc-drops-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.mc-drop-item {
  position: absolute;
  font-size: 16px;
  line-height: 1;
  will-change: transform, opacity;
}
</style>
