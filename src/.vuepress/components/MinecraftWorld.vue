<template>
  <div class="mcw-wrapper" ref="wrapperRef">
    <!-- Hint -->
    <div class="mcw-hint" :class="{ hidden: interacted }">Click to interact</div>

    <!-- Three.js canvas -->
    <div class="mcw-canvas-container">
      <canvas ref="threeCanvas" class="mcw-three-canvas"></canvas>
      <!-- Piglin skinview3d overlay canvas -->
      <canvas
        ref="piglinCanvas"
        class="mcw-piglin-canvas"
        :style="piglinCanvasStyle"
        @mousedown="onPiglinMouseDown"
      ></canvas>
      <!-- Nether death message -->
      <div v-if="netherDeathMsg" class="nether-death-msg">{{ netherDeathMsg }}</div>
    </div>

    <!-- ══ CRAFTING OVERLAY ══ -->
    <div class="mcw-overlay" v-if="craftingOpen" @click.self="craftingOpen = false">
      <div class="mcw-crafting-ui">
        <div class="cui-title">Crafting Table</div>
        <div class="cui-tabs">
          <div class="cui-tab" :class="{ active: craftTab === 'bread' }" @click="craftTab = 'bread'">🍞 Bread</div>
          <div class="cui-tab" :class="{ active: craftTab === 'pickaxe' }" @click="craftTab = 'pickaxe'">⛏️ Pickaxe</div>
          <div class="cui-tab" :class="{ active: craftTab === 'flint' }" @click="craftTab = 'flint'">🔥 Flint&amp;Steel</div>
        </div>

        <template v-if="craftTab === 'bread'">
          <div class="cui-recipe-hint">Recipe: 3+ wheat</div>
          <div class="cui-grid">
            <div v-for="(slot, i) in craftSlots" :key="i" class="cui-slot" :class="{ filled: slot }">
              {{ slot ? '🌾' : '' }}
            </div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: craftReady }"><span v-if="craftReady">🍞</span></div>
          <div class="cui-btn" @click="doCraft">Craft</div>
        </template>

        <template v-if="craftTab === 'pickaxe'">
          <div class="cui-recipe-hint">Recipe: 2 diamonds (top row) + 1 wood (bottom-right)</div>
          <div class="cui-grid2x2">
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[0] }" @click="togglePickaxeSlot(0)">
              <span v-if="pickaxeSlots[0]">💎</span>
              <span v-else class="slot-hint">{{ inventory.diamond ? '💎?' : '' }}</span>
            </div>
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[1] }" @click="togglePickaxeSlot(1)">
              <span v-if="pickaxeSlots[1]">💎</span>
            </div>
            <div class="cui-slot2"></div>
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[3] }" @click="togglePickaxeSlot(3)">
              <span v-if="pickaxeSlots[3]">🪵</span>
            </div>
          </div>
          <div class="cui-recipe-legend">
            <div>Slots 0,1: diamond (have: {{ inventory.diamond || 0 }})</div>
            <div>Slot 3: wood (have: {{ inventory.wood || 0 }})</div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: pickaxeReady }"><span v-if="pickaxeReady">⛏️</span></div>
          <div class="cui-btn" @click="craftPickaxe">Craft Pickaxe</div>
        </template>

        <template v-if="craftTab === 'flint'">
          <div class="cui-recipe-hint">Recipe: flint (top-left) + iron ingot (bottom-right)</div>
          <div class="cui-grid2x2">
            <div class="cui-slot2" :class="{ filled: flintSlots[0] }" @click="toggleFlintSlot(0)">
              <span v-if="flintSlots[0]">🪨</span>
            </div>
            <div class="cui-slot2"></div>
            <div class="cui-slot2"></div>
            <div class="cui-slot2" :class="{ filled: flintSlots[3] }" @click="toggleFlintSlot(3)">
              <span v-if="flintSlots[3]">⚙️</span>
            </div>
          </div>
          <div class="cui-recipe-legend">
            <div>Slot 0: flint (have: {{ inventory.flint || 0 }})</div>
            <div>Slot 3: iron ingot (have: {{ inventory.iron || 0 }})</div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: flintReady }"><span v-if="flintReady">🔥</span></div>
          <div class="cui-btn" @click="craftFlintSteel">Craft Flint &amp; Steel</div>
        </template>

        <div class="cui-msg" v-if="craftMsg">{{ craftMsg }}</div>
        <div class="cui-close" @click="craftingOpen = false">✕</div>
      </div>
    </div>

    <!-- ══ HOTBAR ══ -->
    <div class="mcw-hotbar">
      <div
        v-for="item in hotbarItems"
        :key="item.key"
        class="hotbar-slot"
        :class="{ equipped: equippedItem === item.key }"
        @click="equipItem(item.key)"
        :title="item.label + (inventory[item.key] ? ' (x' + inventory[item.key] + ')' : '')"
      >
        <span>{{ item.icon }}</span>
        <div class="hotbar-count" v-if="inventory[item.key] > 0">{{ inventory[item.key] }}</div>
      </div>
      <div class="hotbar-equipped-label" v-if="equippedItem">
        Equipped: {{ hotbarItems.find(i => i.key === equippedItem)?.label }}
      </div>
    </div>

    <!-- Portal activation hint -->
    <div class="portal-activate-hint" v-if="portalFrameComplete && !portalActive && equippedItem === 'flintSteel'">
      🔥 Click the portal interior to light it!
    </div>

    <!-- TNT Crater message -->
    <div class="mcw-crater" :class="{ visible: craterVisible }">
      <div class="crater-msg">
        <div>💥 You found a secret!</div>
        <div class="crater-quote">"There are only two hard things</div>
        <div class="crater-quote"> in CS: cache invalidation,</div>
        <div class="crater-quote"> naming things, and off-by-one errors."</div>
      </div>
    </div>

    <!-- Physics drops layer (emoji overlays) -->
    <div class="mcw-drops-layer">
      <div
        v-for="drop in activeDrops"
        :key="drop.id"
        class="mcw-drop-item"
        :style="{
          left: drop.x + 'px',
          top: drop.y + 'px',
          transform: `rotate(${drop.angle}deg)`,
          opacity: drop.opacity,
          fontSize: drop.size + 'px',
        }"
      >{{ drop.icon }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'

// ── Refs ──────────────────────────────────────────────────────────────────────
const wrapperRef = ref(null)
const threeCanvas = ref(null)
const piglinCanvas = ref(null)
const interacted = ref(false)

// ── Three.js internals ────────────────────────────────────────────────────────
let renderer = null
let scene = null
let camera = null
let animFrameId = null
let clock = null
let portalMat = null   // shader material for portal swirl
let redstoneLight = null
const interactableObjects = []
const objectMeta = new WeakMap() // mesh -> { type, idx }

// Camera parallax
let targetOffsetX = 0, targetOffsetY = 0
const basePos = { x: 10, y: 12, z: 10 }

// Camera shake
let shakeTime = 0

// ── Textures ──────────────────────────────────────────────────────────────────
const loadedTextures = {}

function loadBlockTexture(name) {
  if (loadedTextures[name]) return loadedTextures[name]
  const tex = new THREE.Texture()
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  loadedTextures[name] = tex
  return tex
}

async function initTextures() {
  try {
    const mod = await import('minecraft-textures/dist/textures/json/1.20.json')
    const data = mod.default || mod
    const blocks = data.blocks || {}

    const blockNames = [
      'grass_block_top', 'grass_block_side', 'dirt', 'stone', 'obsidian',
      'crafting_table_top', 'crafting_table_front', 'netherrack', 'glowstone',
      'farmland_moist', 'wheat_stage7', 'oak_planks', 'oak_log_top', 'oak_log',
      'oak_leaves', 'tnt_side', 'tnt_top', 'sand',
    ]
    for (const name of blockNames) {
      const b64 = blocks[name]
      if (!b64) continue
      const tex = loadBlockTexture(name)
      const img = new Image()
      img.src = b64
      img.onload = () => { tex.image = img; tex.needsUpdate = true }
    }

    // Also load item textures for hotbar display
    try {
      const itemMod = await import('minecraft-textures/dist/textures/json/1.20.id.json')
      const itemData = itemMod.default || itemMod
      const items = itemData.items || {}
      const get = (id) => items['minecraft:' + id]?.texture || null
      hotbarTexData.diamond = get('diamond')
      hotbarTexData.obsidian = get('obsidian')
    } catch (_) {}
  } catch (e) {
    // textures unavailable; blocks will use fallback colors
  }
}

const hotbarTexData = reactive({ diamond: null, obsidian: null })

// ── Block factory ─────────────────────────────────────────────────────────────
function makeBlock(texOrColor, x, y, z) {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  let mat
  if (Array.isArray(texOrColor)) {
    mat = texOrColor.map(t =>
      typeof t === 'number'
        ? new THREE.MeshLambertMaterial({ color: t })
        : new THREE.MeshLambertMaterial({ map: t })
    )
  } else if (typeof texOrColor === 'number') {
    mat = new THREE.MeshLambertMaterial({ color: texOrColor })
  } else {
    mat = new THREE.MeshLambertMaterial({ map: texOrColor })
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function makeGrassBlock(x, y, z) {
  const top = loadBlockTexture('grass_block_top')
  const side = loadBlockTexture('grass_block_side')
  const dirt = loadBlockTexture('dirt')
  // +x, -x, +y, -y, +z, -z
  return makeBlock([side, side, top, dirt, side, side], x, y, z)
}

function makeDirtBlock(x, y, z) {
  return makeBlock(loadBlockTexture('dirt'), x, y, z)
}

function makeStoneBlock(x, y, z) {
  return makeBlock(loadBlockTexture('stone'), x, y, z)
}

function makeObsidianBlock(x, y, z) {
  const m = makeBlock(loadBlockTexture('obsidian'), x, y, z)
  m.userData.type = 'obsidian'
  return m
}

function makeOakLog(x, y, z) {
  const top = loadBlockTexture('oak_log_top')
  const side = loadBlockTexture('oak_log')
  return makeBlock([side, side, top, top, side, side], x, y, z)
}

function makeFarmland(x, y, z) {
  const tex = loadBlockTexture('farmland_moist')
  return makeBlock([loadBlockTexture('dirt'), loadBlockTexture('dirt'), tex, loadBlockTexture('dirt'), loadBlockTexture('dirt'), loadBlockTexture('dirt')], x, y, z)
}

// ── Scene meshes registry ────────────────────────────────────────────────────
const cropMeshes = []      // 9 crop sprites
const obsidianMeshes = []  // mineable obsidian meshes
const portalFrameMeshes = [] // frame obsidian
const portalInnerMesh = { mesh: null }
const craftingMesh = { mesh: null }
const leverMesh = { arm: null }
const redstoneMeshes = []
const pistonMesh = { head: null, body: null }

// ── State ────────────────────────────────────────────────────────────────────
const crops = reactive(
  Array.from({ length: 9 }, () => ({ stage: Math.floor(Math.random() * 4) }))
)
let harvestCount = ref(0)

const inventory = reactive({
  wheat: 0, diamond: 0, obsidian: 0,
  wood: 5, flint: 1, iron: 1,
  pickaxe: 0, flintSteel: 0,
})

const equippedItem = ref(null)
const hotbarItems = computed(() => {
  const items = []
  if (inventory.diamond > 0)    items.push({ key: 'diamond',    icon: '💎', label: 'Diamond' })
  if (inventory.obsidian > 0)   items.push({ key: 'obsidian',   icon: '⬛', label: 'Obsidian' })
  if (inventory.pickaxe > 0)    items.push({ key: 'pickaxe',    icon: '⛏️', label: 'Diamond Pickaxe' })
  if (inventory.flintSteel > 0) items.push({ key: 'flintSteel', icon: '🔥', label: 'Flint & Steel' })
  if (inventory.wheat > 0)      items.push({ key: 'wheat',      icon: '🌾', label: 'Wheat' })
  return items
})
const hasPickaxe = computed(() => inventory.pickaxe > 0)
function equipItem(key) { equippedItem.value = equippedItem.value === key ? null : key }

// Sign
const signMessages = [
  ['Yuzhe / bkmashiro', 'Imperial College London', 'Full-stack · Systems · AI', 'github.com/bkmashiro'],
  ['Currently:', 'debugging at 2am', '☕ send help', ''],
  ['Status:', 'building cool stuff', '🔨 always', ''],
  ['Skills:', 'TypeScript > sleep', 'CSS > sanity', ''],
  ['Fun fact:', 'made a Minecraft', 'widget instead of', 'touching grass'],
]
const signIdx = ref(0)

// Crafting
const craftingOpen = ref(false)
const craftTab = ref('bread')
const craftSlots = reactive(Array(4).fill(false))
const craftMsg = ref('')
const craftReady = computed(() => craftSlots.filter(Boolean).length >= 3)
const pickaxeSlots = reactive([false, false, false, false])
const pickaxeReady = computed(() => pickaxeSlots[0] && pickaxeSlots[1] && pickaxeSlots[3])
const flintSlots = reactive([false, false, false, false])
const flintReady = computed(() => flintSlots[0] && flintSlots[3])

// Obsidian blocks (10)
const obsidianBlockState = reactive(
  Array.from({ length: 10 }, () => ({ cracks: 0, alive: true }))
)

// Portal
const PORTAL_COLS = 4, PORTAL_ROWS = 5, TOTAL_CELLS = PORTAL_COLS * PORTAL_ROWS
const portalGrid = reactive(Array(TOTAL_CELLS).fill(false))
const portalActive = ref(false)
const showPortalArea = computed(() => inventory.obsidian >= 10 || portalFrameComplete.value || portalActive.value)
const portalFrameComplete = computed(() => {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (isPortalFrame(i) && !portalGrid[i]) return false
  }
  return true
})

function isPortalInner(idx) {
  const row = Math.floor(idx / PORTAL_COLS), col = idx % PORTAL_COLS
  return row >= 1 && row <= 3 && col >= 1 && col <= 2
}
function isPortalFrame(idx) { return !isPortalInner(idx) }

// Redstone
const leverOn = ref(false)
const panelFlickering = ref(false)
const redstoneTiles = reactive([{ lit: true }, { lit: true }, { lit: true }])

// TNT
const tntFlashing = ref(false)
const craterVisible = ref(false)
let tntCooldown = false

// Physics drops
let dropIdCounter = 0
const activeDrops = reactive([])
const dropFrames = new Map()

// ── Physics drops ─────────────────────────────────────────────────────────────
function spawnDrops(originX, originY, types, count = null, explosive = false) {
  const n = count ?? (2 + Math.floor(Math.random() * 3))
  for (let i = 0; i < n; i++) {
    const roll = Math.random()
    let chosen = types[types.length - 1].icon
    let acc = 0
    for (const t of types) { acc += t.chance; if (roll <= acc) { chosen = t.icon; break } }
    const spread = explosive ? 12 : 6
    const drop = reactive({
      id: ++dropIdCounter,
      icon: chosen,
      x: originX - 8,
      y: originY - 8,
      vx: (Math.random() - 0.5) * spread,
      vy: explosive ? -(6 + Math.random() * 8) : -(4 + Math.random() * 4),
      angle: 0,
      angularV: (Math.random() - 0.5) * 20,
      opacity: 1,
      size: explosive ? 14 : 16,
      landed: false,
    })
    activeDrops.push(drop)
    animateDrop(drop)
  }
}

function animateDrop(drop) {
  const GRAVITY = 0.38, FLOOR_Y = 380
  function step() {
    if (drop.landed) return
    drop.vy += GRAVITY
    drop.x += drop.vx; drop.y += drop.vy
    drop.angle += drop.angularV
    if (drop.y >= FLOOR_Y) { drop.y = FLOOR_Y; drop.landed = true; fadeOut(drop); return }
    dropFrames.set(drop.id, requestAnimationFrame(step))
  }
  dropFrames.set(drop.id, requestAnimationFrame(step))
}

function fadeOut(drop) {
  let step = 0, STEPS = 40
  function tick() {
    step++; drop.opacity = 1 - step / STEPS
    if (step < STEPS) { dropFrames.set(drop.id, requestAnimationFrame(tick)) }
    else { const idx = activeDrops.findIndex(d => d.id === drop.id); if (idx !== -1) activeDrops.splice(idx, 1) }
  }
  dropFrames.set(drop.id, requestAnimationFrame(tick))
}

// ── Three.js Scene Builder ─────────────────────────────────────────────────
function buildScene() {
  // Surface grass layer
  for (let x = -6; x <= 6; x++) {
    for (let z = -4; z <= 4; z++) {
      // Skip farm area (replaced by farmland)
      if (x >= -2 && x <= 0 && z >= -1 && z <= 1) continue
      const m = makeGrassBlock(x, 0, z)
      scene.add(m)
    }
  }

  // Farm: farmland + wheat
  for (let fx = -2; fx <= 0; fx++) {
    for (let fz = -1; fz <= 1; fz++) {
      const m = makeFarmland(fx, 0, fz)
      scene.add(m)
      // Crop sprite (plane)
      const cropIdx = (fx + 2) * 3 + (fz + 1)
      const cropGeo = new THREE.PlaneGeometry(0.7, 0.7)
      const cropMat = new THREE.MeshBasicMaterial({
        map: loadBlockTexture('wheat_stage7'),
        transparent: true,
        side: THREE.DoubleSide,
        alphaTest: 0.1,
      })
      const cropMesh = new THREE.Mesh(cropGeo, cropMat)
      cropMesh.position.set(fx, 0.85, fz)
      cropMesh.rotation.y = Math.PI / 4
      cropMesh.userData.type = 'crop'
      cropMesh.userData.idx = cropIdx
      cropMeshes[cropIdx] = cropMesh
      scene.add(cropMesh)
      interactableObjects.push(cropMesh)
      objectMeta.set(cropMesh, { type: 'crop', idx: cropIdx })
    }
  }

  // Oak tree at x=3, z=0
  for (let y = 1; y <= 4; y++) scene.add(makeOakLog(3, y, 0))
  // Leaves cluster at y=5 (3x3x2)
  const leafTex = loadBlockTexture('oak_leaves')
  for (let lx = 2; lx <= 4; lx++) {
    for (let lz = -1; lz <= 1; lz++) {
      for (let ly = 4; ly <= 5; ly++) {
        const leaf = makeBlock(leafTex, lx, ly, lz)
        leaf.material.transparent = true
        leaf.material.alphaTest = 0.5
        scene.add(leaf)
      }
    }
  }

  // Crafting table at (-4, 1, 1)
  const ctTop = loadBlockTexture('crafting_table_top')
  const ctFront = loadBlockTexture('crafting_table_front')
  const ctOak = loadBlockTexture('oak_planks')
  const craftMesh = makeBlock([ctFront, ctOak, ctTop, ctOak, ctFront, ctOak], -4, 1, 1)
  craftMesh.userData.type = 'crafting'
  craftingMesh.mesh = craftMesh
  scene.add(craftMesh)
  interactableObjects.push(craftMesh)
  objectMeta.set(craftMesh, { type: 'crafting' })

  // TNT block at (-4, 1, -1)
  const tntSide = loadBlockTexture('tnt_side')
  const tntTop = loadBlockTexture('tnt_top')
  const tntMesh = makeBlock([tntSide, tntSide, tntTop, tntTop, tntSide, tntSide], -4, 1, -1)
  tntMesh.userData.type = 'tnt'
  scene.add(tntMesh)
  interactableObjects.push(tntMesh)
  objectMeta.set(tntMesh, { type: 'tnt' })

  // Sign post at (2, 1, -2): oak planks block + text sprite
  const signBase = makeBlock(loadBlockTexture('oak_planks'), 2, 1, -2)
  signBase.userData.type = 'sign'
  scene.add(signBase)
  interactableObjects.push(signBase)
  objectMeta.set(signBase, { type: 'sign' })

  // Underground stone floor y=-1..-3
  for (let x = -6; x <= 6; x++) {
    for (let z = -4; z <= 4; z++) {
      for (let y = -1; y >= -3; y--) {
        scene.add(makeStoneBlock(x, y, z))
      }
    }
  }

  // Lever base block at (-5, 0, 0)
  const leverBase = makeBlock(loadBlockTexture('stone'), -5, 0, 0)
  leverBase.userData.type = 'lever'
  scene.add(leverBase)
  interactableObjects.push(leverBase)
  objectMeta.set(leverBase, { type: 'lever' })

  // Lever arm
  const armGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1)
  const armMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
  const armMesh = new THREE.Mesh(armGeo, armMat)
  armMesh.position.set(-5, 0.75, 0)
  leverMesh.arm = armMesh
  scene.add(armMesh)

  // Redstone dust tiles at y=-1, x=-5..-3, z=0
  for (let rx = -5; rx <= -3; rx++) {
    const rdGeo = new THREE.PlaneGeometry(0.9, 0.9)
    const rdMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.9 })
    const rdMesh = new THREE.Mesh(rdGeo, rdMat)
    rdMesh.rotation.x = -Math.PI / 2
    rdMesh.position.set(rx, -0.49, 0)
    redstoneMeshes.push({ mesh: rdMesh, mat: rdMat })
    scene.add(rdMesh)
  }

  // Piston at (-2, -1, 0)
  const pistonBodyMesh = makeBlock(loadBlockTexture('stone'), -2, -1, 0)
  const pistonHeadGeo = new THREE.BoxGeometry(0.9, 0.3, 0.9)
  const pistonHeadMat = new THREE.MeshLambertMaterial({ color: 0xddaa55 })
  const pistonHeadMesh = new THREE.Mesh(pistonHeadGeo, pistonHeadMat)
  pistonHeadMesh.position.set(-2, -0.35, 0)
  pistonMesh.body = pistonBodyMesh
  pistonMesh.head = pistonHeadMesh
  scene.add(pistonBodyMesh)
  scene.add(pistonHeadMesh)

  // Info block at (-1, -1, 0): stone normally, reveals text
  const infoBlock = makeBlock(loadBlockTexture('stone'), -1, -1, 0)
  infoBlock.userData.type = 'info'
  scene.add(infoBlock)

  // Scattered obsidian in underground
  const obsPositions = [
    [-3, -2, 1], [-1, -2, -2], [1, -1, 2], [2, -2, 1], [3, -1, -3],
    [-5, -2, 2], [4, -2, 0], [5, -1, 3], [-2, -3, -1], [0, -3, 3],
  ]
  obsPositions.forEach(([ox, oy, oz], idx) => {
    const obs = makeObsidianBlock(ox, oy, oz)
    obs.userData.type = 'obsidian'
    obs.userData.idx = idx
    obsidianMeshes[idx] = obs
    scene.add(obs)
    interactableObjects.push(obs)
    objectMeta.set(obs, { type: 'obsidian', idx })
  })

  // Portal frame area (built dynamically based on portalGrid)
  // Frame at x=1, z=-3, going right 4, up 5
  buildPortalFrame()

  // Redstone glow light
  redstoneLight = new THREE.PointLight(0xff2200, 0, 3)
  redstoneLight.position.set(-3, -1, 0)
  scene.add(redstoneLight)
}

// ── Portal Frame ──────────────────────────────────────────────────────────────
const portalFramePositions = []
for (let row = 0; row < PORTAL_ROWS; row++) {
  for (let col = 0; col < PORTAL_COLS; col++) {
    portalFramePositions.push({
      x: 1 + col,
      y: row,
      z: -3,
    })
  }
}

function buildPortalFrame() {
  // Remove old meshes
  portalFrameMeshes.forEach(m => scene.remove(m))
  portalFrameMeshes.length = 0

  // Add placed portal blocks
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (!portalGrid[i] && !isPortalInner(i)) continue
    if (isPortalInner(i)) continue // inner is handled by portal swirl
    const pos = portalFramePositions[i]
    const m = makeObsidianBlock(pos.x, pos.y, pos.z)
    m.userData.type = 'portalFrame'
    m.userData.idx = i
    portalFrameMeshes.push(m)
    scene.add(m)
    // Make it interactable for placing obsidian
    interactableObjects.push(m)
    objectMeta.set(m, { type: 'portalFrame', idx: i })
  }

  // Add unplaced frame slots as interactable ghost blocks
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (portalGrid[i] || isPortalInner(i)) continue
    const pos = portalFramePositions[i]
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.3, wireframe: true })
    const ghost = new THREE.Mesh(geo, mat)
    ghost.position.set(pos.x, pos.y, pos.z)
    ghost.userData.type = 'portalSlot'
    ghost.userData.idx = i
    portalFrameMeshes.push(ghost)
    scene.add(ghost)
    interactableObjects.push(ghost)
    objectMeta.set(ghost, { type: 'portalSlot', idx: i })
  }

  // Portal inner plane
  if (portalInnerMesh.mesh) { scene.remove(portalInnerMesh.mesh); portalInnerMesh.mesh = null }
  if (portalActive.value) {
    const geo = new THREE.PlaneGeometry(2, 3)
    portalMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0.85 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv - 0.5;
          float angle = atan(uv.y, uv.x) + time;
          float r = length(uv);
          float swirl = sin(angle * 5.0 + r * 10.0 - time * 3.0);
          vec3 col = mix(vec3(0.3, 0.0, 0.5), vec3(0.7, 0.3, 1.0), swirl * 0.5 + 0.5);
          gl_FragColor = vec4(col, opacity * (1.0 - r * 1.5));
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    })
    const pm = new THREE.Mesh(geo, portalMat)
    // Center of 2x3 inner portal at cols 1-2, rows 1-3 → center x=2.5, y=2, z=-3
    pm.position.set(2.5, 2, -2.99)
    pm.userData.type = 'portalInner'
    portalInnerMesh.mesh = pm
    scene.add(pm)
    interactableObjects.push(pm)
    objectMeta.set(pm, { type: 'portalInner' })
  }
}

// ── Crop visual update ────────────────────────────────────────────────────────
function updateCropMesh(idx) {
  const crop = crops[idx]
  const mesh = cropMeshes[idx]
  if (!mesh) return
  const s = [0.1, 0.3, 0.6, 1.0][crop.stage] ?? 1
  mesh.scale.set(s, s, s)
  // Tint: stage 0 = brown, 1-2 = green, 3 = yellow
  const colors = [0x8b6914, 0x5a8a10, 0x6aaa10, 0xf0d700]
  const c = colors[crop.stage] ?? 0xf0d700
  if (mesh.material) mesh.material.color = new THREE.Color(c)
}

// ── Raycasting ────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

function onCanvasClick(e) {
  if (!renderer || !camera) return
  const rect = threeCanvas.value.getBoundingClientRect()
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObjects(interactableObjects, false)
  if (hits.length > 0) {
    handleClick(hits[0].object)
    interacted.value = true
  }
}

function handleClick(obj) {
  const meta = objectMeta.get(obj)
  if (!meta) return
  switch (meta.type) {
    case 'crop': handleFarmClick(meta.idx); break
    case 'crafting': craftingOpen.value = true; craftMsg.value = ''; break
    case 'tnt': triggerTNT(); break
    case 'sign': signIdx.value = (signIdx.value + 1) % signMessages.length; break
    case 'lever': toggleLever(); break
    case 'obsidian': mineObsidian(meta.idx); break
    case 'portalSlot': placePortalBlock(meta.idx); break
    case 'portalFrame': placePortalBlock(meta.idx); break
    case 'portalInner': if (portalActive.value) enterPortal(); break
  }
}

// ── Farm ─────────────────────────────────────────────────────────────────────
function handleFarmClick(idx) {
  const crop = crops[idx]
  if (crop.stage === 3) harvestCrop(idx)
  else { crop.stage = Math.min(crop.stage + 1, 3); updateCropMesh(idx) }
}

function harvestCrop(idx) {
  const mesh = cropMeshes[idx]
  const screenPos = mesh ? worldToScreen(mesh.position) : { x: 300, y: 200 }
  spawnDrops(screenPos.x, screenPos.y, [{ icon: '🌾', chance: 0.6 }, { icon: '🌱', chance: 1 }])
  triggerCameraShake()
  crops[idx].stage = 0
  harvestCount.value++
  inventory.wheat++
  for (let i = 0; i < craftSlots.length; i++) { if (!craftSlots[i]) { craftSlots[i] = true; break } }
  if (Math.random() < 0.125) {
    inventory.diamond++
    craftMsg.value = '💎 You found a diamond while farming! Lucky!'
    setTimeout(() => { if (craftMsg.value.includes('diamond')) craftMsg.value = '' }, 3000)
  }
  updateCropMesh(idx)
}

function worldToScreen(worldPos) {
  if (!camera || !renderer) return { x: 300, y: 200 }
  const v = worldPos.clone().project(camera)
  const rect = threeCanvas.value?.getBoundingClientRect() || { width: 780, height: 420, left: 0, top: 0 }
  return {
    x: (v.x + 1) / 2 * rect.width,
    y: (1 - (v.y + 1) / 2) * rect.height,
  }
}

// ── Obsidian mining ────────────────────────────────────────────────────────────
function mineObsidian(idx) {
  if (!hasPickaxe.value) return
  const state = obsidianBlockState[idx]
  if (!state || !state.alive) return
  state.cracks++
  triggerCameraShake()
  const mesh = obsidianMeshes[idx]
  if (mesh) {
    // Visual crack effect: darken and scale slightly
    const t = state.cracks / 3
    mesh.material.color = new THREE.Color(1 - t * 0.5, 1 - t * 0.5, 1 - t * 0.5)
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => { m.color = new THREE.Color(1 - t * 0.5, 1 - t * 0.5, 1 - t * 0.5) })
  }
  if (state.cracks >= 3) {
    state.alive = false
    if (mesh) {
      const sp = worldToScreen(mesh.position)
      spawnDrops(sp.x, sp.y, [{ icon: '⬛', chance: 1 }], 2, false)
      scene.remove(mesh)
      const iio = interactableObjects.indexOf(mesh)
      if (iio !== -1) interactableObjects.splice(iio, 1)
    }
    inventory.obsidian++
    craftMsg.value = `⬛ Obsidian mined! (${inventory.obsidian}/10)`
    if (inventory.obsidian >= 10) craftMsg.value = '⬛ You have enough obsidian to build a Nether Portal! 🟣'
  }
}

// ── Portal ─────────────────────────────────────────────────────────────────────
function placePortalBlock(idx) {
  if (portalActive.value) return
  if (isPortalInner(idx)) {
    if (portalFrameComplete.value && equippedItem.value === 'flintSteel') activatePortal()
    return
  }
  if (!portalGrid[idx] && inventory.obsidian > 0) {
    portalGrid[idx] = true
    inventory.obsidian--
    // Rebuild frame visuals
    rebuildPortalVisuals()
  }
}

function rebuildPortalVisuals() {
  // Remove old portal frame meshes from interactables
  portalFrameMeshes.forEach(m => {
    const iio = interactableObjects.indexOf(m)
    if (iio !== -1) interactableObjects.splice(iio, 1)
  })
  buildPortalFrame()
}

function activatePortal() {
  if (portalActive.value) return
  inventory.flintSteel = Math.max(0, inventory.flintSteel - 1)
  portalActive.value = true
  equippedItem.value = null
  craftMsg.value = '🔥 The portal ignites... 🟣'
  rebuildPortalVisuals()
}

function enterPortal() { window.open('/nether', '_blank') }

// ── Lever & Redstone ────────────────────────────────────────────────────────────
function toggleLever() {
  if (!leverOn.value) {
    let delay = 0
    for (let i = 0; i < redstoneTiles.length; i++) {
      const idx = i
      setTimeout(() => { redstoneTiles[idx].lit = false }, delay)
      delay += 60
    }
    setTimeout(() => {
      leverOn.value = true
      panelFlickering.value = true
      setTimeout(() => { panelFlickering.value = false }, 600)
    }, delay + 300)
  } else {
    panelFlickering.value = true
    setTimeout(() => {
      leverOn.value = false
      panelFlickering.value = false
      let delay = 0
      for (let i = redstoneTiles.length - 1; i >= 0; i--) {
        const idx = i
        setTimeout(() => { redstoneTiles[idx].lit = true }, delay)
        delay += 60
      }
    }, 300)
  }
}

// ── TNT ─────────────────────────────────────────────────────────────────────────
function triggerTNT() {
  if (tntCooldown) return
  tntCooldown = true
  tntFlashing.value = true
  setTimeout(() => {
    tntFlashing.value = false
    triggerCameraShake()
    const cx = 300, cy = 200
    for (let i = 0; i < 18; i++) {
      const icons = ['🪨', '💥', '🔥', '⬛', '🟫']
      spawnDrops(
        cx + (Math.random() - 0.5) * 60,
        cy + (Math.random() - 0.5) * 40,
        icons.map(icon => ({ icon, chance: 1 })), 1, true
      )
    }
    inventory.flint += 1
    inventory.iron += 1
    craterVisible.value = true
    setTimeout(() => { craterVisible.value = false; tntCooldown = false }, 5000)
  }, 1500)
}

// ── Crafting ────────────────────────────────────────────────────────────────────
function doCraft() {
  if (craftReady.value) {
    for (let i = 0; i < craftSlots.length; i++) craftSlots[i] = false
    craftMsg.value = '🍞 Bread crafted! +1 sustenance. Yuzhe approves.'
    inventory.wheat = Math.max(0, inventory.wheat - 3)
    harvestCount.value = Math.max(0, harvestCount.value - 3)
  } else { craftMsg.value = '⚠ You need wheat. Go farm something.' }
}

function togglePickaxeSlot(i) {
  if (i === 0 || i === 1) {
    if (!pickaxeSlots[i] && (inventory.diamond || 0) < (pickaxeSlots[0] + pickaxeSlots[1] + 1)) { craftMsg.value = '⚠ Not enough diamonds!'; return }
    pickaxeSlots[i] = !pickaxeSlots[i]
  } else if (i === 3) {
    if (!pickaxeSlots[3] && (inventory.wood || 0) < 1) { craftMsg.value = '⚠ No wood!'; return }
    pickaxeSlots[3] = !pickaxeSlots[3]
  }
}

function craftPickaxe() {
  if (!pickaxeReady.value) { craftMsg.value = '⚠ Need: 2 diamonds (top) + 1 wood (bottom-right)'; return }
  if ((inventory.diamond || 0) < 2) { craftMsg.value = '⚠ Not enough diamonds!'; return }
  if ((inventory.wood || 0) < 1) { craftMsg.value = '⚠ No wood!'; return }
  inventory.diamond -= 2; inventory.wood -= 1; inventory.pickaxe++
  for (let i = 0; i < 4; i++) pickaxeSlots[i] = false
  craftMsg.value = '⛏️ Diamond Pickaxe crafted! Ready to mine obsidian.'
  equipItem('pickaxe')
}

function toggleFlintSlot(i) {
  if (i === 0) { if (!flintSlots[0] && (inventory.flint || 0) < 1) { craftMsg.value = '⚠ No flint!'; return } flintSlots[0] = !flintSlots[0] }
  else if (i === 3) { if (!flintSlots[3] && (inventory.iron || 0) < 1) { craftMsg.value = '⚠ No iron ingot!'; return } flintSlots[3] = !flintSlots[3] }
}

function craftFlintSteel() {
  if (!flintReady.value) { craftMsg.value = '⚠ Need: flint (top-left) + iron ingot (bottom-right)'; return }
  if ((inventory.flint || 0) < 1) { craftMsg.value = '⚠ No flint!'; return }
  if ((inventory.iron || 0) < 1) { craftMsg.value = '⚠ No iron ingot!'; return }
  inventory.flint--; inventory.iron--; inventory.flintSteel++
  for (let i = 0; i < 4; i++) flintSlots[i] = false
  craftMsg.value = '🔥 Flint & Steel crafted! You can light portals now.'
  equipItem('flintSteel')
}

// ── Camera shake ─────────────────────────────────────────────────────────────
function triggerCameraShake() { shakeTime = 0.4 }

// ── Piglin (matter-js + skinview3d) ──────────────────────────────────────────
let Matter = null
let piglinEngine = null
let piglinWorld = null
let piglinBody = null
let piglinViewer = null
let piglinAnimFrame = null
const piglinState = reactive({ x: 390, y: 300, vx: 0, flipped: 1, dead: false, hitCount: 0, flashing: false, walkTimer: null })
const netherDeathMsg = ref('')
let broadcastChannel = null

const PIGLIN_W = 32, PIGLIN_H = 48

const piglinCanvasStyle = computed(() => ({
  left: (piglinState.x - PIGLIN_W / 2) + 'px',
  top: (piglinState.y - PIGLIN_H / 2) + 'px',
  transform: `scaleX(${piglinState.flipped})`,
  filter: piglinState.flashing ? 'hue-rotate(300deg) saturate(3) brightness(1.5)' : 'none',
}))

let mouseDownTime = 0, mouseDownPos2 = null

function onPiglinMouseDown(e) {
  if (piglinState.dead) return
  mouseDownTime = Date.now()
  mouseDownPos2 = { x: e.clientX, y: e.clientY }
  const onUp = (ev) => {
    if (mouseDownPos2) {
      const dx = ev.clientX - mouseDownPos2.x, dy = ev.clientY - mouseDownPos2.y
      if (Math.sqrt(dx * dx + dy * dy) < 5) attackPiglin()
    }
    mouseDownPos2 = null
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mouseup', onUp)
}

function attackPiglin() {
  if (piglinState.dead) return
  piglinState.flashing = true
  setTimeout(() => { piglinState.flashing = false }, 300)
  if (Matter && piglinBody) {
    Matter.Body.applyForce(piglinBody, piglinBody.position, {
      x: (Math.random() - 0.5) * 0.015, y: -0.03,
    })
  }
  piglinState.hitCount++
  if (piglinState.hitCount >= 5) killPiglin()
}

function killPiglin() {
  piglinState.dead = true
  if (Matter && piglinBody) Matter.Body.setStatic(piglinBody, true)
  setTimeout(() => respawnPiglin(), 5000)
}

function respawnPiglin() {
  if (!Matter || !piglinBody) return
  const W = threeCanvas.value?.clientWidth || 780
  const side = Math.random() > 0.5 ? 80 : W - 80
  Matter.Body.setStatic(piglinBody, false)
  Matter.Body.setPosition(piglinBody, { x: side, y: 300 })
  Matter.Body.setVelocity(piglinBody, { x: 0, y: 0 })
  piglinState.dead = false
  piglinState.hitCount = 0
  schedulePiglinWalk()
}

function schedulePiglinWalk() {
  if (piglinState.walkTimer) clearTimeout(piglinState.walkTimer)
  piglinState.walkTimer = setTimeout(() => {
    if (!piglinState.dead && Matter && piglinBody) {
      Matter.Body.applyForce(piglinBody, piglinBody.position, { x: (Math.random() - 0.5) * 0.004, y: 0 })
    }
    schedulePiglinWalk()
  }, 2000 + Math.random() * 2000)
}

async function initPiglin() {
  try {
    Matter = await import('matter-js')
    const { Engine, World, Bodies, Body, Runner, MouseConstraint: MC, Mouse } = Matter

    piglinEngine = Engine.create({ gravity: { y: 1.5 } })
    piglinWorld = piglinEngine.world

    const W = threeCanvas.value?.clientWidth || 780
    const H = threeCanvas.value?.clientHeight || 420
    const groundY = H - 48

    const ground = Bodies.rectangle(W / 2, groundY + 24, W, 48, { isStatic: true })
    const wallL = Bodies.rectangle(-24, H / 2, 48, H, { isStatic: true })
    const wallR = Bodies.rectangle(W + 24, H / 2, 48, H, { isStatic: true })
    World.add(piglinWorld, [ground, wallL, wallR])

    piglinBody = Bodies.rectangle(W / 2, groundY - PIGLIN_H, PIGLIN_W, PIGLIN_H, {
      restitution: 0.3, friction: 0.8, frictionAir: 0.02,
    })
    World.add(piglinWorld, piglinBody)

    if (piglinCanvas.value) {
      const mouse = Mouse.create(piglinCanvas.value.parentElement)
      const mc = MC.create(piglinEngine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } })
      World.add(piglinWorld, mc)
    }

    schedulePiglinWalk()
    checkNetherSync()

    let last = performance.now()
    function loop(now) {
      const dt = Math.min(now - last, 32); last = now
      Engine.update(piglinEngine, 1000 / 60)

      piglinState.x = piglinBody.position.x
      piglinState.y = piglinBody.position.y
      piglinState.vx = piglinBody.velocity.x
      if (Math.abs(piglinState.vx) > 0.5) piglinState.flipped = piglinState.vx > 0 ? 1 : -1

      if (piglinViewer?.animation) {
        piglinViewer.animation.speed = 0.3 + Math.abs(piglinState.vx) / 3
      }

      checkPortalCollision()
      piglinAnimFrame = requestAnimationFrame(loop)
    }
    piglinAnimFrame = requestAnimationFrame(loop)
  } catch (e) {
    // matter-js unavailable (SSR or blocked)
  }
}

async function initPiglinViewer() {
  if (!piglinCanvas.value) return
  try {
    const { SkinViewer, WalkingAnimation } = await import('skinview3d')
    piglinViewer = new SkinViewer({
      canvas: piglinCanvas.value,
      width: PIGLIN_W,
      height: PIGLIN_H,
      skin: 'https://minecraft.wiki/images/Piglin_texture.png',
    })
    piglinViewer.animation = new WalkingAnimation()
    piglinViewer.animation.speed = 0.8
  } catch (_) {}
}

function checkPortalCollision() {
  if (!portalActive.value || !piglinBody) return
  // Portal is at x: 1 to 4 (Three.js coords) — need to map to screen coords
  // We use a rough screen space estimate since the Three.js canvas maps these positions
  // Portal inner x: 1.5-3.5, y: 1-3, z: -3
  // Screen position of portal center
  if (!camera || !threeCanvas.value) return
  const portalCenter = new THREE.Vector3(2.5, 2, -3)
  const sc = worldToScreen(portalCenter)
  const px = piglinState.x, py = piglinState.y
  const rect = threeCanvas.value.getBoundingClientRect()
  if (Math.abs(px - sc.x) < 40 && Math.abs(py - sc.y) < 60) {
    sendPiglinToNether()
  }
}

function sendPiglinToNether() {
  const data = { health: 5 - piglinState.hitCount, name: 'Piglin-1', enteredAt: Date.now() }
  try { localStorage.setItem('piglin_in_nether', JSON.stringify(data)) } catch (_) {}
  broadcastChannel?.postMessage({ type: 'piglin_enter', piglinData: data })
  craftMsg.value = '🟣 Your Piglin entered the Nether!'
  setTimeout(() => { craftMsg.value = '' }, 3000)
  killPiglin()
}

function checkNetherSync() {
  try {
    broadcastChannel = new BroadcastChannel('kotodama-nether')
    broadcastChannel.onmessage = (e) => {
      if (e.data.type === 'piglin_died_in_nether') {
        netherDeathMsg.value = 'Your piglin died in the Nether...'
        setTimeout(() => { netherDeathMsg.value = '' }, 5000)
      }
    }
  } catch (_) {}
}

// ── Three.js Init ─────────────────────────────────────────────────────────────
function initThree() {
  const canvas = threeCanvas.value
  const W = canvas.clientWidth || 780
  const H = Math.round(W * 0.54) || 420
  canvas.width = W
  canvas.height = H

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false })
  renderer.setSize(W, H)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x87ceeb)
  scene.fog = new THREE.Fog(0x87ceeb, 20, 35)

  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100)
  camera.position.set(basePos.x, basePos.y, basePos.z)
  camera.lookAt(0, 0, 0)

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xfffacd, 1.0)
  sun.position.set(5, 10, 5)
  sun.castShadow = true
  sun.shadow.mapSize.width = 1024
  sun.shadow.mapSize.height = 1024
  scene.add(sun)

  clock = new THREE.Clock()

  buildScene()

  // Crop initial states
  for (let i = 0; i < 9; i++) updateCropMesh(i)

  // Parallax
  document.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('click', onCanvasClick)

  // Render loop
  function render() {
    const delta = clock.getDelta()
    const elapsed = clock.getElapsedTime()

    // Portal shader time
    if (portalMat) portalMat.uniforms.time.value = elapsed

    // Camera parallax
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, basePos.x + targetOffsetX, 0.05)
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, basePos.y - targetOffsetY, 0.05)

    // Camera shake
    if (shakeTime > 0) {
      shakeTime -= delta
      const intensity = shakeTime * 0.3
      camera.position.x += (Math.random() - 0.5) * intensity
      camera.position.y += (Math.random() - 0.5) * intensity
    }

    camera.lookAt(0, 0, 0)

    // Lever arm tilt
    if (leverMesh.arm) {
      leverMesh.arm.rotation.z = leverOn.value
        ? THREE.MathUtils.lerp(leverMesh.arm.rotation.z, -0.8, 0.15)
        : THREE.MathUtils.lerp(leverMesh.arm.rotation.z, 0.8, 0.15)
    }

    // Redstone tiles emissive
    redstoneMeshes.forEach((rd, i) => {
      const lit = redstoneTiles[i]?.lit ?? true
      rd.mat.color = lit ? new THREE.Color(0xff2200) : new THREE.Color(0x330000)
      rd.mat.opacity = lit ? 0.9 : 0.3
    })

    // Redstone light
    if (redstoneLight) redstoneLight.intensity = leverOn.value ? 2 : 0

    // Piston head
    if (pistonMesh.head) {
      pistonMesh.head.position.y = leverOn.value
        ? THREE.MathUtils.lerp(pistonMesh.head.position.y, -0.1, 0.1)
        : THREE.MathUtils.lerp(pistonMesh.head.position.y, -0.35, 0.1)
    }

    // Crop billboard
    cropMeshes.forEach(m => {
      if (m) m.rotation.y = elapsed * 0.5
    })

    renderer.render(scene, camera)
    animFrameId = requestAnimationFrame(render)
  }
  animFrameId = requestAnimationFrame(render)
}

function onMouseMove(e) {
  const nx = (e.clientX / window.innerWidth - 0.5) * 2
  const ny = (e.clientY / window.innerHeight - 0.5) * 2
  targetOffsetX = nx * 1.5
  targetOffsetY = ny * 0.8
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  initThree()
  await initTextures()
  await initPiglin()
  await initPiglinViewer()
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  if (piglinAnimFrame) cancelAnimationFrame(piglinAnimFrame)
  document.removeEventListener('mousemove', onMouseMove)
  threeCanvas.value?.removeEventListener('click', onCanvasClick)
  for (const id of dropFrames.values()) cancelAnimationFrame(id)
  if (piglinState.walkTimer) clearTimeout(piglinState.walkTimer)
  broadcastChannel?.close()
  if (piglinViewer) try { piglinViewer.dispose() } catch (_) {}
  if (renderer) renderer.dispose()
  if (Matter && piglinEngine) Matter.Engine.clear(piglinEngine)
})
</script>

<style scoped>
.mcw-wrapper {
  position: relative;
  font-family: "Courier New", monospace;
  user-select: none;
  width: 780px;
  max-width: 100%;
  margin: 1.5rem auto;
  overflow: hidden;
}

.mcw-hint {
  font-size: 10px;
  color: #888;
  text-align: center;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 4px;
  transition: opacity 0.6s;
}
.mcw-hint.hidden { opacity: 0; pointer-events: none; }

.mcw-canvas-container {
  position: relative;
  width: 100%;
  border: 3px solid #3a5a3a;
  box-shadow: 0 0 0 3px #1a3a0a, 4px 4px 0 6px #0a1a04;
  overflow: hidden;
  line-height: 0;
}

.mcw-three-canvas {
  display: block;
  width: 100%;
  height: auto;
  image-rendering: pixelated;
  cursor: crosshair;
}

.mcw-piglin-canvas {
  position: absolute;
  width: 32px;
  height: 48px;
  image-rendering: pixelated;
  cursor: grab;
  pointer-events: auto;
  transition: filter 0.1s;
}

.nether-death-msg {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
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

/* ── Hotbar ── */
.mcw-hotbar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  background: rgba(0,0,0,0.6);
  align-items: center;
  flex-wrap: wrap;
  border: 2px solid #555;
  border-top: none;
}
.hotbar-slot {
  position: relative;
  width: 36px; height: 36px;
  background: rgba(60,60,60,0.8);
  border: 2px solid #555;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  cursor: pointer;
  transition: border-color 0.1s;
}
.hotbar-slot:hover { border-color: #aaa; }
.hotbar-slot.equipped { border-color: #fff; background: rgba(100,100,100,0.8); }
.hotbar-count {
  position: absolute;
  bottom: 1px; right: 2px;
  font-size: 9px; color: #fff;
  font-family: "Courier New", monospace;
  text-shadow: 1px 1px 0 #000;
  line-height: 1;
}
.hotbar-equipped-label {
  font-size: 10px; color: #fff;
  margin-left: 8px;
  font-family: "Courier New", monospace;
}

/* ── Portal hint ── */
.portal-activate-hint {
  font-size: 11px; color: #cc88ff;
  text-align: center;
  padding: 4px;
  background: rgba(0,0,0,0.5);
  font-family: "Courier New", monospace;
}

/* ── TNT Crater ── */
.mcw-crater {
  display: none;
  position: absolute;
  top: 30%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.85);
  border: 3px solid #ff4400;
  padding: 16px 20px;
  z-index: 30;
  pointer-events: none;
  font-family: "Courier New", monospace;
}
.mcw-crater.visible { display: block; animation: crater-pop 0.3s ease-out; }
@keyframes crater-pop {
  from { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
  to   { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
.crater-msg { color: #ff8800; font-size: 13px; }
.crater-quote { color: #ffcc88; font-size: 11px; margin-top: 2px; }

/* ── Physics drops ── */
.mcw-drops-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.mcw-drop-item {
  position: absolute;
  pointer-events: none;
  font-size: 16px;
  line-height: 1;
}

/* ── Crafting overlay ── */
.mcw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.mcw-crafting-ui {
  background: #2a2a2a;
  border: 3px solid #555;
  padding: 20px 24px;
  font-family: "Courier New", monospace;
  color: #eee;
  min-width: 260px;
  position: relative;
}
.cui-title { font-size: 16px; font-weight: bold; margin-bottom: 12px; color: #fff; }
.cui-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.cui-tab { padding: 4px 10px; background: #333; border: 2px solid #555; cursor: pointer; font-size: 11px; }
.cui-tab.active { background: #555; border-color: #aaa; }
.cui-recipe-hint { font-size: 10px; color: #aaa; margin-bottom: 8px; }
.cui-grid { display: grid; grid-template-columns: repeat(4, 36px); gap: 3px; margin-bottom: 8px; }
.cui-slot { width: 36px; height: 36px; background: #1a1a1a; border: 2px solid #444; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.cui-slot.filled { border-color: #888; background: #333; }
.cui-grid2x2 { display: grid; grid-template-columns: repeat(2, 36px); gap: 3px; margin-bottom: 8px; }
.cui-slot2 { width: 36px; height: 36px; background: #1a1a1a; border: 2px solid #444; display: flex; align-items: center; justify-content: center; font-size: 18px; cursor: pointer; }
.cui-slot2.filled { border-color: #888; background: #333; }
.cui-slot2:hover { border-color: #aaa; }
.cui-recipe-legend { font-size: 10px; color: #888; margin-bottom: 8px; }
.cui-arrow { font-size: 20px; margin: 4px 0; color: #aaa; }
.cui-output { width: 44px; height: 44px; background: #1a1a1a; border: 2px solid #444; display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px; }
.cui-output.ready { border-color: #88ff88; background: #1a3a1a; }
.cui-btn { padding: 6px 14px; background: #444; border: 2px solid #888; cursor: pointer; font-family: "Courier New", monospace; color: #fff; font-size: 13px; display: inline-block; }
.cui-btn:hover { background: #666; }
.cui-msg { margin-top: 8px; font-size: 11px; color: #88ff88; }
.cui-close {
  position: absolute; top: 8px; right: 10px;
  cursor: pointer; font-size: 16px; color: #888;
}
.cui-close:hover { color: #fff; }
.slot-hint { font-size: 12px; color: #666; }
</style>
