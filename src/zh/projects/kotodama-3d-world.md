---
title: "用 SceneKit 搭建一个动物森友会风格的 3D 世界"
description: "一个 iOS 日语学习 App 如何从程序化方块走向动物森友会风格的小岛——资产管线、卡通着色器、泊松采样，以及「温馨感」背后的技术拆解。"
date: 2026-03-30
readingTime: true
tag:
  - iOS
  - SceneKit
  - 3D
  - 游戏开发
outline: [2, 3]
---

kotodama 是一款沉浸式日语学习 App。你在 3D 世界里走动、和物体交互，游戏在情境中教你单词。一开始这个世界只有程序化生成的彩色方块摆在一块绿色平面上。看起来像测试场景，因为它本来就是。

然后有人说「要是做成动物森友会的样子呢？」，我们花了三周把这件事做成了。

## 从方块到小岛

第一版 3D 世界简单得让人尴尬：地面是 `SCNPlane`，建筑是随机颜色的 `SCNBox`，树是 `SCNCylinder` 顶上放个绿色 `SCNSphere`。60fps 跑满——因为根本没什么好渲染的。

问题不在性能，而是没人愿意在一个几何体原语搭建的世界里待着。语言学习 App 的生死取决于用户的停留时长。世界丑，用户就关 App。我们需要让这个世界变成一个「想待下去」的地方。

动物森友会是最自然的参考。不是要克隆它，而是它恰好解决了我们的问题：让一个小世界足够温馨，让玩家忘记自己在学东西。

## 资产管线

我们需要大量模型。树、房子、栅栏、花、石头、家具、动物、食物——词汇覆盖要求多样性。买商业素材包是个选项，但我们想要 CC0 授权，省得跟踪许可证。

搜刮结果：

- **Kenney** — 170+ 模型。统一的低多边形风格，`.glb` 格式，完美。
- **Quaternius** — 400+ 模型。自然包、小镇包、家具包，也是 `.glb`。
- **Sketchfab CC0** — 又有 230+ 模型，质量参差不齐，挑了风格一致的。

总计：下载了 **800+ 模型**。但 SceneKit 不吃 `.glb`，它要 `.usdz`。

### GLB → USDZ 批量转换

Apple 的 Reality Converter 一次只能处理一个文件，我们有 800 个。Blender 的 Python API 救了命：

```python
import bpy, sys, os

input_path = sys.argv[-2]
output_path = sys.argv[-1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)

# 归一化尺寸——有些模型大了 100 倍
max_dim = max(obj.dimensions) for obj in bpy.context.scene.objects if obj.type == 'MESH')
if max_dim > 0:
    scale_factor = 1.0 / max_dim
    for obj in bpy.context.scene.objects:
        obj.scale *= scale_factor

bpy.ops.wm.usd_export(filepath=output_path, export_textures=True)
```

外面套一层 bash 循环：

```bash
find ./glb -name "*.glb" | while read f; do
    out="./usdz/$(basename "$f" .glb).usdz"
    blender --background --python convert.py -- "$f" "$out"
done
```

**559 个文件转换完成，0 次失败。** 剩下大约 250 个是重复、LOD 变体或我们决定不用的模型。M2 Pro 上总转换时间：47 分钟。归一化步骤至关重要——少了它，有些 Sketchfab 模型会以建筑物大小出现，而 Kenney 模型只有蚂蚁大小。

## SceneKit 渲染

### 卡通着色器

动物森友会用的是 cel-shading——分明的明暗色带，而非平滑渐变。SceneKit 没有内置卡通着色器，但可以用 `SCNShadable` 修饰器模拟：

```metal
// 片段着色器修饰器
float intensity = dot(_surface.normal, normalize(scn_lights[0].direction));
float bands = floor(intensity * 3.0) / 3.0;
_output.color.rgb = _surface.diffuse.rgb * (bands * 0.6 + 0.4);
```

三个色带：全亮、半阴影、全阴影。`0.4` 的下限保证任何地方都不会纯黑——这就是动物森友会的秘诀。世界里永远没有真正的黑暗，永远感觉温暖。

### 地形

平面地板看起来很假。我们用 Perlin 噪声生成高度图，再用高斯模糊抹平尖锐的棱角：

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
    // ... 三角面索引、平滑法线
}
```

地形起伏很温和——最大高差约 3 个单位。足够显得自然，又不影响导航。纹理混合渲染：低处是草地，坡度超过 30° 是泥土，水边是沙滩。

### 水面

水面渲染器迭代了三次，最终方案：半透明 `SCNPlane` 加顶点动画着色器。

```metal
// 顶点修饰器——轻柔的波浪位移
float wave1 = sin(scn_frame.time * 0.8 + _geometry.position.x * 0.5) * 0.15;
float wave2 = sin(scn_frame.time * 0.6 + _geometry.position.z * 0.3) * 0.10;
_geometry.position.y += wave1 + wave2;
```

配合基于菲涅尔的透明度（正视时更透明，掠射角更反光），立刻就读得出来是水。没有光线步进，没有 cubemap 反射——只是在我们允许的相机角度下看起来对的数学。

### 景深

动物森友会用微妙的景深把注意力引向近处物体。SceneKit 通过 `SCNCamera.wantsDepthOfField` 内置了这个功能：

```swift
camera.wantsDepthOfField = true
camera.focusDistance = 8.0
camera.fStop = 5.6
camera.focalBlurSampleCount = 4  // 移动端要控制采样数
```

远处的物体会轻微模糊，让世界产生微缩模型感——移轴效果，动物森友会美学的核心。

## 植被放置

随机撒树看起来就是随机。自然界不是这样的——树木竞争阳光和水分，最终会大致均匀分布但带有有机变化。泊松圆盘采样恰好产生这种分布：

```swift
func poissonDisk(width: Float, height: Float, minDist: Float, attempts: Int = 30) -> [SIMD2<Float>] {
    var points: [SIMD2<Float>] = []
    var active: [SIMD2<Float>] = []
    let cellSize = minDist / sqrt(2.0)

    // ... 标准 Bridson 算法
    // 对每个活跃点生成 `attempts` 个候选
    // 如果 minDist 内没有已有点就接受

    return points
}
```

我们跑三遍，`minDist` 不同：大树 6.0 单位间距，灌木 3.0，花 1.5。每一遍尊重前一遍的结果——花不会长在树干里。效果看起来像手工摆放，但完全不需要人工。

路径和建筑周围设了排斥区。步道是 Catmull-Rom 样条曲线，样条点 1.5 单位内禁止生成植被。这样自然形成引导玩家的空地，不需要显式 UI。

## 粒子系统

氛围比几何体更能卖掉这个世界。三套粒子系统同时运行：

**蝴蝶** —— 有贴图的 billboard 四边形，沿正弦曲线飞行，随机相位偏移。同时 8-12 只。玩家靠近 3 单位内时会转向逃开。

**萤火虫**（傍晚模式）—— 微小的点光源，`SCNParticleSystem`，黄绿色发光，缓慢随机游走。上限 20 个粒子，因为每个都是一个光源，SceneKit 的前向渲染器受不了太多。

**樱花花瓣** —— 最复杂的一个。带旋转动画模拟翻滚的 billboard 四边形，从场景上方的平面生成，受倾斜 15° 的 `SCNPhysicsField.linearGravity` 模拟风。生成速率跟随正弦波变化，制造阵风效果。

```swift
let petals = SCNParticleSystem()
petals.birthRate = 3
petals.particleLifeSpan = 8
petals.spreadingAngle = 20
petals.particleSize = 0.08
petals.particleImage = UIImage(named: "petal_pink")
petals.isAffectedByGravity = true
petals.acceleration = SCNVector3(0.3, -0.2, 0.1) // 风力偏移
```

## 移动端性能

iPhone 13 mini 是我们的底线机型。为了稳定在 30fps 以上做了这些事：

**LOD（细节层次）** —— 每个模型有 2-3 个 LOD 变体。10 单位内全精度，10-30 简化网格，30 以外用 billboard 精灵。SceneKit 的 `SCNLevelOfDetail` 管过渡：

```swift
let lod1 = SCNLevelOfDetail(geometry: simplifiedMesh, screenSpaceRadius: 50)
let lod2 = SCNLevelOfDetail(geometry: billboardQuad, screenSpaceRadius: 20)
node.geometry?.levelsOfDetail = [lod1, lod2]
```

**实例化** —— 相同模型（花、草丛）用 `SCNNode.clone()` 配合 `flattenedClone()` 合并绘制调用。一片 200 朵花的草地只要约 4 次绘制调用。

**延迟加载** —— 模型在后台队列从 `.usdz` 加载，以 0.3 秒的透明度动画淡入。世界在你走过时自动组装。我们在玩家移动方向上预加载 20 单位半径。

**着色器复杂度预算** —— 卡通着色器、水面着色器和景深同时运行。在老设备上，先关景深，再把水面降级为平面透明面片，最后切换卡通着色器为无光照。这是三档画质设定，由 `ProcessInfo.thermalState` 驱动。

全部优化后，完整小岛在 iPhone 13 mini 默认画质下跑到 35-45fps。iPhone 15 Pro 全开 60fps。

## 什么让动物森友会感觉温馨

从零重建这套美学之后，我认为「温馨感」来自五个技术决策：

1. **没有任何地方是暗的。** 阴影下限是 40% 亮度，不是 0%。没有强烈对比。
2. **一切都是圆的。** 低多边形模型配平滑法线。世界里没有锐利边缘。
3. **移动是缓慢的。** 相机过渡用 ease-in-out 曲线，持续时间长（0.8-1.2 秒）。没有任何东西会「咔」地跳过去。
4. **世界会回应你。** 走近花朵时花会弯（基于玩家距离的顶点位移）。蝴蝶会飞走。NPC 会挥手。
5. **声音填充间隙。** 环境音——海浪、鸟鸣、风声——覆盖了原本会让人觉得空旷的寂静。这不是渲染技术，但和视觉体验不可分割。

方块世界这五条一条都没有。动物森友会世界五条全有。平均会话时长从 4 分钟涨到了 12 分钟。

---

[kotodama on GitHub](https://github.com/bkmashiro/kotodama)
