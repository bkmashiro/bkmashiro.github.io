<template>
  <div class="mcw-wrapper" ref="wrapperRef" :class="{ shake: shaking }">
    <!-- Hint -->
    <div class="mcw-hint" :class="{ hidden: interacted }">Click to interact</div>

    <div class="mcw-scene">
      <!-- ══ SKY LAYER ══ -->
      <div class="mcw-sky">
        <div class="mcw-cloud cloud1"></div>
        <div class="mcw-cloud cloud2"></div>
        <div class="mcw-cloud cloud3"></div>
        <div class="mcw-sun"></div>
      </div>

      <!-- ══ SURFACE LAYER ══ -->
      <div class="mcw-surface">
        <!-- Farm 3x3 -->
        <div class="mcw-section farm-section">
          <div class="mcw-farm-grid">
            <div
              v-for="(crop, idx) in crops"
              :key="idx"
              class="mcw-tile"
              @click="handleTileClick(idx)"
              title="Click to grow / harvest"
            >
              <div class="mcw-farmland"></div>
              <div class="mcw-crop" :class="[`stage-${crop.stage}`, { growing: crop.growing }]"></div>
              <div class="mcw-tile-hover"></div>
            </div>
          </div>
          <div class="mcw-grass-row">
            <div v-for="i in 3" :key="i" class="mcw-grass-block" :style="grassBlockStyle"></div>
          </div>
        </div>

        <!-- Oak Tree -->
        <div class="mcw-section tree-section">
          <div class="mcw-tree">
            <div class="mcw-leaves"></div>
            <div class="mcw-trunk" :style="trunkStyle"></div>
            <div class="mcw-trunk" :style="trunkStyle"></div>
          </div>
          <div class="mcw-grass-block wide" :style="grassBlockStyle"></div>
        </div>

        <!-- Sign -->
        <div class="mcw-section sign-section">
          <div class="mcw-sign-container" @click="cycleSignMessage" title="Click to change message">
            <div class="mcw-sign-face" :style="signStyle">
              <div class="mcw-sign-line name">{{ signMessages[signIdx][0] }}</div>
              <div class="mcw-sign-line">{{ signMessages[signIdx][1] }}</div>
              <div class="mcw-sign-line small">{{ signMessages[signIdx][2] }}</div>
              <div class="mcw-sign-line link">{{ signMessages[signIdx][3] }}</div>
            </div>
            <div class="mcw-sign-post" :style="signPostStyle"></div>
          </div>
          <div class="mcw-grass-block wide" :style="grassBlockStyle"></div>
        </div>

        <!-- Door + Pressure Plate -->
        <div class="mcw-section door-section">
          <div class="mcw-door-frame">
            <div class="mcw-door" :class="{ open: doorOpen }" :style="doorStyle"></div>
            <div class="mcw-door-bg"></div>
          </div>
          <div class="mcw-pressure-plate-area">
            <div
              class="mcw-grass-block door-grass"
              :style="grassBlockStyle"
              @mouseenter="doorOpen = true"
              @mouseleave="doorOpen = false"
            >
              <div class="mcw-pressure-plate" :class="{ pressed: doorOpen }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ UNDERGROUND LAYER ══ -->
      <div class="mcw-underground">
        <!-- Underground left filler -->
        <div class="mcw-ug-row row1">
          <div class="mcw-stone" v-for="i in 2" :key="i" :style="stoneStyle"></div>
          <!-- Crafting Table -->
          <div class="mcw-crafting-table" @click="openCrafting" title="Click to craft">
            <img v-if="tex.craftingTable" :src="tex.craftingTable" class="block-tex" alt="crafting table" />
            <template v-else>
              <div class="ct-top"></div>
              <div class="ct-front"></div>
            </template>
          </div>
          <!-- TNT + Button -->
          <div class="mcw-tnt-area">
            <div class="mcw-tnt" :class="{ flash: tntFlashing }" ref="tntRef">
              <div class="tnt-label">TNT</div>
            </div>
            <div
              class="mcw-button"
              :class="{ pressed: buttonPressed }"
              @click="triggerTNT"
              title="Don't press this"
            ></div>
          </div>
          <!-- Obsidian blocks -->
          <div
            v-for="(obs, oi) in obsidianBlocks"
            :key="'obs' + oi"
            class="mcw-obsidian"
            :class="{ minable: hasPickaxe, cracked1: obs.cracks === 1, cracked2: obs.cracks === 2 }"
            @click="mineObsidian(oi)"
            :title="hasPickaxe ? 'Mine obsidian (click 3x)' : 'Need diamond pickaxe'"
            :style="{ cursor: hasPickaxe ? 'crosshair' : 'default' }"
          >
            <img v-if="tex.obsidian" :src="tex.obsidian" class="block-tex" alt="obsidian" />
            <div class="obs-crack-overlay" v-if="obs.cracks > 0"></div>
          </div>
          <div class="mcw-stone" v-for="i in 2" :key="i + 10" :style="stoneStyle"></div>
        </div>

        <!-- Redstone row -->
        <div class="mcw-ug-row row2">
          <div class="mcw-stone" :style="stoneStyle"></div>
          <!-- Lever -->
          <div class="mcw-lever-block" @click="toggleLever" title="Pull the lever!">
            <div class="lever-base"></div>
            <div class="lever-arm" :class="{ on: leverOn }"></div>
          </div>
          <!-- Redstone dust x3 -->
          <div
            v-for="(rd, ri) in redstoneTiles"
            :key="ri"
            class="mcw-redstone-tile"
            :class="{ lit: rd.lit }"
          ></div>
          <!-- Piston -->
          <div class="mcw-piston" :class="{ retracted: leverOn }">
            <div class="piston-body"></div>
            <div class="piston-head"></div>
          </div>
          <!-- Info panel / stone block -->
          <div class="mcw-info-block" :class="{ revealed: leverOn }">
            <div class="stone-cover" :class="{ hidden: leverOn }" :style="stoneStyle"></div>
            <div class="info-panel" :class="{ visible: leverOn, flicker: leverOn && panelFlickering }">
              <div class="ip-title">🔧 Current Projects</div>
              <div class="ip-item">• kotodama — iOS app</div>
              <div class="ip-item">• visual-cs — viz</div>
              <div class="ip-item">• AVM — memory system</div>
              <div class="ip-item">• redscript — compiler</div>
            </div>
          </div>
          <div class="mcw-stone" :style="stoneStyle"></div>
        </div>

        <!-- Portal frame row -->
        <div class="mcw-ug-row row3 portal-row" v-if="showPortalArea">
          <div class="portal-hint" v-if="!portalComplete && !portalActive">
            🟣 You have enough obsidian to build a Nether Portal...
          </div>
          <div class="portal-grid">
            <div
              v-for="(cell, pi) in portalGrid"
              :key="pi"
              class="portal-cell"
              :class="{
                'portal-filled': cell,
                'portal-inner': isPortalInner(pi),
                'portal-glow': portalActive
              }"
              @click="placePortalBlock(pi)"
              :title="cell ? 'Obsidian' : (isPortalInner(pi) ? (portalActive ? 'Active portal' : 'Empty') : 'Click to place obsidian')"
            >
              <img v-if="cell && tex.obsidian" :src="tex.obsidian" class="block-tex" alt="obsidian" />
              <div v-else-if="cell" class="portal-obs-fallback"></div>
              <div v-else-if="portalActive && isPortalInner(pi)" class="portal-swirl"></div>
            </div>
          </div>
        </div>

        <!-- Bottom stone row -->
        <div class="mcw-ug-row row3" v-if="!showPortalArea">
          <div class="mcw-stone" v-for="i in 8" :key="i" :style="stoneStyle"></div>
        </div>
      </div>

      <!-- TNT Crater -->
      <div class="mcw-crater" :class="{ visible: craterVisible }">
        <div class="crater-msg">
          <div>💥 You found a secret!</div>
          <div class="crater-quote">"There are only two hard things</div>
          <div class="crater-quote"> in CS: cache invalidation,</div>
          <div class="crater-quote"> naming things, and off-by-one errors."</div>
        </div>
      </div>
    </div>

    <!-- ══ CRAFTING OVERLAY ══ -->
    <div class="mcw-overlay" v-if="craftingOpen" @click.self="craftingOpen = false">
      <div class="mcw-crafting-ui">
        <div class="cui-title">Crafting Table</div>

        <!-- Recipe tabs -->
        <div class="cui-tabs">
          <div class="cui-tab" :class="{ active: craftTab === 'bread' }" @click="craftTab = 'bread'">🍞 Bread</div>
          <div class="cui-tab" :class="{ active: craftTab === 'pickaxe' }" @click="craftTab = 'pickaxe'">⛏️ Pickaxe</div>
          <div class="cui-tab" :class="{ active: craftTab === 'flint' }" @click="craftTab = 'flint'">🔥 Flint&Steel</div>
        </div>

        <!-- Bread recipe -->
        <template v-if="craftTab === 'bread'">
          <div class="cui-recipe-hint">Recipe: 3+ wheat</div>
          <div class="cui-grid">
            <div v-for="(slot, i) in craftSlots" :key="i" class="cui-slot" :class="{ filled: slot }">
              {{ slot ? '🌾' : '' }}
            </div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: craftReady }">
            <span v-if="craftReady">🍞</span>
          </div>
          <div class="cui-btn" @click="doCraft">Craft</div>
        </template>

        <!-- Diamond Pickaxe recipe -->
        <template v-if="craftTab === 'pickaxe'">
          <div class="cui-recipe-hint">Recipe: 2 diamonds (top row) + 1 wood (bottom-right)</div>
          <div class="cui-grid2x2">
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[0] }" @click="togglePickaxeSlot(0)">
              <img v-if="pickaxeSlots[0] && tex.diamond" :src="tex.diamond" class="slot-tex" />
              <span v-else-if="pickaxeSlots[0]">💎</span>
              <span v-else class="slot-hint" :title="'Need: diamond (' + (inventory.diamond||0) + ')'">{{ inventory.diamond ? '💎?' : '' }}</span>
            </div>
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[1] }" @click="togglePickaxeSlot(1)">
              <img v-if="pickaxeSlots[1] && tex.diamond" :src="tex.diamond" class="slot-tex" />
              <span v-else-if="pickaxeSlots[1]">💎</span>
            </div>
            <div class="cui-slot2"><!-- empty --></div>
            <div class="cui-slot2" :class="{ filled: pickaxeSlots[3] }" @click="togglePickaxeSlot(3)">
              <img v-if="pickaxeSlots[3] && tex.oakPlanks" :src="tex.oakPlanks" class="slot-tex" />
              <span v-else-if="pickaxeSlots[3]">🪵</span>
            </div>
          </div>
          <div class="cui-recipe-legend">
            <div>Slots 0,1: diamond (have: {{ inventory.diamond || 0 }})</div>
            <div>Slot 3: wood/stick (have: {{ inventory.wood || 0 }})</div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: pickaxeReady }">
            <span v-if="pickaxeReady">⛏️</span>
          </div>
          <div class="cui-btn" @click="craftPickaxe">Craft Pickaxe</div>
        </template>

        <!-- Flint & Steel recipe -->
        <template v-if="craftTab === 'flint'">
          <div class="cui-recipe-hint">Recipe: flint (top-left) + iron ingot (bottom-right)</div>
          <div class="cui-grid2x2">
            <div class="cui-slot2" :class="{ filled: flintSlots[0] }" @click="toggleFlintSlot(0)">
              <img v-if="flintSlots[0] && tex.flint" :src="tex.flint" class="slot-tex" />
              <span v-else-if="flintSlots[0]">🪨</span>
            </div>
            <div class="cui-slot2"><!-- empty --></div>
            <div class="cui-slot2"><!-- empty --></div>
            <div class="cui-slot2" :class="{ filled: flintSlots[3] }" @click="toggleFlintSlot(3)">
              <img v-if="flintSlots[3] && tex.ironIngot" :src="tex.ironIngot" class="slot-tex" />
              <span v-else-if="flintSlots[3]">⚙️</span>
            </div>
          </div>
          <div class="cui-recipe-legend">
            <div>Slot 0: flint (have: {{ inventory.flint || 0 }})</div>
            <div>Slot 3: iron ingot (have: {{ inventory.iron || 0 }})</div>
          </div>
          <div class="cui-arrow">▶</div>
          <div class="cui-output" :class="{ ready: flintReady }">
            <span v-if="flintReady">🔥</span>
          </div>
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
        <img v-if="item.tex" :src="item.tex" class="slot-tex" />
        <span v-else>{{ item.icon }}</span>
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

    <!-- ══ PHYSICS DROPS LAYER ══ -->
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
import { ref, reactive, computed, onUnmounted } from 'vue'

// ── Textures ──────────────────────────────────────────────────────────────────

const tex = reactive({
  grassBlock: null,
  stone: null,
  obsidian: null,
  craftingTable: null,
  oakPlanks: null,
  diamond: null,
  diamondBlock: null,
  flint: null,
  ironIngot: null,
  stick: null,
  netherrack: null,
  glowstone: null,
})

// Load textures async to avoid blocking initial render
import('minecraft-textures/dist/textures/json/1.20.id.json').then(mod => {
  const data = mod.default || mod
  const items = data.items
  const get = (id) => items['minecraft:' + id]?.texture || null
  tex.grassBlock   = get('grass_block')
  tex.stone        = get('stone')
  tex.obsidian     = get('obsidian')
  tex.craftingTable = get('crafting_table')
  tex.oakPlanks    = get('oak_planks')
  tex.diamond      = get('diamond')
  tex.diamondBlock = get('diamond_block')
  tex.flint        = get('flint')
  tex.ironIngot    = get('iron_ingot')
  tex.stick        = get('stick')
  tex.netherrack   = get('netherrack')
  tex.glowstone    = get('glowstone')
}).catch(() => {})

const grassBlockStyle = computed(() => tex.grassBlock ? {
  backgroundImage: `url("${tex.grassBlock}")`,
  backgroundSize: 'cover',
  imageRendering: 'pixelated',
} : {})

const stoneStyle = computed(() => tex.stone ? {
  backgroundImage: `url("${tex.stone}")`,
  backgroundSize: 'cover',
  imageRendering: 'pixelated',
} : {})

const trunkStyle = computed(() => tex.oakPlanks ? {
  backgroundImage: `url("${tex.oakPlanks}")`,
  backgroundSize: 'cover',
  imageRendering: 'pixelated',
} : {})

const signStyle = computed(() => tex.oakPlanks ? {
  backgroundImage: `url("${tex.oakPlanks}")`,
  backgroundSize: 'cover',
  imageRendering: 'pixelated',
} : {})

const signPostStyle = computed(() => tex.stick ? {} : {})

const doorStyle = computed(() => tex.oakPlanks ? {
  backgroundImage: `url("${tex.oakPlanks}")`,
  backgroundSize: 'cover',
  imageRendering: 'pixelated',
} : {})

// ── State ─────────────────────────────────────────────────────────────────────

const wrapperRef = ref(null)
const interacted = ref(false)
const shaking = ref(false)
let dropIdCounter = 0
const activeDrops = reactive([])

// ── Inventory ─────────────────────────────────────────────────────────────────

const inventory = reactive({
  wheat: 0,
  diamond: 0,
  obsidian: 0,
  wood: 5, // give player some wood by default
  flint: 1, // give flint
  iron: 1,  // give iron ingot
  pickaxe: 0,
  flintSteel: 0,
})

const equippedItem = ref(null)

const hotbarItems = computed(() => {
  const items = []
  if (inventory.diamond > 0) items.push({ key: 'diamond', icon: '💎', label: 'Diamond', tex: tex.diamond })
  if (inventory.obsidian > 0) items.push({ key: 'obsidian', icon: '⬛', label: 'Obsidian', tex: tex.obsidian })
  if (inventory.pickaxe > 0) items.push({ key: 'pickaxe', icon: '⛏️', label: 'Diamond Pickaxe', tex: null })
  if (inventory.flintSteel > 0) items.push({ key: 'flintSteel', icon: '🔥', label: 'Flint & Steel', tex: null })
  if (inventory.wheat > 0) items.push({ key: 'wheat', icon: '🌾', label: 'Wheat', tex: null })
  return items
})

const hasPickaxe = computed(() => inventory.pickaxe > 0)

function equipItem(key) {
  equippedItem.value = equippedItem.value === key ? null : key
}

// ── Farm ─────────────────────────────────────────────────────────────────────

const crops = reactive(
  Array.from({ length: 9 }, () => ({ stage: Math.floor(Math.random() * 4), growing: false }))
)
let harvestCount = ref(0)

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
  const col = idx % 3
  const row = Math.floor(idx / 3)
  const TILE = 48
  const GRID_LEFT = 16
  const GRID_TOP = 60
  spawnDrops(
    GRID_LEFT + col * TILE + TILE / 2,
    GRID_TOP + row * TILE + TILE / 2,
    [{ icon: '🌾', chance: 0.6 }, { icon: '🌱', chance: 1 }]
  )
  triggerShake()
  crops[idx].stage = 0
  harvestCount.value++
  inventory.wheat++
  // Populate crafting slots with wheat
  for (let i = 0; i < craftSlots.length && harvestCount.value > 0; i++) {
    if (!craftSlots[i]) { craftSlots[i] = true; break }
  }
  // Chance to find diamond (1 in 8)
  if (Math.random() < 0.125) {
    inventory.diamond++
    craftMsg.value = '💎 You found a diamond while farming! Lucky!'
    setTimeout(() => { if (craftMsg.value.includes('diamond')) craftMsg.value = '' }, 3000)
  }
}

// ── Sign ─────────────────────────────────────────────────────────────────────

const signMessages = [
  ['Yuzhe / bkmashiro', 'Imperial College London', 'Full-stack · Systems · AI', 'github.com/bkmashiro'],
  ['Currently:', 'debugging at 2am', '☕ send help', ''],
  ['Status:', 'building cool stuff', '🔨 always', ''],
  ['Skills:', 'TypeScript > sleep', 'CSS > sanity', ''],
  ['Fun fact:', 'made a Minecraft', 'widget instead of', 'touching grass'],
]
const signIdx = ref(0)

function cycleSignMessage() {
  interacted.value = true
  signIdx.value = (signIdx.value + 1) % signMessages.length
}

// ── Door ─────────────────────────────────────────────────────────────────────

const doorOpen = ref(false)

// ── Crafting ─────────────────────────────────────────────────────────────────

const craftingOpen = ref(false)
const craftTab = ref('bread')
const craftSlots = reactive(Array(4).fill(false))
const craftMsg = ref('')
const craftReady = computed(() => craftSlots.filter(Boolean).length >= 3)

// Pickaxe slots: [top-left diamond, top-right diamond, bottom-left empty, bottom-right wood]
const pickaxeSlots = reactive([false, false, false, false])
const pickaxeReady = computed(() => pickaxeSlots[0] && pickaxeSlots[1] && pickaxeSlots[3])

// Flint & Steel slots: [top-left flint, top-right empty, bottom-left empty, bottom-right iron]
const flintSlots = reactive([false, false, false, false])
const flintReady = computed(() => flintSlots[0] && flintSlots[3])

function openCrafting() {
  interacted.value = true
  craftingOpen.value = true
  craftMsg.value = ''
}

function doCraft() {
  if (craftReady.value) {
    for (let i = 0; i < craftSlots.length; i++) craftSlots[i] = false
    craftMsg.value = '🍞 Bread crafted! +1 sustenance. Yuzhe approves.'
    inventory.wheat = Math.max(0, inventory.wheat - 3)
    harvestCount.value = Math.max(0, harvestCount.value - 3)
  } else {
    craftMsg.value = '⚠ You need wheat. Go farm something.'
  }
}

function togglePickaxeSlot(i) {
  if (i === 0 || i === 1) {
    if (!pickaxeSlots[i] && (inventory.diamond || 0) < (pickaxeSlots[0] + pickaxeSlots[1] + 1)) {
      craftMsg.value = '⚠ Not enough diamonds!'
      return
    }
    pickaxeSlots[i] = !pickaxeSlots[i]
  } else if (i === 3) {
    if (!pickaxeSlots[3] && (inventory.wood || 0) < 1) {
      craftMsg.value = '⚠ No wood!'
      return
    }
    pickaxeSlots[3] = !pickaxeSlots[3]
  }
}

function craftPickaxe() {
  if (!pickaxeReady.value) {
    craftMsg.value = '⚠ Need: 2 diamonds (top) + 1 wood (bottom-right)'
    return
  }
  if ((inventory.diamond || 0) < 2) { craftMsg.value = '⚠ Not enough diamonds!'; return }
  if ((inventory.wood || 0) < 1) { craftMsg.value = '⚠ No wood!'; return }
  inventory.diamond -= 2
  inventory.wood -= 1
  inventory.pickaxe++
  for (let i = 0; i < 4; i++) pickaxeSlots[i] = false
  craftMsg.value = '⛏️ Diamond Pickaxe crafted! Ready to mine obsidian.'
  equipItem('pickaxe')
}

function toggleFlintSlot(i) {
  if (i === 0) {
    if (!flintSlots[0] && (inventory.flint || 0) < 1) { craftMsg.value = '⚠ No flint!'; return }
    flintSlots[0] = !flintSlots[0]
  } else if (i === 3) {
    if (!flintSlots[3] && (inventory.iron || 0) < 1) { craftMsg.value = '⚠ No iron ingot!'; return }
    flintSlots[3] = !flintSlots[3]
  }
}

function craftFlintSteel() {
  if (!flintReady.value) {
    craftMsg.value = '⚠ Need: flint (top-left) + iron ingot (bottom-right)'
    return
  }
  if ((inventory.flint || 0) < 1) { craftMsg.value = '⚠ No flint!'; return }
  if ((inventory.iron || 0) < 1) { craftMsg.value = '⚠ No iron ingot!'; return }
  inventory.flint -= 1
  inventory.iron -= 1
  inventory.flintSteel++
  for (let i = 0; i < 4; i++) flintSlots[i] = false
  craftMsg.value = '🔥 Flint & Steel crafted! You can light portals now.'
  equipItem('flintSteel')
}

// ── Obsidian Mining ───────────────────────────────────────────────────────────

const obsidianBlocks = reactive([
  { cracks: 0 }, { cracks: 0 }, { cracks: 0 },
  { cracks: 0 }, { cracks: 0 }, { cracks: 0 },
  { cracks: 0 }, { cracks: 0 }, { cracks: 0 },
  { cracks: 0 },
])

function mineObsidian(idx) {
  if (!hasPickaxe.value) return
  interacted.value = true
  const obs = obsidianBlocks[idx]
  if (obs.cracks < 3) {
    obs.cracks++
    triggerShake()
    if (obs.cracks >= 3) {
      // Block breaks
      setTimeout(() => {
        spawnDrops(60 + idx * 44, 390, [{ icon: '⬛', chance: 1 }], 2, false)
        obsidianBlocks.splice(idx, 1)
        inventory.obsidian++
        craftMsg.value = `⬛ Obsidian mined! (${inventory.obsidian}/10)`
        if (inventory.obsidian >= 10) {
          craftMsg.value = '⬛ You have enough obsidian to build a Nether Portal! 🟣'
        }
      }, 150)
    }
  }
}

// ── Portal Frame ──────────────────────────────────────────────────────────────

// 4x5 grid, frame positions (0-indexed, row-major)
// Frame: row 0 all, row 4 all, col 0 and col 3 for rows 1-3
const PORTAL_COLS = 4
const PORTAL_ROWS = 5
const TOTAL_CELLS = PORTAL_COLS * PORTAL_ROWS

const portalGrid = reactive(Array(TOTAL_CELLS).fill(false))
const portalActive = ref(false)

const showPortalArea = computed(() => inventory.obsidian >= 10 || portalFrameComplete.value || portalActive.value)

function isPortalInner(idx) {
  const row = Math.floor(idx / PORTAL_COLS)
  const col = idx % PORTAL_COLS
  return row >= 1 && row <= 3 && col >= 1 && col <= 2
}

function isPortalFrame(idx) {
  const row = Math.floor(idx / PORTAL_COLS)
  const col = idx % PORTAL_COLS
  return !isPortalInner(idx)
}

const portalFrameComplete = computed(() => {
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (isPortalFrame(i) && !portalGrid[i]) return false
  }
  return true
})

function placePortalBlock(idx) {
  if (portalActive.value) {
    // Click interior to activate if frame complete + flint equipped
    if (isPortalInner(idx) && portalFrameComplete.value && equippedItem.value === 'flintSteel') {
      activatePortal()
    } else if (isPortalInner(idx) && portalActive.value) {
      enterPortal()
    }
    return
  }
  if (isPortalInner(idx)) {
    if (portalFrameComplete.value && equippedItem.value === 'flintSteel') {
      activatePortal()
    }
    return
  }
  // Place obsidian in frame slot
  if (!portalGrid[idx] && (inventory.obsidian > 0)) {
    portalGrid[idx] = true
    inventory.obsidian--
    interacted.value = true
  }
}

function activatePortal() {
  if (portalActive.value) return
  inventory.flintSteel = Math.max(0, inventory.flintSteel - 1)
  portalActive.value = true
  equippedItem.value = null
  craftMsg.value = '🔥 The portal ignites... 🟣'
}

function enterPortal() {
  window.open('/nether', '_blank')
}

// ── Redstone Lever ───────────────────────────────────────────────────────────

const leverOn = ref(false)
const panelFlickering = ref(false)
const redstoneTiles = reactive([{ lit: true }, { lit: true }, { lit: true }])

function toggleLever() {
  interacted.value = true
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

// ── TNT ───────────────────────────────────────────────────────────────────────

const tntFlashing = ref(false)
const buttonPressed = ref(false)
const craterVisible = ref(false)
let tntCooldown = false

function triggerTNT() {
  if (tntCooldown) return
  interacted.value = true
  tntCooldown = true
  buttonPressed.value = true
  setTimeout(() => { buttonPressed.value = false }, 200)

  tntFlashing.value = true
  setTimeout(() => {
    tntFlashing.value = false
    triggerShake()
    const cx = 420, cy = 340
    for (let i = 0; i < 18; i++) {
      const icons = ['🪨', '💥', '🔥', '⬛', '🟫']
      spawnDrops(
        cx + (Math.random() - 0.5) * 40,
        cy + (Math.random() - 0.5) * 20,
        icons.map(icon => ({ icon, chance: 1 })),
        1,
        true
      )
    }
    // TNT also gives flint & iron
    inventory.flint += 1
    inventory.iron += 1
    craterVisible.value = true
    setTimeout(() => {
      craterVisible.value = false
      tntCooldown = false
    }, 5000)
  }, 1500)
}

// ── Physics drops ─────────────────────────────────────────────────────────────

function spawnDrops(originX, originY, types, count = null, explosive = false) {
  const n = count ?? (2 + Math.floor(Math.random() * 3))
  for (let i = 0; i < n; i++) {
    const roll = Math.random()
    let chosen = types[types.length - 1].icon
    let acc = 0
    for (const t of types) {
      acc += t.chance
      if (roll <= acc) { chosen = t.icon; break }
    }
    const spread = explosive ? 12 : 6
    const vx = (Math.random() - 0.5) * spread
    const vy = explosive ? -(6 + Math.random() * 8) : -(4 + Math.random() * 4)
    const drop = reactive({
      id: ++dropIdCounter,
      icon: chosen,
      x: originX - 8,
      y: originY - 8,
      vx,
      vy,
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
  const GRAVITY = 0.38
  const FLOOR_Y = 480
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
      fadeOut(drop)
      return
    }
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  onUnmounted(() => cancelAnimationFrame(frame))
}

function fadeOut(drop) {
  let step = 0
  const STEPS = 40
  let frame

  function tick() {
    step++
    drop.opacity = 1 - step / STEPS
    if (step < STEPS) {
      frame = requestAnimationFrame(tick)
    } else {
      const idx = activeDrops.findIndex(d => d.id === drop.id)
      if (idx !== -1) activeDrops.splice(idx, 1)
    }
  }
  frame = requestAnimationFrame(tick)
  onUnmounted(() => cancelAnimationFrame(frame))
}

// ── Screen shake ──────────────────────────────────────────────────────────────

function triggerShake() {
  shaking.value = true
  setTimeout(() => (shaking.value = false), 400)
}
</script>

<style scoped>
/* ══ Root wrapper ════════════════════════════════════════════════════════════ */
.mcw-wrapper {
  position: relative;
  font-family: "Courier New", monospace;
  image-rendering: pixelated;
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

/* ══ Scene container ════════════════════════════════════════════════════════ */
.mcw-scene {
  position: relative;
  width: 780px;
  max-width: 100%;
  border: 3px solid #3a5a3a;
  box-shadow: 0 0 0 3px #1a3a0a, 4px 4px 0 6px #0a1a04;
  overflow: hidden;
}

@keyframes shake {
  0%   { transform: translate(0, 0); }
  15%  { transform: translate(-4px, 3px); }
  30%  { transform: translate(4px, -3px); }
  45%  { transform: translate(-3px, 4px); }
  60%  { transform: translate(3px, -2px); }
  80%  { transform: translate(-2px, 2px); }
  100% { transform: translate(0, 0); }
}
.mcw-wrapper.shake .mcw-scene {
  animation: shake 0.4s ease-out;
}

/* ══ Texture helpers ════════════════════════════════════════════════════════ */
.block-tex {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  display: block;
  object-fit: cover;
}
.slot-tex {
  width: 28px;
  height: 28px;
  image-rendering: pixelated;
}

/* ══ Sky layer ══════════════════════════════════════════════════════════════ */
.mcw-sky {
  background: linear-gradient(to bottom, #5a9fd4 0%, #87CEEB 60%, #a8d8f0 100%);
  height: 80px;
  position: relative;
  overflow: hidden;
}

.mcw-sun {
  position: absolute;
  top: 10px;
  right: 40px;
  width: 24px;
  height: 24px;
  background: #ffe060;
  box-shadow: 0 0 0 4px #ffe060, 0 0 12px 4px rgba(255,220,60,0.5);
}

.mcw-cloud {
  position: absolute;
  background: white;
  height: 14px;
  border-radius: 0;
}
.mcw-cloud::before, .mcw-cloud::after {
  content: '';
  position: absolute;
  background: white;
  height: 14px;
}
.cloud1 { width: 60px; top: 18px; animation: drift1 22s linear infinite; }
.cloud1::before { width: 28px; height: 14px; top: -14px; left: 8px; }
.cloud1::after  { width: 20px; height: 14px; top: -10px; left: 28px; }
.cloud2 { width: 48px; top: 28px; animation: drift2 30s linear infinite; }
.cloud2::before { width: 22px; height: 14px; top: -14px; left: 6px; }
.cloud2::after  { width: 16px; height: 14px; top: -10px; left: 22px; }
.cloud3 { width: 38px; top: 10px; animation: drift3 18s linear infinite; }
.cloud3::before { width: 18px; height: 14px; top: -14px; left: 4px; }
.cloud3::after  { width: 14px; height: 10px; top: -8px; left: 16px; }

@keyframes drift1 { from { left: -80px; } to { left: 820px; } }
@keyframes drift2 { from { left: 200px; } to { left: 900px; } }
@keyframes drift3 { from { left: 500px; } to { left: 1100px; } }

/* ══ Surface layer ══════════════════════════════════════════════════════════ */
.mcw-surface {
  background: #3a1a0a;
  display: flex;
  align-items: flex-end;
  gap: 0;
  min-height: 170px;
  padding: 0;
  position: relative;
}

.mcw-section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 8px 0;
}

.farm-section { padding-top: 12px; }

.mcw-farm-grid {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(3, 44px);
  gap: 2px;
}

.mcw-tile {
  position: relative;
  width: 44px;
  height: 44px;
  cursor: pointer;
}
.mcw-tile:hover .mcw-tile-hover { opacity: 1; }
.mcw-tile-hover {
  position: absolute;
  inset: 0;
  background: rgba(255,255,200,0.1);
  border: 2px solid rgba(255,255,200,0.3);
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}

.mcw-farmland {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(90deg, transparent 0, transparent 9px, rgba(90,58,26,0.4) 9px, rgba(90,58,26,0.4) 10px),
    repeating-linear-gradient(0deg, transparent 0, transparent 9px, rgba(90,58,26,0.3) 9px, rgba(90,58,26,0.3) 10px),
    #5a3a1a;
  border-bottom: 3px solid #3a2008;
  border-right: 2px solid #3a2008;
  border-top: 1px solid #7a5a2a;
}

.mcw-crop {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  image-rendering: pixelated;
  transition: height 0.18s ease-out;
}
.mcw-crop.stage-0 { width: 5px; height: 3px; background: #8b6914; border-radius: 1px; bottom: 4px; }
.mcw-crop.stage-1 {
  width: 8px; height: 14px;
  background: linear-gradient(to top, #5a8a10, #7ab820 60%, #5a8a10);
  clip-path: polygon(40% 100%, 60% 100%, 70% 40%, 55% 0%, 45% 0%, 30% 40%);
}
.mcw-crop.stage-2 {
  width: 11px; height: 24px;
  background: linear-gradient(to top, #3a7010, #6aaa10 50%, #b8960c);
  clip-path: polygon(35% 100%, 65% 100%, 70% 65%, 85% 55%, 80% 45%, 65% 50%, 68% 20%, 55% 0%, 45% 0%, 32% 20%, 35% 50%, 20% 45%, 15% 55%, 30% 65%);
}
.mcw-crop.stage-3 {
  width: 15px; height: 38px;
  background: linear-gradient(to top, #5a7a10 0%, #8aaa10 30%, #d4b800 65%, #f0d700 100%);
  clip-path: polygon(40% 100%, 60% 100%, 65% 70%, 80% 62%, 90% 48%, 75% 42%, 72% 28%, 85% 18%, 78% 8%, 62% 14%, 55% 0%, 45% 0%, 38% 14%, 22% 8%, 15% 18%, 28% 28%, 25% 42%, 10% 48%, 20% 62%, 35% 70%);
  filter: drop-shadow(0 0 3px rgba(240,215,0,0.5));
}
@keyframes pop-grow {
  0%   { transform: translateX(-50%) scale(0.7); }
  60%  { transform: translateX(-50%) scale(1.15); }
  100% { transform: translateX(-50%) scale(1); }
}
.mcw-crop.growing { animation: pop-grow 0.25s ease-out forwards; }

.mcw-grass-row { display: flex; gap: 2px; margin-top: 2px; }

.mcw-grass-block {
  width: 44px; height: 24px;
  background: linear-gradient(to bottom, #4a7a2a 0%, #4a7a2a 6px, #8B4513 6px, #8B4513 100%);
  border-top: 2px solid #5a9a3a;
  border-right: 2px solid #3a5a18;
  border-bottom: 2px solid #5a3010;
  border-left: 2px solid #5a9a3a;
  position: relative;
}
.mcw-grass-block.wide { width: 90px; }
.mcw-grass-block.door-grass { width: 54px; height: 24px; }

/* ══ Oak Tree ═══════════════════════════════════════════════════════════════ */
.tree-section { align-items: center; }

.mcw-tree {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mcw-leaves {
  width: 72px; height: 54px;
  background: #2d5a1b;
  border: 2px solid #1d4a0b;
  position: relative;
  margin-bottom: -2px;
}
.mcw-leaves::before {
  content: '';
  position: absolute;
  inset: 6px;
  background: #3a6a22;
}
@keyframes leaf-sway {
  0%, 100% { transform: rotate(-1deg); }
  50%       { transform: rotate(1.5deg); }
}
.mcw-leaves { transform-origin: bottom center; animation: leaf-sway 4s ease-in-out infinite; }

.mcw-trunk {
  width: 20px; height: 24px;
  background: linear-gradient(to right, #6b4a14, #c8a86a 40%, #6b4a14);
  border-left: 2px solid #4a3008;
  border-right: 2px solid #4a3008;
}

/* ══ Sign ═══════════════════════════════════════════════════════════════════ */
.sign-section { align-items: center; justify-content: flex-end; cursor: pointer; }

.mcw-sign-container {
  perspective: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mcw-sign-face {
  transform: rotateY(-8deg);
  width: 120px;
  background: #c8a86a;
  border: 3px solid #8b6914;
  border-bottom: 4px solid #6b4a0a;
  border-right: 4px solid #6b4a0a;
  padding: 5px 6px;
  box-shadow: 2px 2px 0 #4a3008, inset 0 0 8px rgba(0,0,0,0.15);
  position: relative;
  min-height: 72px;
  transition: transform 0.2s;
}
.mcw-sign-container:hover .mcw-sign-face { transform: rotateY(-4deg) scale(1.02); }
.mcw-sign-face::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, transparent 0, transparent 7px, rgba(100,60,10,0.12) 7px, rgba(100,60,10,0.12) 8px);
  pointer-events: none;
}
.mcw-sign-line {
  font-size: 8px; font-weight: bold; line-height: 1.65; color: #1a1008;
  letter-spacing: 0.5px; white-space: nowrap; position: relative;
}
.mcw-sign-line.name { font-size: 8.5px; border-bottom: 1px solid rgba(0,0,0,0.2); padding-bottom: 2px; margin-bottom: 2px; }
.mcw-sign-line.small { font-size: 7.5px; }
.mcw-sign-line.link { font-size: 7px; color: #2a4080; }

.mcw-sign-post {
  width: 8px; height: 44px;
  background: linear-gradient(to right, #a07830, #c8a86a 40%, #a07830);
  border: 1px solid #6b4a0a;
}

/* ══ Door ═══════════════════════════════════════════════════════════════════ */
.door-section { padding-right: 12px; justify-content: flex-end; }

.mcw-door-frame {
  width: 30px; height: 60px;
  position: relative;
  border: 2px solid #5a3a0a;
  background: #1a0a00;
  overflow: hidden;
}
.mcw-door-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, #0a0500 0%, #1a0a00 50%, #050200 100%);
}
.mcw-door {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, #c8a86a 0%, #a07830 50%, #7a5a20 100%);
  border-right: 2px solid #4a2a00;
  transform-origin: left center;
  transition: transform 0.35s ease;
  z-index: 1;
}
.mcw-door::before {
  content: '';
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 5px; height: 5px;
  background: #d4aa00;
  border-radius: 50%;
}
.mcw-door.open { transform: perspective(200px) rotateY(-80deg); }

.mcw-pressure-plate-area { margin-top: 2px; }
.mcw-pressure-plate {
  position: absolute;
  bottom: 4px; left: 50%;
  transform: translateX(-50%);
  width: 24px; height: 4px;
  background: #c0c0c0;
  border: 1px solid #808080;
  transition: transform 0.1s;
}
.mcw-pressure-plate.pressed { transform: translateX(-50%) scaleY(0.5); }

/* ══ Underground ════════════════════════════════════════════════════════════ */
.mcw-underground {
  background: #1a1a2e;
  border-top: 3px solid #3a3a5a;
}

.mcw-ug-row {
  display: flex;
  align-items: stretch;
  height: 44px;
  border-bottom: 2px solid #0a0a1a;
}

.mcw-stone {
  flex: 1; min-width: 44px; height: 44px;
  background:
    repeating-linear-gradient(90deg, transparent 0, transparent 10px, rgba(60,60,80,0.3) 10px, rgba(60,60,80,0.3) 11px),
    repeating-linear-gradient(0deg, transparent 0, transparent 10px, rgba(60,60,80,0.3) 10px, rgba(60,60,80,0.3) 11px),
    #606070;
  border-right: 1px solid #4a4a5a;
  border-bottom: 2px solid #4a4a5a;
  border-top: 1px solid #7a7a8a;
}

/* ══ Obsidian ═══════════════════════════════════════════════════════════════ */
.mcw-obsidian {
  width: 44px; height: 44px;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  background: #1a0a2a;
  border: 1px solid #2a1a3a;
  transition: filter 0.1s;
}
.mcw-obsidian.minable:hover { filter: brightness(1.3); cursor: crosshair; }
.obs-crack-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}
.mcw-obsidian.cracked1 .obs-crack-overlay {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cpath d='M8 4 L14 16 L6 20 M14 16 L20 12 L26 22' stroke='rgba(255,255,255,0.4)' stroke-width='1.5' fill='none'/%3E%3C/svg%3E") center/contain no-repeat;
}
.mcw-obsidian.cracked2 .obs-crack-overlay {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Cpath d='M4 6 L12 18 L4 24 M12 18 L22 10 L28 24 M16 6 L18 14 L26 12' stroke='rgba(255,255,255,0.55)' stroke-width='1.5' fill='none'/%3E%3C/svg%3E") center/contain no-repeat;
}

/* Crafting Table */
.mcw-crafting-table {
  width: 48px; height: 44px;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: filter 0.15s;
  overflow: hidden;
}
.mcw-crafting-table:hover { filter: brightness(1.2); }
.ct-top {
  height: 14px;
  background:
    repeating-linear-gradient(90deg, transparent 0, transparent 5px, rgba(0,0,0,0.2) 5px, rgba(0,0,0,0.2) 6px),
    #c8a86a;
  border-bottom: 2px solid #8b6914;
  border-top: 1px solid #e0c080;
}
.ct-top::before {
  content: '';
  position: absolute;
  top: 2px; left: 4px; right: 4px;
  height: 2px; background: rgba(0,0,0,0.3);
}
.ct-front {
  height: 30px;
  background: #a07030;
  border-top: 1px solid #c89040;
  position: relative;
}
.ct-front::before {
  content: '⊞';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #6b4a0a;
  line-height: 30px;
  text-align: center;
}

/* TNT */
.mcw-tnt-area { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }

.mcw-tnt {
  width: 40px; height: 40px;
  position: relative;
  background:
    repeating-linear-gradient(0deg, #cc2200 0, #cc2200 10px, #f0f0f0 10px, #f0f0f0 14px, #cc2200 14px),
    #cc2200;
  border: 2px solid #881500;
  cursor: default;
}
.tnt-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: bold;
  color: #f0f0f0;
  letter-spacing: 1px;
  background: rgba(0,0,0,0.15);
}

@keyframes tnt-flash {
  0%, 100% { background: #cc2200; }
  25%       { background: #ffffff; filter: brightness(2); }
  50%       { background: #cc2200; }
  75%       { background: #ffffff; filter: brightness(2); }
}
.mcw-tnt.flash { animation: tnt-flash 0.25s steps(1) infinite; }

.mcw-button {
  width: 12px; height: 8px;
  background: #808080;
  border-top: 2px solid #a0a0a0;
  border-left: 2px solid #a0a0a0;
  border-bottom: 2px solid #404040;
  border-right: 2px solid #404040;
  cursor: pointer;
  transition: transform 0.1s;
  position: relative;
}
.mcw-button:hover { filter: brightness(1.2); }
.mcw-button.pressed { transform: translateY(2px); border-top-width: 1px; border-bottom-width: 3px; }

/* Lever */
.mcw-lever-block {
  width: 44px; height: 44px;
  background: #606070;
  border: 1px solid #4a4a5a;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
}
.mcw-lever-block:hover { filter: brightness(1.15); }

.lever-base {
  position: absolute;
  bottom: 8px; left: 50%; transform: translateX(-50%);
  width: 16px; height: 6px;
  background: #808090;
  border: 1px solid #505060;
}
.lever-arm {
  position: absolute;
  bottom: 14px; left: 50%;
  width: 4px; height: 18px;
  background: linear-gradient(to bottom, #c0a050, #a08030);
  transform-origin: bottom center;
  transform: translateX(-50%) rotate(-35deg);
  transition: transform 0.2s ease;
}
.lever-arm.on { transform: translateX(-50%) rotate(35deg); }

/* Redstone tiles */
.mcw-redstone-tile {
  flex: 1; min-width: 44px; height: 44px;
  position: relative;
  background: #505060;
  border: 1px solid #404050;
  transition: background 0.1s;
}
.mcw-redstone-tile::after {
  content: '';
  position: absolute;
  bottom: 6px; left: 4px; right: 4px;
  height: 4px;
  background: #3d0000;
  transition: background 0.1s, box-shadow 0.1s;
}
.mcw-redstone-tile.lit::after {
  background: #ff2200;
  box-shadow: 0 0 6px 2px rgba(255,34,0,0.6);
  animation: rs-pulse 1s ease-in-out infinite;
}
@keyframes rs-pulse {
  0%, 100% { box-shadow: 0 0 4px 1px rgba(255,34,0,0.5); }
  50%       { box-shadow: 0 0 10px 4px rgba(255,100,0,0.8); }
}

/* Piston */
.mcw-piston {
  width: 52px; height: 44px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0;
}
.piston-body {
  width: 32px; height: 40px;
  background: #7a7a8a;
  border: 2px solid #5a5a6a;
  border-right: none;
  position: relative;
}
.piston-body::before {
  content: '';
  position: absolute;
  top: 4px; left: 4px; right: 4px; height: 6px;
  background: #9a9aaa;
}
.piston-head {
  width: 20px; height: 36px;
  background: #c8a86a;
  border: 2px solid #8b6914;
  transition: width 0.3s ease;
}
.mcw-piston.retracted .piston-head { width: 4px; }

/* Info block */
.mcw-info-block {
  width: 90px; height: 44px;
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}
.stone-cover {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(90deg, transparent 0, transparent 10px, rgba(60,60,80,0.3) 10px, rgba(60,60,80,0.3) 11px),
    repeating-linear-gradient(0deg, transparent 0, transparent 10px, rgba(60,60,80,0.3) 10px, rgba(60,60,80,0.3) 11px),
    #606070;
  transition: opacity 0.3s;
  z-index: 2;
}
.stone-cover.hidden { opacity: 0; pointer-events: none; }

.info-panel {
  position: absolute;
  inset: 0;
  background: #1a3a1a;
  border: 1px solid #2a6a2a;
  padding: 3px 4px;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 1;
  overflow: hidden;
}
.info-panel.visible { opacity: 1; }

@keyframes flicker {
  0%   { opacity: 0; }
  20%  { opacity: 1; }
  30%  { opacity: 0.3; }
  50%  { opacity: 1; }
  65%  { opacity: 0.5; }
  80%  { opacity: 1; }
  100% { opacity: 1; }
}
.info-panel.flicker { animation: flicker 0.6s ease forwards; }

.ip-title { font-size: 7px; color: #60ff60; font-weight: bold; margin-bottom: 1px; }
.ip-item  { font-size: 6px; color: #40ff40; line-height: 1.5; }

/* ══ Portal Frame ═══════════════════════════════════════════════════════════ */
.portal-row {
  height: auto !important;
  flex-direction: column;
  padding: 6px;
  background: #0d0d1a;
  border-top: 2px solid #2a1a4a;
}
.portal-hint {
  font-size: 9px;
  color: #cc88ff;
  text-align: center;
  margin-bottom: 4px;
  letter-spacing: 0.5px;
  animation: portal-hint-pulse 2s ease-in-out infinite;
}
@keyframes portal-hint-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
.portal-grid {
  display: grid;
  grid-template-columns: repeat(4, 32px);
  grid-template-rows: repeat(5, 32px);
  gap: 2px;
  margin: 0 auto;
}
.portal-cell {
  width: 32px; height: 32px;
  background: #0a0a1a;
  border: 1px solid #1a1a2a;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s;
}
.portal-cell:not(.portal-filled):not(.portal-inner):hover {
  border-color: #9900ff;
  background: #1a0a2a;
}
.portal-cell.portal-inner {
  background: #050515;
  cursor: default;
}
.portal-cell.portal-inner.portal-glow {
  background: radial-gradient(ellipse at center, #5500aa 0%, #1a0044 60%, #050515 100%);
  animation: portal-inner-ripple 1.5s ease-in-out infinite;
  cursor: pointer;
}
@keyframes portal-inner-ripple {
  0%, 100% { background: radial-gradient(ellipse at center, #5500aa 0%, #1a0044 60%, #050515 100%); }
  50%       { background: radial-gradient(ellipse at center, #7700ff 0%, #2a0066 60%, #050515 100%); }
}
.portal-filled { background: #1a0a2a !important; border-color: #3a1a5a !important; cursor: default; }
.portal-obs-fallback {
  width: 100%; height: 100%;
  background: #1a0a2a;
  border: 1px solid #3a1a5a;
}
.portal-swirl {
  position: absolute;
  inset: 2px;
  background: radial-gradient(ellipse at center, #8800ff 0%, #4400aa 50%, transparent 100%);
  animation: portal-swirl-spin 2s linear infinite;
  border-radius: 50%;
  opacity: 0.8;
}
@keyframes portal-swirl-spin {
  from { transform: rotate(0deg) scale(0.9); }
  to   { transform: rotate(360deg) scale(1.1); }
}

/* ══ Crater ═════════════════════════════════════════════════════════════════ */
.mcw-crater {
  display: none;
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a0a00;
  border: 2px solid #cc4400;
  padding: 10px 14px;
  z-index: 20;
  text-align: center;
  box-shadow: 0 0 20px rgba(255,100,0,0.4);
}
.mcw-crater.visible { display: block; animation: crater-appear 0.3s ease; }

@keyframes crater-appear {
  from { transform: translateX(-50%) scale(0.5); opacity: 0; }
  to   { transform: translateX(-50%) scale(1); opacity: 1; }
}
.crater-msg { font-size: 10px; color: #ff8040; font-weight: bold; line-height: 1.8; }
.crater-quote { font-size: 9px; color: #ffaa60; font-weight: normal; }

/* ══ Crafting overlay ═══════════════════════════════════════════════════════ */
.mcw-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.mcw-crafting-ui {
  background: #3a3a4a;
  border: 3px solid #6a6a8a;
  padding: 16px;
  position: relative;
  min-width: 240px;
  box-shadow: 0 0 0 2px #2a2a3a, 4px 4px 0 4px #1a1a2a;
}
.cui-title {
  font-size: 11px; color: #e0e0e0; font-weight: bold;
  text-align: center; margin-bottom: 8px; letter-spacing: 1px;
}
.cui-tabs {
  display: flex; gap: 2px; margin-bottom: 8px;
}
.cui-tab {
  flex: 1; text-align: center; padding: 3px 4px;
  background: #2a2a3a; color: #888; font-size: 8px;
  cursor: pointer; border: 1px solid #4a4a6a;
  transition: background 0.1s, color 0.1s;
}
.cui-tab.active { background: #4a4a6a; color: #fff; border-color: #8a8aaa; }
.cui-tab:hover { background: #3a3a5a; color: #ccc; }

.cui-recipe-hint {
  font-size: 8px; color: #8888aa; text-align: center; margin-bottom: 6px;
}
.cui-grid {
  display: grid; grid-template-columns: repeat(2, 44px);
  grid-template-rows: repeat(2, 44px);
  gap: 3px; margin: 0 auto 10px;
  width: fit-content;
}
.cui-slot {
  width: 44px; height: 44px;
  background: #1a1a2a;
  border: 2px solid #5a5a7a;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px;
}
.cui-slot.filled { background: #2a2a4a; border-color: #8a8aaa; }

.cui-grid2x2 {
  display: grid; grid-template-columns: repeat(2, 44px);
  grid-template-rows: repeat(2, 44px);
  gap: 3px; margin: 0 auto 6px;
  width: fit-content;
}
.cui-slot2 {
  width: 44px; height: 44px;
  background: #1a1a2a;
  border: 2px solid #5a5a7a;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}
.cui-slot2:hover { background: #2a2a3a; border-color: #7a7a9a; }
.cui-slot2.filled { background: #2a2a4a; border-color: #8a8aaa; }
.slot-hint { font-size: 10px; color: #555; }

.cui-recipe-legend {
  font-size: 7px; color: #6688aa; text-align: center; margin-bottom: 4px; line-height: 1.6;
}

.cui-arrow { text-align: center; font-size: 16px; color: #a0a0c0; margin: 4px 0; }
.cui-output {
  width: 44px; height: 44px; margin: 0 auto 10px;
  background: #1a1a2a; border: 2px solid #5a5a7a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px;
}
.cui-output.ready { border-color: #aaaa40; background: #2a2a1a; }

.cui-btn {
  display: block; text-align: center; padding: 6px 16px;
  background: #4a7a2a; border: 2px solid #6aaa3a;
  color: #ccffcc; font-size: 10px; font-weight: bold;
  cursor: pointer; letter-spacing: 1px;
  margin: 0 auto 6px;
  transition: filter 0.1s;
}
.cui-btn:hover { filter: brightness(1.2); }
.cui-btn:active { filter: brightness(0.9); }

.cui-msg { font-size: 9px; color: #cccc40; text-align: center; min-height: 14px; padding: 0 4px; }
.cui-close {
  position: absolute; top: 6px; right: 8px;
  font-size: 12px; color: #888; cursor: pointer;
}
.cui-close:hover { color: #fff; }

/* ══ Hotbar ══════════════════════════════════════════════════════════════════ */
.mcw-hotbar {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 6px 8px;
  background: #1a1a2e;
  border-top: 2px solid #3a3a5a;
  min-height: 44px;
  flex-wrap: wrap;
}
.hotbar-slot {
  width: 36px; height: 36px;
  background: #2a2a3a;
  border: 2px solid #5a5a7a;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; cursor: pointer;
  position: relative;
  transition: border-color 0.1s, background 0.1s;
}
.hotbar-slot:hover { background: #3a3a4a; border-color: #8a8aaa; }
.hotbar-slot.equipped { border-color: #ffff00; background: #3a3a1a; box-shadow: 0 0 6px rgba(255,255,0,0.4); }
.hotbar-count {
  position: absolute; bottom: 1px; right: 2px;
  font-size: 7px; color: #fff; line-height: 1;
  text-shadow: 0 0 2px #000;
}
.hotbar-equipped-label {
  font-size: 8px; color: #aaaacc; margin-left: 6px;
  letter-spacing: 0.5px;
}

/* ══ Portal activation hint ═════════════════════════════════════════════════ */
.portal-activate-hint {
  font-size: 9px; color: #ffaa00; text-align: center;
  padding: 4px; background: #1a0a00; border-top: 1px solid #aa5500;
  animation: portal-hint-pulse 1s ease-in-out infinite;
}

/* ══ Drop items ═════════════════════════════════════════════════════════════ */
.mcw-drops-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}
.mcw-drop-item {
  position: absolute;
  line-height: 1;
  will-change: transform, opacity;
}
</style>
