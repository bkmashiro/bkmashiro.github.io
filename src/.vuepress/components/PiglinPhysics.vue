<template>
  <div class="piglin-physics-layer" ref="layerRef" :style="layerStyle">
    <!-- Canvas for matter-js debug (hidden) -->
    <!-- Piglin entities rendered as absolutely positioned divs -->
    <div
      v-for="pig in piglins"
      :key="pig.id"
      class="piglin-entity"
      :style="piglinDivStyle(pig)"
      @mousedown="onMouseDown($event, pig)"
    >
      <!-- skinview3d canvas -->
      <canvas :ref="el => assignCanvas(el, pig)" class="piglin-canvas"></canvas>
      <!-- Death overlay -->
      <div v-if="pig.dead" class="piglin-dead-overlay">
        <span class="sword-drop">🗡️</span>
      </div>
      <!-- Hit flash overlay -->
      <div v-if="pig.flashing" class="piglin-flash"></div>
      <!-- Tombstone -->
      <div v-if="pig.tombstone" class="piglin-tombstone">RIP</div>
    </div>
    <!-- Tombstone message for nether death -->
    <div v-if="netherDeathMsg" class="nether-death-msg">{{ netherDeathMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'

const props = defineProps({
  // Number of piglins to spawn
  count: { type: Number, default: 1 },
  // Scene dimensions
  width: { type: Number, default: 780 },
  height: { type: Number, default: 500 },
  // Ground Y from top (bottom of scene)
  groundY: { type: Number, default: null }, // if null: height - 48
  // Portal area for cross-window easter egg
  portalArea: { type: Object, default: null }, // { x, y, w, h }
  // Scene ID: 'overworld' | 'nether'
  scene: { type: String, default: 'overworld' },
  // Initial spawn X positions (optional)
  spawnPositions: { type: Array, default: null },
})

const emit = defineEmits(['piglinEnteredPortal', 'piglinDied'])

const layerRef = ref(null)
const piglins = reactive([])
let engine = null
let world = null
let runner = null
let mouseConstraint = null
let animFrame = null
let Matter = null

const netherDeathMsg = ref('')
const canvasMap = new Map() // pig.id -> canvas element
const viewerMap = new Map() // pig.id -> SkinViewer

const PIGLIN_W = 32
const PIGLIN_H = 48
const GROUND_Y = computed(() => props.groundY ?? (props.height - 48))

const layerStyle = computed(() => ({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  overflow: 'hidden',
  zIndex: 10,
}))

function piglinDivStyle(pig) {
  const x = pig.x - PIGLIN_W / 2
  const y = pig.y - PIGLIN_H / 2
  const deg = (pig.angle * 180 / Math.PI) % 360
  const flipX = pig.vx < -0.5 ? -1 : pig.vx > 0.5 ? 1 : pig.lastFlip ?? 1
  pig.lastFlip = flipX
  return {
    position: 'absolute',
    left: x + 'px',
    top: y + 'px',
    width: PIGLIN_W + 'px',
    height: PIGLIN_H + 'px',
    transform: `rotate(${pig.dead ? 90 : deg}deg) scaleX(${flipX})`,
    transition: pig.dead ? 'transform 0.4s' : 'none',
    pointerEvents: 'auto',
    cursor: 'grab',
    filter: pig.flashing ? 'hue-rotate(300deg) saturate(3) brightness(1.5)' : 'none',
    userSelect: 'none',
  }
}

function assignCanvas(el, pig) {
  if (!el) return
  if (canvasMap.get(pig.id) === el) return
  canvasMap.set(pig.id, el)
  // Initialize skinview3d after a tick
  setTimeout(() => initViewer(pig, el), 50)
}

async function initViewer(pig, canvas) {
  try {
    const { SkinViewer, WalkingAnimation } = await import('skinview3d')
    const viewer = new SkinViewer({
      canvas,
      width: PIGLIN_W,
      height: PIGLIN_H,
      skin: 'https://minecraft.wiki/images/Piglin_texture.png',
    })
    viewer.animation = new WalkingAnimation()
    viewer.animation.speed = 0.8
    // Fallback: if texture fails, try a pink piglin skin
    viewer.loadSkin('https://minecraft.wiki/images/Piglin_texture.png').catch(() => {
      // Use a simple fallback skin color
    })
    viewerMap.set(pig.id, viewer)
  } catch (e) {
    // skinview3d might not work in SSR; silently ignore
  }
}

async function init() {
  // Dynamic import to avoid SSR issues
  Matter = await import('matter-js')
  const { Engine, World, Bodies, Body, Runner, Events, MouseConstraint: MC, Mouse } = Matter

  engine = Engine.create({ gravity: { y: 1.5 } })
  world = engine.world

  const groundY = GROUND_Y.value
  const W = props.width
  const H = props.height

  // Static bodies
  const ground = Bodies.rectangle(W / 2, groundY + 24, W, 48, { isStatic: true, label: 'ground' })
  const wallL = Bodies.rectangle(-24, H / 2, 48, H, { isStatic: true, label: 'wallL' })
  const wallR = Bodies.rectangle(W + 24, H / 2, 48, H, { isStatic: true, label: 'wallR' })

  World.add(world, [ground, wallL, wallR])

  // Spawn piglins
  const positions = props.spawnPositions || Array.from({ length: props.count }, (_, i) =>
    (i + 1) * W / (props.count + 1)
  )

  for (let i = 0; i < props.count; i++) {
    const spawnX = positions[i] ?? W / 2
    const body = Bodies.rectangle(spawnX, groundY - PIGLIN_H, PIGLIN_W, PIGLIN_H, {
      restitution: 0.3,
      friction: 0.8,
      frictionAir: 0.02,
      label: `piglin-${i}`,
    })
    World.add(world, body)

    const pig = reactive({
      id: i,
      body,
      x: spawnX,
      y: groundY - PIGLIN_H / 2,
      angle: 0,
      vx: 0,
      vy: 0,
      lastFlip: 1,
      hitCount: 0,
      dead: false,
      flashing: false,
      tombstone: false,
      walkTimer: null,
    })
    piglins.push(pig)
    scheduleWalk(pig)
  }

  // Mouse constraint
  if (layerRef.value) {
    const mouse = Mouse.create(layerRef.value)
    mouseConstraint = MC.create(engine, {
      mouse,
      constraint: { stiffness: 0.2, render: { visible: false } },
    })
    World.add(world, mouseConstraint)
  }

  // Check for incoming piglins from localStorage/BroadcastChannel
  checkNetherSync()

  // Game loop
  let last = performance.now()
  function loop(now) {
    const dt = Math.min(now - last, 32)
    last = now
    Engine.update(engine, 1000 / 60)
    syncPiglins()
    checkPortalCollision()
    animFrame = requestAnimationFrame(loop)
  }
  animFrame = requestAnimationFrame(loop)
}

function syncPiglins() {
  for (const pig of piglins) {
    if (pig.dead) continue
    pig.x = pig.body.position.x
    pig.y = pig.body.position.y
    pig.angle = pig.body.angle
    pig.vx = pig.body.velocity.x
    pig.vy = pig.body.velocity.y

    // Update skinview3d viewer speed based on velocity
    const viewer = viewerMap.get(pig.id)
    if (viewer?.animation) {
      const speed = Math.abs(pig.vx) / 3
      viewer.animation.speed = 0.3 + speed
    }
  }
}

function scheduleWalk(pig) {
  if (pig.dead) return
  const delay = 2000 + Math.random() * 2000
  pig.walkTimer = setTimeout(() => {
    if (!pig.dead && pig.body) {
      const force = (Math.random() - 0.5) * 0.004
      Matter.Body.applyForce(pig.body, pig.body.position, { x: force, y: 0 })
    }
    scheduleWalk(pig)
  }, delay)
}

// ── Click / Attack ─────────────────────────────────────────────────────────────
const mouseDownPos = new Map()

function onMouseDown(e, pig) {
  if (pig.dead) return
  mouseDownPos.set(pig.id, { x: e.clientX, y: e.clientY })

  const onUp = (ev) => {
    const down = mouseDownPos.get(pig.id)
    if (down) {
      const dx = ev.clientX - down.x
      const dy = ev.clientY - down.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 5) {
        attackPiglin(pig)
      }
    }
    mouseDownPos.delete(pig.id)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mouseup', onUp)
}

function attackPiglin(pig) {
  if (pig.dead) return

  // Flash red
  pig.flashing = true
  setTimeout(() => { pig.flashing = false }, 300)

  // Impulse: upward + random horizontal
  const fx = (Math.random() - 0.5) * 0.015
  const fy = -0.03
  Matter.Body.applyForce(pig.body, pig.body.position, { x: fx, y: fy })

  pig.hitCount++
  if (pig.hitCount >= 5) {
    killPiglin(pig)
  }
}

function killPiglin(pig) {
  if (pig.dead) return
  pig.dead = true
  Matter.Body.setStatic(pig.body, true)

  // Drop golden sword
  emit('piglinDied', { id: pig.id, x: pig.x, y: pig.y })

  // Notify nether if in nether scene
  if (props.scene === 'nether') {
    broadcastChannel?.postMessage({ type: 'piglin_died_in_nether', piglinId: pig.id })
    netherDeathMsg.value = ''
  }

  // Respawn after 5s
  setTimeout(() => respawnPiglin(pig), 5000)
}

function respawnPiglin(pig) {
  const W = props.width
  const groundY = GROUND_Y.value
  const side = Math.random() > 0.5 ? 60 : W - 60
  Matter.Body.setStatic(pig.body, false)
  Matter.Body.setPosition(pig.body, { x: side, y: groundY - PIGLIN_H })
  Matter.Body.setVelocity(pig.body, { x: 0, y: 0 })
  Matter.Body.setAngle(pig.body, 0)
  pig.dead = false
  pig.hitCount = 0
  pig.tombstone = false
  scheduleWalk(pig)
}

// ── Portal collision ──────────────────────────────────────────────────────────
function checkPortalCollision() {
  if (!props.portalArea) return
  const { x, y, w, h } = props.portalArea
  for (const pig of piglins) {
    if (pig.dead) continue
    if (pig.x >= x && pig.x <= x + w && pig.y >= y && pig.y <= y + h) {
      sendPiglinToNether(pig)
    }
  }
}

function sendPiglinToNether(pig) {
  const data = { health: 5 - pig.hitCount, name: `Piglin-${pig.id + 1}`, enteredAt: Date.now() }
  localStorage.setItem('piglin_in_nether', JSON.stringify(data))
  broadcastChannel?.postMessage({ type: 'piglin_enter', piglinData: data })
  emit('piglinEnteredPortal', data)
  // Remove this piglin temporarily (it went to nether)
  killPiglin(pig)
}

// ── BroadcastChannel ──────────────────────────────────────────────────────────
let broadcastChannel = null

function checkNetherSync() {
  try {
    broadcastChannel = new BroadcastChannel('kotodama-nether')

    if (props.scene === 'overworld') {
      broadcastChannel.onmessage = (e) => {
        if (e.data.type === 'piglin_died_in_nether') {
          netherDeathMsg.value = 'Your piglin died in the Nether...'
          // Show tombstone near portal
          setTimeout(() => { netherDeathMsg.value = '' }, 5000)
        }
      }
    }

    if (props.scene === 'nether') {
      // Check localStorage for incoming piglin
      try {
        const stored = localStorage.getItem('piglin_in_nether')
        if (stored) {
          const data = JSON.parse(stored)
          // Piglin already arrived — it's handled by having count piglins spawned at portal side
          localStorage.removeItem('piglin_in_nether')
        }
      } catch (_) {}

      broadcastChannel.onmessage = (e) => {
        if (e.data.type === 'piglin_enter') {
          spawnNetherPiglin(e.data.piglinData)
        }
      }
    }
  } catch (_) {
    // BroadcastChannel not available
  }
}

function spawnNetherPiglin(piglinData) {
  if (!Matter || !world) return
  // Spawn at portal position (left side of nether scene)
  const spawnX = 80
  const groundY = GROUND_Y.value
  const body = Matter.Bodies.rectangle(spawnX, groundY - PIGLIN_H, PIGLIN_W, PIGLIN_H, {
    restitution: 0.3,
    friction: 0.8,
    frictionAir: 0.02,
    label: `piglin-nether-extra`,
  })
  Matter.World.add(world, body)

  const pig = reactive({
    id: Date.now(),
    body,
    x: spawnX,
    y: groundY - PIGLIN_H / 2,
    angle: 0,
    vx: 2,
    vy: 0,
    lastFlip: 1,
    hitCount: piglinData.health ? (5 - piglinData.health) : 0,
    dead: false,
    flashing: false,
    tombstone: false,
    walkTimer: null,
  })
  piglins.push(pig)
  // Give it an initial push to walk in
  Matter.Body.applyForce(body, body.position, { x: 0.005, y: 0 })
  scheduleWalk(pig)
}

onMounted(() => {
  init()
})

onUnmounted(() => {
  if (animFrame) cancelAnimationFrame(animFrame)
  for (const pig of piglins) {
    if (pig.walkTimer) clearTimeout(pig.walkTimer)
  }
  broadcastChannel?.close()
  for (const [, viewer] of viewerMap) {
    try { viewer.dispose() } catch (_) {}
  }
  if (engine) Matter.Engine.clear(engine)
})
</script>

<style scoped>
.piglin-physics-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}

.piglin-entity {
  position: absolute;
  pointer-events: auto;
}

.piglin-canvas {
  display: block;
  image-rendering: pixelated;
  width: 32px;
  height: 48px;
}

.piglin-dead-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.sword-drop {
  animation: sword-fall 0.5s ease-in forwards;
  display: block;
}
@keyframes sword-fall {
  from { transform: translateY(-10px) rotate(-45deg); opacity: 1; }
  to   { transform: translateY(8px) rotate(0deg); opacity: 0.7; }
}

.piglin-flash {
  position: absolute;
  inset: 0;
  background: rgba(255, 0, 0, 0.5);
  pointer-events: none;
  border-radius: 2px;
}

.piglin-tombstone {
  position: absolute;
  bottom: -20px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8px;
  color: #ccc;
  background: #444;
  padding: 1px 3px;
  border: 1px solid #888;
  white-space: nowrap;
  font-family: monospace;
}

.nether-death-msg {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #ff4444;
  font-family: "Courier New", monospace;
  font-size: 12px;
  padding: 8px 16px;
  border: 2px solid #aa2222;
  white-space: nowrap;
  z-index: 20;
  animation: tombstone-appear 0.3s ease-out;
}
@keyframes tombstone-appear {
  from { opacity: 0; transform: translateX(-50%) scale(0.8); }
  to   { opacity: 1; transform: translateX(-50%) scale(1); }
}
</style>
