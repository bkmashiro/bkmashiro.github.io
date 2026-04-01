<template>
  <div class="nether-wrapper">
    <!-- Ceiling glowstone clusters -->
    <div class="nether-ceiling">
      <div v-for="g in glowstones" :key="g.id" class="glowstone-cluster" :style="g.style">
        <img v-if="texGlowstone" :src="texGlowstone" class="glowstone-tex" alt="glowstone" />
        <div v-else class="glowstone-fallback"></div>
        <div class="glowstone-light" :style="{ animationDelay: g.delay }"></div>
      </div>
      <!-- Lava drips -->
      <div v-for="d in lavaDrops" :key="d.id" class="lava-drip" :style="d.style"></div>
    </div>

    <!-- Main content area -->
    <div class="nether-content">
      <div class="soulsand-panel">
        <div class="panel-header">🔥 You Found the Nether 🔥</div>
        <div class="panel-sub">Not many visitors make it here.</div>
        <div class="panel-sub">You mined obsidian, crafted tools,</div>
        <div class="panel-sub">and lit the portal yourself.</div>

        <div class="panel-divider">━━━━━━━━━━━━━━━━━━━━━━━━</div>

        <div class="panel-section-title">[ About Yuzhe ]</div>
        <div class="panel-info">Imperial College London — MEng Computing</div>
        <div class="panel-info muted">Building things that shouldn't work but do.</div>

        <div class="panel-divider short">──────────</div>

        <div class="panel-skill">⛏️  Languages: TypeScript, Rust, Python, Swift</div>
        <div class="panel-skill">🧱  Currently: kotodama · visual-cs · AVM</div>
        <div class="panel-skill">🌐  <a href="https://github.com/bkmashiro" target="_blank" rel="noopener" class="nether-link">github.com/bkmashiro</a></div>
        <div class="panel-skill">📬  <a href="mailto:bkmashiro@gmail.com" class="nether-link">bkmashiro@gmail.com</a></div>

        <div class="panel-divider">━━━━━━━━━━━━━━━━━━━━━━━━</div>

        <div class="panel-quote">"There are only 2 hard problems in CS:</div>
        <div class="panel-quote"> cache invalidation, naming things,</div>
        <div class="panel-quote"> and off-by-one errors."</div>

        <div class="panel-divider short">──────────</div>

        <a href="/" class="return-btn">← Return to Overworld</a>
      </div>

      <!-- Piglin physics layer -->
      <div class="piglin-physics-wrapper" ref="netherSceneRef">
        <PiglinPhysics
          v-if="piglinReady"
          :count="2"
          :width="netherWidth"
          :height="netherHeight"
          :ground-y="netherGroundY"
          :spawn-positions="[netherWidth * 0.3, netherWidth * 0.7]"
          scene="nether"
        />
      </div>
    </div>

    <!-- Lava pool at bottom -->
    <div class="lava-pool">
      <div class="lava-wave"></div>
      <div class="lava-surface">
        <div v-for="b in lavaBubbles" :key="b.id" class="lava-bubble" :style="b.style"></div>
      </div>
    </div>

    <!-- Netherrack floor -->
    <div class="nether-floor">
      <div v-for="i in floorTiles" :key="i" class="floor-tile">
        <img v-if="texNetherrack" :src="texNetherrack" class="floor-tex" alt="netherrack" />
        <div v-else class="floor-fallback"></div>
      </div>
    </div>

    <!-- Fire animations -->
    <div v-for="f in fires" :key="f.id" class="fire-sprite" :style="f.style">
      <div class="fire-inner" :style="{ animationDelay: f.delay }"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import PiglinPhysics from './PiglinPhysics.vue'

const texGlowstone = ref(null)
const texNetherrack = ref(null)

import('minecraft-textures/dist/textures/json/1.20.id.json').then(mod => {
  const data = mod.default || mod
  const items = data.items
  texGlowstone.value = items['minecraft:glowstone']?.texture || null
  texNetherrack.value = items['minecraft:netherrack']?.texture || null
}).catch(() => {})

// Glowstone clusters
const glowstones = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  style: { left: (5 + i * 12) + '%', top: (Math.random() * 30) + 'px' },
  delay: (Math.random() * 2) + 's',
}))

// Lava drips
const lavaDrops = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  style: {
    left: (3 + i * 8) + '%',
    animationDelay: (Math.random() * 3) + 's',
    animationDuration: (1.5 + Math.random() * 2) + 's',
  },
}))

// Lava bubbles
const lavaBubbles = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  style: {
    left: (5 + i * 12) + '%',
    animationDelay: (Math.random() * 3) + 's',
    animationDuration: (2 + Math.random() * 2) + 's',
  },
}))

// Floor tiles
const floorTiles = 20

// Fire sprites
const fires = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  style: { left: (4 + i * 16) + '%', bottom: '60px' },
  delay: (Math.random() * 1) + 's',
}))

// Piglin physics
const netherSceneRef = ref(null)
const piglinReady = ref(false)
const netherWidth = ref(400)
const netherHeight = ref(400)
const netherGroundY = ref(320)

onMounted(() => {
  if (netherSceneRef.value) {
    netherWidth.value = netherSceneRef.value.offsetWidth || 400
    netherHeight.value = netherSceneRef.value.offsetHeight || 400
    netherGroundY.value = (netherSceneRef.value.offsetHeight || 400) - 60
  }
  piglinReady.value = true
})

onUnmounted(() => {})
</script>

<style scoped>
.nether-wrapper {
  min-height: 100vh;
  background: linear-gradient(to bottom, #1a0000 0%, #2d0500 40%, #3d0a00 70%, #1a0000 100%);
  position: relative;
  overflow: hidden;
  font-family: "Courier New", monospace;
  image-rendering: pixelated;
  display: flex;
  flex-direction: column;
}

/* ══ Ceiling ════════════════════════════════════════════════════════════════ */
.nether-ceiling {
  height: 80px;
  background: #0d0000;
  position: relative;
  border-bottom: 3px solid #3d0a00;
  flex-shrink: 0;
}

.glowstone-cluster {
  position: absolute;
  top: 10px;
  width: 32px; height: 32px;
}
.glowstone-tex {
  width: 32px; height: 32px;
  image-rendering: pixelated;
  display: block;
}
.glowstone-fallback {
  width: 32px; height: 32px;
  background: #d4a800;
  border: 2px solid #a07800;
}
.glowstone-light {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,200,50,0.3) 0%, transparent 70%);
  animation: gs-pulse 2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes gs-pulse {
  0%, 100% { opacity: 0.6; transform: scale(0.9); }
  50%       { opacity: 1;   transform: scale(1.1); }
}

/* Lava drips */
.lava-drip {
  position: absolute;
  top: 0;
  width: 4px;
  height: 0;
  background: linear-gradient(to bottom, #ff6600, #ff3300);
  border-radius: 0 0 3px 3px;
  animation: drip-fall linear infinite;
}
@keyframes drip-fall {
  0%   { height: 0; opacity: 1; top: 0; }
  70%  { height: 40px; opacity: 1; }
  90%  { height: 50px; opacity: 0.5; top: 30px; }
  100% { height: 0; opacity: 0; top: 80px; }
}

/* ══ Content ════════════════════════════════════════════════════════════════ */
.nether-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 40px;
  padding: 40px 20px;
  position: relative;
  z-index: 2;
}

.soulsand-panel {
  background: #1a120a;
  border: 3px solid #4a3020;
  box-shadow: 0 0 20px rgba(255,60,0,0.2), inset 0 0 20px rgba(0,0,0,0.5);
  padding: 24px 28px;
  max-width: 480px;
  width: 100%;
}

.panel-header {
  font-size: 18px;
  color: #ff6600;
  font-weight: bold;
  text-align: center;
  margin-bottom: 8px;
  text-shadow: 0 0 10px rgba(255,100,0,0.6);
  letter-spacing: 1px;
}
.panel-sub {
  font-size: 11px;
  color: #cc8844;
  text-align: center;
  line-height: 1.8;
}
.panel-divider {
  color: #6a4020;
  text-align: center;
  margin: 12px 0;
  font-size: 10px;
  letter-spacing: 1px;
}
.panel-divider.short { margin: 8px 0; }

.panel-section-title {
  font-size: 13px;
  color: #ffaa44;
  font-weight: bold;
  text-align: center;
  margin-bottom: 8px;
  letter-spacing: 2px;
}
.panel-info {
  font-size: 11px;
  color: #ddaa66;
  text-align: center;
  line-height: 1.8;
}
.panel-info.muted { color: #886644; font-style: italic; }

.panel-skill {
  font-size: 10px;
  color: #cc9944;
  line-height: 2;
  padding-left: 8px;
}

.panel-quote {
  font-size: 10px;
  color: #aa7733;
  font-style: italic;
  text-align: center;
  line-height: 1.7;
}

.nether-link {
  color: #ff8844;
  text-decoration: none;
}
.nether-link:hover { color: #ffcc66; text-decoration: underline; }

.return-btn {
  display: block;
  text-align: center;
  padding: 8px 20px;
  background: #3a1a00;
  border: 2px solid #884400;
  color: #ffaa44;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  text-decoration: none;
  letter-spacing: 1px;
  margin-top: 12px;
  transition: filter 0.1s, background 0.1s;
}
.return-btn:hover { filter: brightness(1.3); background: #4a2800; }

/* ══ Piglin ═════════════════════════════════════════════════════════════════ */
.piglin-physics-wrapper {
  position: relative;
  width: 200px;
  min-height: 360px;
  flex-shrink: 0;
}

/* Legacy CSS piglin (kept as reference, not rendered) */
.piglin-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 20px;
}
.piglin {
  position: relative;
  width: 32px;
  transition: transform 0.3s;
}
.piglin-flip { transform: scaleX(-1); }

.piglin-head {
  width: 24px; height: 20px;
  background: #c87040;
  border: 2px solid #8a4820;
  margin: 0 auto;
  position: relative;
}
.piglin-head::before {
  content: '';
  position: absolute;
  bottom: 3px; left: 4px;
  width: 5px; height: 5px;
  background: #1a0a00;
  box-shadow: 10px 0 0 #1a0a00;
}
.piglin-head::after {
  content: '';
  position: absolute;
  top: -6px; left: 50%;
  transform: translateX(-50%);
  width: 14px; height: 6px;
  background: #c87040;
  border: 2px solid #8a4820;
  border-bottom: none;
}

.piglin-body {
  width: 20px; height: 22px;
  background: #8a4820;
  border: 2px solid #5a2808;
  margin: 0 auto;
  position: relative;
}
.piglin-body::before {
  content: '';
  position: absolute;
  inset: 3px 4px;
  background: #aa5828;
}

.piglin-legs {
  display: flex;
  justify-content: center;
  gap: 2px;
  margin-top: 1px;
}
.piglin-leg {
  width: 8px; height: 18px;
  background: #8a4820;
  border: 1px solid #5a2808;
  transform-origin: top center;
  transition: transform 0.3s;
}
.piglin-leg.left.walk  { animation: leg-walk-l 0.6s ease-in-out infinite; }
.piglin-leg.right.walk { animation: leg-walk-r 0.6s ease-in-out infinite; }
@keyframes leg-walk-l {
  0%, 100% { transform: rotate(-15deg); }
  50%       { transform: rotate(15deg); }
}
@keyframes leg-walk-r {
  0%, 100% { transform: rotate(15deg); }
  50%       { transform: rotate(-15deg); }
}

.piglin-arms {
  position: absolute;
  top: 22px;
  width: 32px;
  display: flex;
  justify-content: space-between;
}
.piglin-arm {
  width: 6px; height: 16px;
  background: #c87040;
  border: 1px solid #8a4820;
}
.piglin-arm.left-arm { transform-origin: top center; animation: arm-sway-l 1.2s ease-in-out infinite; }
.piglin-arm.right-arm { transform-origin: top center; animation: arm-sway-r 1.2s ease-in-out infinite; }
@keyframes arm-sway-l {
  0%, 100% { transform: rotate(10deg); }
  50%       { transform: rotate(-10deg); }
}
@keyframes arm-sway-r {
  0%, 100% { transform: rotate(-10deg); }
  50%       { transform: rotate(10deg); }
}

/* ══ Lava pool ══════════════════════════════════════════════════════════════ */
.lava-pool {
  height: 60px;
  background: linear-gradient(to bottom, #ff4400 0%, #cc2200 40%, #881100 100%);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  z-index: 1;
}
.lava-wave {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0, transparent 20px,
    rgba(255,100,0,0.3) 20px, rgba(255,100,0,0.3) 22px
  );
  animation: lava-flow 3s linear infinite;
}
@keyframes lava-flow {
  from { transform: translateX(0); }
  to   { transform: translateX(-22px); }
}
.lava-surface {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 20px;
}
.lava-bubble {
  position: absolute;
  width: 8px; height: 8px;
  background: #ff8800;
  border-radius: 50%;
  animation: bubble-rise ease-in-out infinite;
  bottom: 0;
}
@keyframes bubble-rise {
  0%   { transform: translateY(0) scale(1); opacity: 0.8; }
  80%  { transform: translateY(-14px) scale(1.3); opacity: 0.6; }
  100% { transform: translateY(-18px) scale(0.5); opacity: 0; }
}

/* ══ Floor ══════════════════════════════════════════════════════════════════ */
.nether-floor {
  display: flex;
  flex-shrink: 0;
  height: 32px;
  overflow: hidden;
}
.floor-tile {
  width: 32px; height: 32px;
  flex-shrink: 0;
  position: relative;
}
.floor-tex {
  width: 32px; height: 32px;
  image-rendering: pixelated;
  display: block;
}
.floor-fallback {
  width: 32px; height: 32px;
  background:
    repeating-linear-gradient(90deg, transparent 0, transparent 7px, rgba(80,10,10,0.4) 7px, rgba(80,10,10,0.4) 8px),
    repeating-linear-gradient(0deg, transparent 0, transparent 7px, rgba(80,10,10,0.4) 7px, rgba(80,10,10,0.4) 8px),
    #6a1a0a;
}

/* ══ Fire sprites ═══════════════════════════════════════════════════════════ */
.fire-sprite {
  position: absolute;
  width: 16px; height: 24px;
  z-index: 3;
}
.fire-inner {
  width: 100%; height: 100%;
  background: linear-gradient(to top, #ff4400 0%, #ffaa00 50%, transparent 100%);
  clip-path: polygon(50% 0%, 80% 30%, 95% 70%, 75% 100%, 25% 100%, 5% 70%, 20% 30%);
  animation: fire-flicker 0.4s ease-in-out infinite alternate;
}
@keyframes fire-flicker {
  0%   { transform: scaleX(1)   scaleY(1)   skewX(0deg); opacity: 0.9; }
  33%  { transform: scaleX(0.9) scaleY(1.1) skewX(3deg); opacity: 1; }
  66%  { transform: scaleX(1.1) scaleY(0.95) skewX(-2deg); opacity: 0.85; }
  100% { transform: scaleX(0.95) scaleY(1.05) skewX(1deg); opacity: 0.95; }
}
</style>
