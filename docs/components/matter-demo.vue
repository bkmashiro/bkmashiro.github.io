<!-- docs/.vuepress/components/matter-demo.vue -->

<template>
  <div ref="matterContainer" id="matterContainer" style="width: 100%; height: 100%; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 114;"></div>
</template>

<script>
import Matter from 'matter-js';
import html2canvas from 'html2canvas';

export default {
  mounted() {
    const { Engine, World, Bodies, Render, MouseConstraint, Mouse  } = Matter;

    const engine = Engine.create();
    // 获取窗口的宽度和高度
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // 创建一个渲染器并将画布大小设置为窗口大小
    const render = Render.create({
      element: document.querySelector('#matterContainer'),
      engine: engine,
      options: {
        width: windowWidth, // 画布宽度设置为窗口宽度
        height: windowHeight, // 画布高度设置为窗口高度
        background: 'transparent', // 设置背景为透明
        wireframeBackground: 'transparent', // 设置线框背景为透明
      },
    });

    engine.world.gravity.x = 0;
    engine.world.gravity.y = 0;
    // 添加一个简单的物体到物理世界
    // const box = Bodies.rectangle(200, 200, 50, 50);
    // World.add(engine.world, [box]);

    // 启动渲染和物理引擎
    Matter.Render.run(render);
    Matter.Runner.run(Matter.Runner.create(), engine);
    // const ground = Bodies.rectangle(200, 400, 400, 10, { isStatic: true });
    // World.add(engine.world, [ground]);
    document.querySelectorAll('p,h1,h2').forEach((element) => {
      html2canvas(element).then((canvas) => {
        const rect = element.getBoundingClientRect();
        const imageData = canvas.toDataURL(); // 获取图像数据URL
        // console.log(imageData);
        // 创建一个物体，将图像数据URL作为背景
        const box = Bodies.rectangle(rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          rect.width,
          rect.height, {
          render: {
            sprite: {
              texture: imageData,
            },
          },
          // isStatic: true,
        });
        // 创建一个 Mouse 对象
        const mouse = Mouse.create(render.canvas);

        // 创建 MouseConstraint 并添加到物理世界
        const mouseConstraint = MouseConstraint.create(engine, {
          mouse: mouse,
        });
        World.add(engine.world, mouseConstraint);

        console.log(`rect.left: ${rect.left}, rect.top: ${rect.top}, rect.width: ${rect.width}, rect.height: ${rect.height}`, element);
        // 将物体添加到物理世界
        World.add(engine.world, [box]);

        // 启动渲染和物理引擎
        Render.run(render);
        Matter.Runner.run(Matter.Runner.create(), engine);
      });
    });
  },
};
</script>
