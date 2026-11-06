# kiln

**Low-poly and voxel 3D game assets as code.** Write a small `.kx.js` file of primitives, voxel
layers, lights, mirrors and scatters. kiln builds flat-shaded meshes (or smooth ones with crisp creases and
baked ambient occlusion, when you ask), exports **GLB** for Godot,
Unity, Unreal and Three.js, renders previews an AI agent can read, and hands off to **Blender**
for beauty renders, turntables and camera-move videos.

Part of a family with [**vex**](https://github.com/uilianks/vex) (vector art, skeletal animation), [**pxl**](https://github.com/uilianks/pxl) (pixel art), [**chirp**](https://github.com/uilianks/chirp) (game audio) and [**loom**](https://github.com/uilianks/loom) (seamless textures and PBR materials), inspired by
[**claude-pxl**](https://github.com/crsolver/claude-pxl): sandboxed source files, lazy cached
builds, errors with exact locations, and a live viewer.

## Showcase

Everything below is code in [`showcase/`](showcase/), rendered by kiln and Blender. No modeling
by hand, no image models.

### THE DRAGON'S HOARD: textured with loom

[![The Dragon's Hoard: an isometric vault with mossy brick walls, a wet cobblestone floor, a glowing lava pit, a wooden chest with rusted iron bands, a hoard of hammered gold and a dragon egg in an arched niche](docs/media/dragon_hoard.png)](docs/media/dragon_hoard.mp4)

▶ **[Watch the camera push-in](docs/media/dragon_hoard.mp4)** · source: [`dragon_hoard.kx.js`](showcase/dragon_hoard.kx.js)

Every surface is a seamless PBR material from [**loom**](https://github.com/uilianks/loom): mossy brick,
wet cobblestone, stained concrete, worn wood, rusted iron, lava rock (emissive), dragon scales and
hammered gold. A palette entry points at the loom output (`{ tex: T + "brick_wall", uv: 1.5 }`); kiln
box-projects UVs onto every face and embeds albedo, normal, ORM and emissive in the GLB, so Blender
(and any engine) renders real relief, roughness and glow. Lit only by the scene: a lava pit, two torches,
the egg's glow and a spot on the niche.

### LAST CUP: a cyberpunk noir diorama

![LAST CUP: camera push-in toward a lonely robot in a rainy neon coffee shop](docs/media/last_cup_3d.gif)

▶ **[Watch in 1080p with sound](docs/media/last_cup_3d.mp4)**: a 10 s camera move, with the soundtrack synthesized
by chirp · source: [`last_cup.kx.js`](showcase/last_cup.kx.js)

A broken robot alone at a table under the only warm lamp, one red eye still glowing. A woman with
a steel leg presses her hand to the window. COFFEE hangs backwards in the glass with a dead F, a
green CRT hums at the bar, brutalist towers stand outside, and neon bleeds across the wet floor.
It's lit only by the scene's own `light()` items: one spot, seven points, and emissive neon.

| close | wide |
|---|---|
| ![](docs/media/last_cup_3d.png) | ![](docs/media/last_cup_3d_wide.png) |

The same scene exists as a 2D illustration in [vex](https://github.com/uilianks/vex) and as a
soundscape in [chirp](https://github.com/uilianks/chirp): one world across three tools.

### It moves

▶ **[LAST CUP, animated: 10 s with sound](docs/media/last_cup_3d_sip.mp4)**. The robot lifts the mug to his face and
drinks, the dying F on the sign blinks, and the pendant lamp sways so its light pool drifts across the table,
all while the camera pushes in. Parts are named nodes with pivots; clips export as glTF animations that
Blender (and any engine) plays.

```js
part("upper", { pivot: [0.2, 1.0, 0.14] }, limb(...),
  part("fore", { pivot: [0.22, 0.79, 0.42] }, limb(...),
    part("cup", { pivot: [0.12, 0.78, 0.55] }, stamp("_mug", { pos: [0.12, 0.755, 0.58] }))))
animate("last_cup", "sip", { frames: 240, fps: 24 }, {
  upper: { rot: [[48, [0, 0, 0]], [110, [0, 0, -60]], [160, [0, 0, -60]], [214, [0, 0, 0]]] },
  flicker: { scale: [[0, 1, "step"], [31, 0.001, "step"], [34, 1]] },
})
```

### LAST CUP, isometric

[![LAST CUP isometric: a cutaway cafe at night, a robot by the rainy window, red and cyan neon](docs/media/last_cup_iso.png)](docs/media/last_cup_iso.mp4)

▶ **[10 s with sound](docs/media/last_cup_iso.mp4)** · source: [`last_cup_iso.kx.js`](showcase/last_cup_iso.kx.js)

The [pxl](https://github.com/uilianks/pxl/tree/main/showcase) isometric pixel-art room rebuilt in 3D: a
cutaway cube seen from the front-right corner with a long lens (45° yaw, 30° pitch, true isometric).
The window is in the left wall with rain falling past it, and the counter, CRT and a vertical CAFE
sign are on the back wall. A hooded sleeper is slumped on the bar, another robot's dead head lies on the
floor, and the puddles hold the neon. The `night` clip plays rain, the dying F, smoke, the swaying bulb
and one slow sip; the soundtrack is chirp's `last_cup_iso_3d` mix, timed to the same frames.

```sh
kiln render showcase/last_cup_iso.kx.js last_cup_iso --mood night --fog 0.02 --yaw 45 --pitch 30 \
  --lens 135 --focus 0.1,1.3,0.1 --zoom 1.5 --no-ground --frames 240 --clip night --still-camera \
  --audio ../chirp/showcase/out/sfx/last_cup_iso_3d.wav
```

### Forest Kit 3D: a game-ready asset pack

![Floating island turntable](docs/media/island_turntable.gif)

▶ [1080p turntable (MP4)](docs/media/island_turntable.mp4) · source: [`forest_kit.kx.js`](showcase/forest_kit.kx.js)

![Forest Kit 3D asset pack](docs/media/forest_kit_3d.png)

A voxel hero, slime and chest beside low-poly trees, pines, rocks, crystals, a campfire, a torch,
a coin, a crate, a fence and a log cabin. It's one GLB with 17 named meshes and 3,858 triangles;
the floating-island diorama is 5,514.

### What the agent sees

Every build writes a 4-view preview with dimensions, triangle count, grid scale and materials,
drawn by kiln's own rasterizer (scenes with lights render at night). That's how the agent checks
proportions and catches a roof rotated about the wrong axis, or a robot with no arms, before
anyone looks.

| voxel hero | log cabin |
|---|---|
| ![](docs/media/preview_hero.png) | ![](docs/media/preview_cabin.png) |

## Examples

Every file in [`examples/`](examples/) is built by `npm run check`. The images are kiln's own Blender renders
of those files, unedited.

### Flat, smooth, subdivided: [`smooth.kx.js`](examples/smooth.kx.js)

![The same toy three times: flat-shaded, smooth-shaded with baked AO, and subdivided](docs/media/smooth_flat_smooth_subdiv.png)

Left to right: the default flat look (1,584 triangles); the **same triangles** with `smooth: 50` and `ao: true`;
and `subdiv(1, ...)` on the round parts (built from detail-1 spheres, 2,880 triangles).

```js
const toy = ({ detail = 2, round = (x) => x } = {}) => [
  box(1.2, 0.16, 0.9, { mat: "wood", bevel: 0.05 }),
  round(sphere(0.42, { mat: "shell", detail, pos: [0, 0.62, 0], scale: [1, 0.92, 0.9] })),
  round(sphere(0.3, { mat: "shell", detail, pos: [0, 1.1, 0.02] })),
  // ... belly, cap, eyes, feet, arms
]
model("toy_flat", toy())
model("toy_smooth", { smooth: 50, ao: true }, toy())                     // shade across edges up to 50°, bake AO
model("toy_subdiv", { smooth: 50, ao: true }, toy({ detail: 1, round: (item) => subdiv(1, item) }))
```

`smooth` is a crease angle: edges flatter than it shade smooth, sharper ones stay crisp. `subdiv` rounds the
geometry itself, Loop for triangles and Catmull-Clark otherwise, and keeps sharp edges sharp: an unbevelled box
stays a box, a bevelled one becomes a soft block (`--look studio` render):

![A bevelled box and a plain box, before and after subdiv(2)](docs/media/smooth_blocks.png)

```js
model("block_flat", box(0.6, 0.6, 0.6, { mat: "cap", bevel: 0.08 }), box(0.6, 0.3, 0.6, { mat: "belly", pos: [0.8, 0, 0] }))
model("block_subdiv", subdiv(2, box(0.6, 0.6, 0.6, { mat: "cap", bevel: 0.08 }), box(0.6, 0.3, 0.6, { mat: "belly", pos: [0.8, 0, 0] })))
```

### Glass and cards: also in [`smooth.kx.js`](examples/smooth.kx.js)

Materials can be see-through (`alpha`) and double-sided (`double`):

<img src="docs/media/smooth_jar.png" width="420" alt="A glass jar with a cork and a card inside">

```js
pal({ glass: { color: "#bfe3e0", alpha: 0.35, rough: 0.08, double: true }, sticker: { color: "#cb8175", double: true } })
model("jar", { smooth: 50, ao: true },
  lathe([0.2, 0, 0.26, 0.04, 0.27, 0.42, 0.18, 0.5, 0.17, 0.56], { mat: "glass", sides: 20 }),
  extrude([-0.09, 0, 0.09, 0, 0.09, 0.22, -0.09, 0.22], 0.004, { mat: "sticker", pos: [0, 0.08, 0] }),
  cyl(0.15, 0.1, { mat: "wood", sides: 14, bevel: 0.02, pos: [0, 0.52, 0] }))
```

### Basics: [`basics.kx.js`](examples/basics.kx.js)

![A pack of a tree, two rocks, a crate, a house and a voxel mushroom](docs/media/example_basics.png)

```js
model("tree",
  cyl(0.18, 1.2, { mat: "bark", sides: 6, top: 0.12 }),
  cone(0.9, 1.4, { mat: "leaf", sides: 7, pos: [0, 0.9, 0], jitter: 0.06 }),
  cone(0.7, 1.1, { mat: "leafL", sides: 7, pos: [0, 1.6, 0], jitter: 0.05 }),
  cone(0.45, 0.8, { mat: "leaf", sides: 7, pos: [0, 2.2, 0] }))
model("house",
  box(2.4, 1.6, 2, "wall"),
  prism(2.7, 1.1, 2.3, { mat: "roof", pos: [0, 1.6, 0] }),
  box(0.5, 0.9, 0.06, { mat: "woodD", pos: [0, 0, 1.0] }),
  sym("x", box(0.45, 0.45, 0.06, { mat: "glass", pos: [0.75, 0.8, 1.0] })),
  cyl(0.16, 0.8, { mat: "stone", sides: 6, pos: [0.7, 2.0, -0.4] }))
pack("kit", ["tree", "rock*", "crate", "house", "mushroom"])
```

### Animation: [`animated.kx.js`](examples/animated.kx.js)

<img src="docs/media/example_animated.png" width="520" alt="A windmill with turning sails, a swinging door and a lantern">

```js
part("sails", { pivot: [0, 2.3, 0.6] }, /* hub and four sails */),
part("lantern", { pivot: [1.1, 1.3, 0.9] }, box(0.16, 0.2, 0.16, { mat: "iron", pos: [1.1, 1.0, 0.9] }),
  light({ color: "#ffa040", power: 30, pos: [1.1, 1.1, 1.05] })))
animate("windmill", "turn", { frames: 48, fps: 24 }, {
  sails: { rot: [[0, [0, 0, 0], "linear"], [48, [0, 0, -360]]] },
  door: { rot: [[0, [0, 0, 0]], [12, [0, -80, 0]], [36, [0, -80, 0]], [48, [0, 0, 0]]] },
})
```

`kiln render examples/animated.kx.js windmill --clip turn --clip-frame 10` poses the clip at frame 10.

## Quick start

```bash
git clone https://github.com/uilianks/kiln && cd kiln
npm install
node bin/kiln.js build examples/basics.kx.js          # -> examples/out/models/*.glb + previews
node bin/kiln.js serve showcase/last_cup.kx.js        # live viewer on http://127.0.0.1:4340
```

In the viewer, **✎ annotate** (or `a`) freezes the camera so you can pin notes on the model and draw on
it, then *send to Claude*. Each pin is mapped onto the model's surface: the feedback says which material,
part and build step (with its source line) you pointed at, so "check the feedback" is enough.

```js
pal({ bark: "#6e4535", leaf: "#3d8c48", leafL: "#74c45a", wood: "#9c6a4d", woodD: "#6e4535",
  bulb: { color: "#ffd28c", emit: "#ffc070", glow: 10 }, t: "#3b67c0" })

model("pine",
  cyl(0.12, 0.7, { mat: "bark", sides: 5 }),
  [[0.8, 0.5, 1.1], [0.6, 1.05, 0.95], [0.4, 1.55, 0.8]].map(([r, y, h], i) =>
    cone(r, h, { mat: i % 2 ? "leaf" : "leafL", sides: 7, pos: [0, y, 0], jitter: 0.035 })))

model("crate", box(0.6, 0.6, 0.6, "wood"),
  sym("x", sym("z", box(0.08, 0.62, 0.08, { mat: "woodD", pos: [0.28, -0.01, 0.28] }))))

model("lamp", sphere(0.05, { mat: "bulb" }),
  light({ type: "spot", color: "#ffbe78", power: 200, pos: [0, -0.1, 0], dir: [0, -1, 0], angle: 50 }))

model("gem", voxels([`.t.\nttt\n.t.`, `.t.`], { size: 0.1 }))

model("grove", scatter("pine", { area: [-3, -3, 3, 3], count: 6, scale: [0.7, 1.1] }), stamp("crate"))
pack("kit", ["pine", "crate", "gem"])
```

### Renders and videos (Blender)

```bash
kiln render scene.kx.js island --size 1920x1080 --no-ground                     # beauty still
kiln render scene.kx.js island --frames 180                                     # turntable MP4
kiln render scene.kx.js last_cup --mood night --focus 0.1,2.65,2.1 --zoom 1.3 \
  --frames 300 --yaw 18 --yaw-to -28 --zoom-to 3 --audio soundtrack.wav         # camera move + sound
```

## Features

- **Low-poly primitives:** box, cylinder (tapering), cone, icosphere, rock, lathe, extrude (any
  outline, concave ok), gable prism, wedge, plus vertex jitter for a hand-made look.
- **Voxels:** text layers like pixel art, a function of (x, y, z), or `voximg()`: a pixel-art PNG
  extruded into voxels with one material per color; greedy-meshed.
- **Tubes and terrain:** `torus`, `tube` along a path (pipes, cables, branches; mitered, twist-free)
  and `terrain` heightfields from a function or a loom height map, with materials picked per triangle
  by height and slope. `--stl` exports for 3D printing.
- **Structure:** transforms, mirror symmetry, stamps, scatter, random groups, material-swap variants.
- **Animation:** named `part()`s with pivots and keyframed `animate()` clips (rotation, offset, scale, five
  easings), exported as glTF animations, previewed as frame strips, played in Blender renders.
- **Lights:** point and spot `light()` items that move with the model through stamps, mirrors and
  scatter. They export as `KHR_lights_punctual`.
- **Smooth stylised look (opt-in):** `smooth` crease-angle shading (welded, indexed GLB primitives),
  `subdiv` (Loop / Catmull-Clark keeping sharp edges), and ambient occlusion baked into vertex colours
  (`ao`, `COLOR_0`). The default stays flat, and files that do not use them build byte-identical GLBs.
- **Game-ready GLB:** flat or smooth normals, PBR materials (blended `alpha`, `double`-sided), emissive
  strength, one primitive per material, named nodes, lights; packs for asset libraries. Models are
  re-centered with their base on y = 0.
- **Agent eyes:** a built-in rasterizer with shadows, a ground grid and night lighting: 4-view
  previews, `kiln info`, turntable GIFs.
- **Live viewer:** drag to orbit, replay the build step by step, download the GLB, rebuild on save.
- **Blender renders:** headless EEVEE with AgX and bloom. Day or night mood (moonlight, volumetric
  haze), a `--look studio` look-dev mode (studio HDRI, contact AO), a `--preset game` fixed-angle game
  camera, focus, zoom and lens; turntables and eased camera moves to MP4 with an optional soundtrack.

### Tested

Every primitive's signed volume equals the exact solid, so all faces point outward. Mirrors,
jitter and voxels stay closed. The GLB structure, materials and lights are checked byte by byte.
Subdivision keeps an unbevelled box exactly a box and a subdivided sphere inside its cage; smooth normals
of a sphere point radially; baked AO is darker in a corner than in the open; and every example builds.
Every showcase GLB imports and renders in Blender 5.2, and renders fail loudly if the output file
never appears (for example, a sandboxed Blender writing outside your home directory).

Agent workflow: [SKILL.md](SKILL.md) · Full API: [reference.md](reference.md)

## Use as a Claude Code skill

```bash
git clone https://github.com/uilianks/kiln ~/.claude/skills/kiln-3d-assets
cd ~/.claude/skills/kiln-3d-assets && npm install
```

Requires Node ≥ 22.18. Blender (optional, for `render`, found via `$KILN_BLENDER`, `blender` on
PATH, or the `org.blender.Blender` flatpak) and ffmpeg (optional, for GIF/MP4).
`npm run check` typechecks and runs the tests.

## License

[MIT](LICENSE). Portions adapted from [claude-pxl](https://github.com/crsolver/claude-pxl)
(MIT, © crsolver), via vex.
