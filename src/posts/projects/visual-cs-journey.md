---
title: "34 Algorithm Visualizations in 2 Weeks"
description: "Building interactive visualizations for algorithms from sorting to Raft consensus — what makes a good visualization, what made the hard ones hard, and how AI-assisted development changed the pace."
date: 2026-03-30
readingTime: true
tag:
  - Algorithms
  - Visualization
  - Education
outline: [2, 3]
---

I teach algorithms. The hardest part isn't the math — it's getting students to build intuition for how an algorithm *behaves*. You can explain red-black tree rotations on a whiteboard, but until someone sees the tree restructure itself in real time, it stays abstract.

So I built 34 interactive algorithm visualizations. In two weeks. Each one is a self-contained HTML file with no dependencies. Dark theme, consistent controls, runs in any browser. The project is [visual-cs](https://github.com/bkmashiro/visual-cs).

## The Stack

No React. No build step. No npm. Each visualization is a single `.html` file containing inline CSS and JavaScript. Open it in a browser, it works.

This was a deliberate choice. Algorithm visualizations have a distribution problem: they live on course websites, get emailed to students, get embedded in slides. Every dependency is friction. A single HTML file survives any context — you can drop it on a USB stick, host it on GitHub Pages, or open it from your desktop.

The shared aesthetic: dark background (`#1a1a2e`), accent colors for state transitions, monospace font for values, a control bar at the bottom with play/pause/step/reset. Every visualization looks like it belongs to the same family.

~30,000 lines of JavaScript across 34 files. No shared library. Some copy-paste between files, but that's the point — each file is self-contained and can be understood in isolation.

## The Hard Ones

Most sorting and searching visualizations are straightforward. You draw bars or nodes, you animate swaps and comparisons. The interesting engineering problems come from algorithms with complex, interleaved state.

### Raft Consensus

Raft is a distributed consensus protocol. You have multiple servers, each with their own state (follower/candidate/leader), communicating via messages with network delays. Visualizing this means:

- Multiple independent state machines running concurrently
- Messages in flight between nodes (with configurable delay)
- Election timeouts, heartbeat intervals, log replication
- Split-brain scenarios you can trigger manually

The visualization shows 5 nodes in a circle. Each node has a colored ring showing its state. Messages fly between nodes as animated arcs. You can click a node to kill it, click again to revive it. A log panel on the right shows every state transition.

The hardest part was time. Raft is time-dependent — election timeouts, heartbeat intervals. I run a virtual clock that you can pause, step, or speed up. Every event is scheduled on this virtual clock, not `setTimeout`. This means stepping through Raft one event at a time actually works, which is critical for teaching.

```javascript
class VirtualClock {
    constructor() {
        this.time = 0;
        this.events = []; // min-heap by scheduled time
    }

    schedule(delay, callback) {
        this.events.push({ time: this.time + delay, callback });
        this.events.sort((a, b) => a.time - b.time);
    }

    tick(dt) {
        this.time += dt;
        while (this.events.length && this.events[0].time <= this.time) {
            this.events.shift().callback();
        }
    }

    step() {
        if (this.events.length) {
            this.time = this.events[0].time;
            this.events.shift().callback();
        }
    }
}
```

The step function jumps directly to the next event. Students can walk through a leader election tick by tick and see exactly when and why each node transitions.

### Red-Black Tree

Red-black trees are the algorithm most students give up on. The rotation rules feel arbitrary until you see them happen. The visualization draws the tree with animated layout (nodes smoothly slide to new positions after insertion), colors each node, and — the key feature — shows a **rotation replay** panel.

When a rotation happens, the main tree pauses. A side panel appears showing just the three nodes involved. It plays the rotation in slow motion: the parent-child pointer swaps, the color changes, the subtree reattachment. Then it fades back to the full tree, which has already been updated.

The layout algorithm is Reingold-Tilford with animation interpolation. Each node stores its target (x, y) and lerps toward it over 20 frames. This means the tree flows into its new shape instead of teleporting.

```javascript
function animateLayout(root, canvas) {
    computeReingoldTilford(root); // sets target positions
    requestAnimationFrame(function step() {
        let settled = true;
        forEachNode(root, node => {
            node.x += (node.targetX - node.x) * 0.15;
            node.y += (node.targetY - node.y) * 0.15;
            if (Math.abs(node.x - node.targetX) > 0.5) settled = false;
        });
        draw(canvas, root);
        if (!settled) requestAnimationFrame(step);
    });
}
```

### Fibonacci Heap

Nobody implements Fibonacci heaps in production. They exist to make amortized analysis interesting. But the cascading cut operation — where marking a node and then cutting it can trigger a chain of cuts up the tree — is genuinely hard to follow on paper.

The visualization represents the heap as a horizontal list of trees (the root list). Each node shows its key and whether it's marked. When you call `decreaseKey`, the cut happens with a 500ms animation: the node detaches, floats up to the root list, and if the parent was already marked, the parent also cuts — chain reaction, each step animated sequentially.

The challenge was drawing a forest of arbitrarily-shaped trees that merge and split. I gave up on a clever layout algorithm and went with a simple recursive approach: each tree gets a bounding box, root list trees are laid out left to right, children are stacked vertically. It's not pretty for large heaps, but it's readable up to ~30 nodes, which is enough for teaching.

### Ford-Fulkerson (Max Flow)

Flow networks need two things most graph visualizations don't: edge labels showing capacity/flow, and a way to show the residual graph.

The visualization has two modes: you see the original graph with flow values updating, and you can toggle to see the residual graph with forward/backward edges. When an augmenting path is found, it highlights in green and animates "flow" particles traveling along the path. The bottleneck edge flashes red.

I implemented both BFS-based (Edmonds-Karp) and DFS-based path finding. A dropdown lets you switch. Watching DFS find a longer augmenting path versus BFS finding the shortest one makes the complexity difference visceral.

The edge rendering was surprisingly fiddly. Curved edges (quadratic Bezier) to handle bidirectional connections, with labels positioned at the midpoint of the curve, rotated to follow the edge direction. Getting the label not to overlap with the edge required offsetting it perpendicular to the tangent.

## AI-Assisted Development

34 visualizations in two weeks is not a reasonable pace for one person writing everything from scratch. I used Claude Code and Codex heavily.

The pattern: I'd write the first visualization in a category by hand — the sorting one, the tree one, the graph one. This established the visual style, the control bar interface, and the animation patterns. Then I'd hand Claude Code the reference file and say "build a Fibonacci heap visualization in the same style."

The AI was good at:
- Generating the boilerplate (canvas setup, control bar, dark theme CSS)
- Implementing well-known algorithms correctly
- Adapting an existing visualization's structure to a new algorithm

The AI was bad at:
- Layout algorithms for complex structures (I rewrote every tree layout by hand)
- Animation timing and easing (it would make everything linear, which looks mechanical)
- Knowing when to break the template (some algorithms need fundamentally different UI)

My estimate: AI wrote ~60% of the total code. I rewrote ~30% of what it produced. The remaining 40% I wrote from scratch. Net productivity multiplier: roughly 3x. Without AI assistance, this would have been a 6-week project.

The parallel workflow was the real win. While I was debugging the Raft visualization's election timeout logic, Claude Code was generating the initial versions of three sorting visualizations. By the time I finished Raft, I had three more visualizations that needed polish instead of three blank files.

## What Makes a Good Algorithm Visualization

After building 34 of them, some patterns emerged:

**Step-by-step beats continuous animation.** A play button is nice for the demo, but the step button is what students actually use. Every visualization has a step function that advances exactly one logical operation.

**Color encodes state, not decoration.** Red means "currently being compared." Green means "in final position." Yellow means "candidate for swap." These are consistent across all 34 visualizations. Students transfer their intuition from one to the next.

**Show the data structure, not just the algorithm.** The Ford-Fulkerson visualization that only shows augmenting paths is less useful than one that shows the full residual graph at all times. Context matters more than focus.

**Let users break things.** The Raft visualization lets you kill nodes mid-election. The BST visualization lets you insert pathological sequences. The hash table lets you set the load factor to 0.99. The interesting behavior is always at the edges.

**Speed control is mandatory.** Some students need 0.25x to follow a rotation. Some need 4x to see the overall pattern. A slider from 0.1x to 10x covers everyone.

## The Numbers

- 34 visualizations
- ~30,000 lines of HTML/CSS/JS
- 0 external dependencies
- Every file opens directly in a browser
- Average file size: ~880 lines
- Largest: Raft consensus at 2,400 lines
- Smallest: linear search at 280 lines

Categories covered: sorting (8), trees (6), graphs (7), heaps (3), hashing (2), string matching (3), dynamic programming (2), distributed systems (2), miscellaneous (1).

The one I'm most proud of is Raft. The one students use most is red-black tree. The one that surprised me was the hash table visualization — watching linear probing degrade into O(n) as the load factor climbs past 0.7 is more convincing than any lecture.

---

[visual-cs on GitHub](https://github.com/bkmashiro/visual-cs)
