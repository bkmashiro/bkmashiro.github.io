---
title: "Building a 3D Animal Crossing World in SceneKit"
description: "How we went from procedural colored boxes to an Animal Crossing-style island in an iOS Japanese learning app — asset pipelines, toon shaders, Poisson sampling, and what makes cozy feel cozy."
date: 2026-03-30
readingTime: true
tag:
  - iOS
  - SceneKit
  - 3D
  - Game Dev
outline: [2, 3]
---

The kotodama app teaches Japanese through immersion. You walk around a 3D world, interact with objects, and the game teaches you words in context. The world started as procedural colored boxes on a flat green plane. It looked like a dev test scene because it was one.

Then someone said "what if it looked like Animal Crossing?" and we spent three weeks making that happen.

## From Boxes to an Island

The first version of the 3D world was embarrassingly simple. A flat `SCNPlane` for ground, `SCNBox` nodes with random colors for buildings, `SCNCylinder` with a green sphere on top for trees. It ran at 60fps because there was nothing to render.

The problem wasn't performance — it was that nobody wanted to spend time in a world made of geometry primitives. Language learning apps live or die on session duration. If the world is ugly, people close the app. We needed the world to feel like a place you'd want to be in.

Animal Crossing was the obvious reference. Not because we wanted to clone it, but because it solves the exact problem we had: make a small world feel cozy enough that players forget they're doing something educational.

## The Asset Pipeline

We needed models. Lots of them. Trees, houses, fences, flowers, rocks, furniture, animals, food items — the vocabulary coverage demanded variety. Buying a commercial asset pack was an option, but we wanted CC0 so we could ship without license tracking.

The hunt:

- **Kenney** — 170+ models. Consistent low-poly style, `.glb` format. Perfect.
- **Quaternius** — 400+ models. Nature packs, town packs, furniture. Also `.glb`.
- **Sketchfab CC0** — another 230+ models, varying quality. Cherry-picked the ones that matched the style.

Total: **800+ models** downloaded. But SceneKit doesn't read `.glb`. It wants `.usdz`.

### GLB → USDZ Batch Conversion

Apple's Reality Converter handles one file at a time. We had 800. Blender's Python API saved us:

```python
import bpy, sys, os

input_path = sys.argv[-2]
output_path = sys.argv[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)

# Normalize scale — some models were 100x too large
max_dim = max(obj.dimensions) for obj in bpy.context.scene.objects if obj.type == 'MESH')
if max_dim > 0:
    scale_factor = 1.0 / max_dim
    for obj in bpy.context.scene.objects:
        obj.scale *= scale_factor

bpy.ops.wm.usd_export(filepath=output_path, export_textures=True)
```

Wrapped in a bash loop:

```bash
find ./glb -name "*.glb" | while read f; do
    out="./usdz/$(basename "$f" .glb).usdz"
    blender --background --python convert.py -- "$f" "$out"
done
```

**559 files converted, 0 failures.** The remaining ~250 were duplicates, LOD variants, or models we decided not to use. Total conversion time: 47 minutes on an M2 Pro. The normalization step was critical — without it, some Sketchfab models spawned at building-sized scale while Kenney models were ant-sized.

## SceneKit Rendering

### Toon Shader

Animal Crossing uses a cel-shaded look — distinct bands of light and shadow rather than smooth gradients. SceneKit doesn't have a built-in toon shader, but you can fake it with `SCNShadable` modifiers:

```metal
// Fragment shader modifier
float intensity = dot(_surface.normal, normalize(scn_lights[0].direction));
float bands = floor(intensity * 3.0) / 3.0;
_output.color.rgb = _surface.diffuse.rgb * (bands * 0.6 + 0.4);
```

Three bands: full light, half shadow, full shadow. The `0.4` floor prevents anything from going pure black — that's the Animal Crossing trick. Nothing is ever truly dark. The world always feels warm.

### Terrain

Flat planes look terrible. We generated terrain using a height map with Perlin noise, then smoothed it with a Gaussian blur to avoid jagged peaks:

```swift
func generateTerrain(width: Int, depth: Int, resolution: Float) -> SCNGeometry {
    var vertices: [SCNVector3] = []
    var normals: [SCNVector3] = []
    var indices: [UInt32] = []

    for z in 0..<depth {
        for x in 0..<width {
            let fx = Float(x) * resolution
            let fz = Float(z) * resolution
            let height = perlinNoise(fx * 0.02, fz * 0.02) * 3.0
            vertices.append(SCNVector3(fx, height, fz))
        }
    }
    // ... triangle strip indices, smooth normals from cross products
}
```

The terrain is gentle — maximum elevation difference of about 3 units. Enough to feel natural, not enough to obstruct navigation. We painted it with a blended texture: grass below a threshold, dirt on slopes steeper than 30°, sand near the water edge.

### Water

The water renderer went through three iterations. The one that stuck: a semi-transparent `SCNPlane` with vertex animation in a shader modifier.

```metal
// Vertex modifier — gentle wave displacement
float wave1 = sin(scn_frame.time * 0.8 + _geometry.position.x * 0.5) * 0.15;
float wave2 = sin(scn_frame.time * 0.6 + _geometry.position.z * 0.3) * 0.10;
_geometry.position.y += wave1 + wave2;
```

Combined with a Fresnel-based opacity (more transparent when you look straight down, more reflective at grazing angles), it reads as water immediately. No ray marching, no cubemap reflections — just math that looks right at the camera angles we allow.

### Depth of Field

Animal Crossing uses a subtle depth of field to draw attention to nearby objects. SceneKit has this built in via `SCNCamera.wantsDepthOfField`:

```swift
camera.wantsDepthOfField = true
camera.focusDistance = 8.0
camera.fStop = 5.6
camera.focalBlurSampleCount = 4  // keep it low for mobile
```

Objects far from the player get a gentle blur. It makes the world feel miniature — the tilt-shift effect that's central to Animal Crossing's aesthetic.

## Vegetation Placement

Randomly scattering trees looks random. Nature doesn't work that way — trees compete for sunlight and water, so they end up roughly evenly spaced with some organic variation. Poisson disk sampling produces exactly this distribution:

```swift
func poissonDisk(width: Float, height: Float, minDist: Float, attempts: Int = 30) -> [SIMD2<Float>] {
    var points: [SIMD2<Float>] = []
    var active: [SIMD2<Float>] = []
    let cellSize = minDist / sqrt(2.0)

    // ... standard Bridson's algorithm
    // For each active point, generate `attempts` candidates
    // Accept if no existing point is within minDist

    return points
}
```

We run three passes with different `minDist` values: large trees at 6.0 units apart, bushes at 3.0, flowers at 1.5. Each pass respects the previous — flowers don't spawn inside tree trunks. The result looks hand-placed but takes zero manual effort.

We also added exclusion zones around paths and buildings. Walk paths are Catmull-Rom splines; anything within 1.5 units of a spline point is off-limits for vegetation. This creates natural clearings that guide the player without explicit UI.

## Particle Systems

The atmosphere sells the world more than the geometry does. Three particle systems run simultaneously:

**Butterflies** — textured billboard quads that follow a sine-wave path with random phase offsets. 8-12 active at a time. They avoid the player by steering away when distance drops below 3 units.

**Fireflies** (evening mode) — tiny point lights with `SCNParticleSystem`, yellow-green emission, slow random walk. We cap at 20 particles because each one is technically a light source and SceneKit's forward renderer doesn't love that.

**Cherry blossom petals** — the most complex one. Billboard quads with a rotation animation that simulates tumbling. They spawn from a plane above the scene and are affected by a `SCNPhysicsField.linearGravity` angled at 15° to simulate wind. Spawn rate varies with a sine wave to create gusts.

```swift
let petals = SCNParticleSystem()
petals.birthRate = 3
petals.particleLifeSpan = 8
petals.spreadingAngle = 20
petals.particleSize = 0.08
petals.particleImage = UIImage(named: "petal_pink")
petals.isAffectedByGravity = true
petals.acceleration = SCNVector3(0.3, -0.2, 0.1) // wind drift
```

## Performance on Mobile

An iPhone 13 mini was our target floor. Here's what we did to stay above 30fps:

**LOD (Level of Detail)** — Each model has 2-3 LOD variants. Full detail within 10 units, simplified mesh at 10-30, billboard sprite beyond 30. SceneKit's `SCNLevelOfDetail` handles the transitions:

```swift
let lod1 = SCNLevelOfDetail(geometry: simplifiedMesh, screenSpaceRadius: 50)
let lod2 = SCNLevelOfDetail(geometry: billboardQuad, screenSpaceRadius: 20)
node.geometry?.levelsOfDetail = [lod1, lod2]
```

**Instancing** — Identical models (flowers, grass tufts) use `SCNNode.clone()` with `flattenedClone()` to batch draw calls. A meadow of 200 flowers renders as ~4 draw calls instead of 200.

**Lazy loading** — Models load from `.usdz` on a background queue and fade in with a 0.3s opacity animation. The world assembles itself as you walk through it. We preload a 20-unit radius ahead of the player's movement direction.

**Shader complexity budget** — The toon shader, water shader, and depth of field all run simultaneously. On older devices, we drop DoF first, then reduce water to a flat transparent plane, then switch the toon shader to unlit. This is a three-tier quality setting driven by `ProcessInfo.thermalState`.

With all optimizations, the full island renders at 35-45fps on iPhone 13 mini in the default quality tier. iPhone 15 Pro holds 60fps with everything on.

## What Makes Animal Crossing Feel Cozy

After rebuilding the aesthetic from scratch, I think the "cozy" feeling comes from five technical decisions:

1. **Nothing is dark.** The shadow floor is 40% brightness, not 0%. There's no harsh contrast.
2. **Everything is rounded.** Low-poly models with smoothed normals. No sharp edges anywhere in the world.
3. **Movement is slow.** Camera transitions use ease-in-out curves with long durations (0.8-1.2s). Nothing snaps.
4. **The world acknowledges you.** Flowers bend when you walk near them (vertex displacement based on player distance). Butterflies flee. NPCs wave.
5. **Sound fills the gaps.** Ambient audio — waves, birdsong, wind — covers the silence that would otherwise feel empty. This isn't a rendering technique, but it's inseparable from the visual experience.

The voxel world had none of these. The Animal Crossing world has all five. Session time went from an average of 4 minutes to 12.

---

[kotodama on GitHub](https://github.com/bkmashiro/kotodama)
