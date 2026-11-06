---
name: kiln-3d-assets
description: Create low-poly and voxel 3D game assets (characters, props, trees, rocks, buildings, items, dioramas, asset packs) with kiln, a compact JavaScript DSL that exports GLB for Godot / Unity / Unreal / Three.js, renders previews an agent can read, and beauty-renders with Blender. Use when asked to make, design or iterate on 3D models for a game.
---

# kiln: 3D game assets as code

You write a small `.kx.js` file; kiln builds low-poly meshes (flat-shaded, or smooth with crisp creases and
baked AO when you ask) and greedy-meshed voxels,
exports a GLB per model and packs (one GLB, one named node per model), and renders previews you
can read. Needs Node ≥ 22.18 and `npm install` once in this skill's directory. Blender (optional)
does beauty renders and turntable videos.

`KILN` below means `node <this skill's directory>/bin/kiln.js`.

## Workflow

1. Write `models.kx.js` (template below; more in `examples/` and `showcase/`).
2. Build what you're working on: `KILN build models.kx.js --only crate,tree`. Each line prints
   dimensions (w×h×d) and the triangle count.
3. **Look at it**: read `out/_preview/<name>.png`: hero, front, right and top views, with ground grid
   (spacing printed in the header), cast shadow and a material legend. Check proportions against
   the printed dimensions; `KILN info models.kx.js <name>` lists bounds, triangles per material and
   build steps.
4. Fix with small edits (a position, a radius, a rotation) and rebuild. Repeat.
5. Let the user look: start `KILN serve models.kx.js` in the background and give them the URL
   (drag to orbit, step through the build, rebuilds on save).
   **Feedback**: the viewer's annotate mode (`a`) freezes the camera and lets the user pin notes and
   draw strokes on the model, then send them. When they say "check the feedback", read
   `out/_feedback/<model>.json`: every pin has a `hit` (the surface `point` and `normal` in model space,
   `mat`, `part`, and the build `step` with its source `loc`, so you know which line made that face),
   or `null` if it missed the model; strokes list what they `cover` (by step and material, with world
   bounds). Look at `<model>.annotated.png` for the view. Comments persist between sends: check `time`.
6. Rigs: `KILN build models.kx.js --rig` exports every model that has `part()`s as a skinned skeleton (bones named after the parts + `root`, clips on the bones) instead of one node per part: use it for assets that ship animatable (Godot `Skeleton3D`).
7. Ship: GLBs are in `out/models/` and `out/<pack>.glb` (`--stl` adds printable STLs). Portfolio shots:
   `KILN render models.kx.js <name> --size 1920x1080` (Blender), add `--frames 180` for a turntable MP4.
   Lit scenes: `--mood night`; framing: `--focus x,y,z --zoom N`; camera moves: `--frames 300 --yaw-to ... --zoom-to ...`,
   plus `--audio file.wav`. Blender writes only inside your home directory if it's the flatpak.

Errors name file:line:col and suggest fixes. One broken model doesn't stop the others.

## Template

```js
pal({ bark: "#6e4535", leaf: "#3d8c48", leafL: "#74c45a", stone: "#646985", wood: "#9c6a4d", woodD: "#6e4535",
  flame: { color: "#ff9b2f", emit: "#ffa030", glow: 6 },            // emissive
  gold: { color: "#ffb43a", metal: 0.2, rough: 0.3 },
  s: "#f0a882", t: "#3b67c0", k: "#3b2622" })                          // 1-char keys for voxels

model("pine",
  cyl(0.12, 0.7, { mat: "bark", sides: 5 }),                          // boxes/cyls/cones sit on y = 0
  [[0.8, 0.5, 1.1], [0.6, 1.05, 0.95], [0.4, 1.55, 0.8]].map(([r, y, h], i) =>
    cone(r, h, { mat: i % 2 ? "leaf" : "leafL", sides: 7, pos: [0, y, 0], rot: [0, i * 23, 0], jitter: 0.035 })))

model("crate", box(0.6, 0.6, 0.6, "wood"),
  sym("x", sym("z", box(0.08, 0.62, 0.08, { mat: "woodD", pos: [0.28, -0.01, 0.28] }))))   // 4 corner posts

model("rock", rock(0.5, { mat: "stone", seed: 3 }))
model("gem", voxels([`.t.\nttt\n.t.`, `.t.`], { size: 0.1 }))      // layers bottom to top, rows back to front

model("camp", stamp("crate", { pos: [1, 0, 0], rot: [0, 30, 0] }),
  scatter("pine", { area: [-3, -3, 3, 3], count: 6, scale: [0.7, 1.1] }))

pack("kit", ["pine", "crate", "rock", "gem"])
```

## Essentials

- **Units**: meters, Y up, +Z is the front, rotations in degrees. Every model is re-centered with
  its base on y = 0 (`pivot: "center" | "origin"` to change).
- **Shapes** (last argument = material key or `{ mat, pos, rot, scale, jitter, seed, ... }`):
  `box(w, h, d)`, `cyl(r, h, { sides, top })`, `cone(r, h)`, `sphere(r, { detail })`,
  `rock(r, { rough, squash, seed })`, `lathe([r0, y0, r1, y1, ...])`, `extrude([x0, y0, ...], depth)`,
  `prism(w, h, d)` (gable roof), `wedge(w, h, d)` (ramp), `torus(R, r)`, `tube([x, y, z, ...], r)`
  (pipes, cables, branches, rails: mitered bends, no twist, `closed` for rings).
  Boxes, cylinders, cones, lathes, prisms and wedges sit on their base; spheres and rocks are centered.
- **Terrain**: `terrain(w, d, { res: 48, height: 3, fn: (x, z) => 0..1, mat: (h, slope, x, z) => key })`
  or `heightmap: "../loom/out/hills/hills_height.png"`: islands, hills, cave floors, with grass / rock /
  snow picked per triangle by height and slope.
- **Voxels**: `voxels([layer, ...], { size })`; each layer is a top-down map (rows back → front,
  "." empty, 1-char palette keys). `voxfn([nx, ny, nz], (x, y, z) => key | null, { size })` for
  procedural voxels. `voximg("sprite.png", { size, depth, flat })` extrudes a pixel-art PNG into
  voxels, one material per color (a pxl sprite becomes a 3D model). Greedy meshing keeps triangle counts low.
- **Structure**: `tf({ pos, rot, scale }, ...items)`, `sym("x" | "z", ...items)` (mirror copy),
  `stamp(name, { pos, rot, scale, swap })`, `scatter(name, { area, count, scale, rot, y, seed })`,
  `group(name, [members])` (random pick), variants with `{ base, swap }`.
- **Animation**: `part(name, { pivot }, ...items)` makes a named, animatable node; `animate(model, clip, { frames, fps },
  { part: { rot: [[frame, [x, y, z], ease?], ...], move, scale } })` exports a glTF animation. Read the
  `out/_preview/<model>.<clip>.png` strip, then check key poses in Blender with `--clip NAME --clip-frame N`.
  Rotation axes are the final model's: stamping with a rotation turns them too.
- **Lights**: `light({ type: "point" | "spot", color, power (W), pos, dir, angle })`. Lights travel with
  stamps and mirrors and export to GLB. Keep them outside closed meshes (a bulb sphere shadows its own light),
  and give lit surfaces mid-tone, non-metal colors or the light won't show.
- **Textures**: `pal({ brick: { tex: "../loom/out/brick_wall", uv: 1.5 } })` uses a loom material
  (seamless PBR maps) with box-projected UVs, `uv` meters per tile; the GLB embeds every map.
- **Materials**: `pal({ key: "#hex" | { color, rough, metal, emit, glow, smooth, alpha, double } })`. GLB gets PBR
  materials; emissive uses `KHR_materials_emissive_strength`; `alpha` < 1 exports as blended, `double: true` as
  double-sided.
- **Smooth stylised look** (opt-in; the default stays flat): `smooth: 50` (or `true`) on a shape, material or model
  shades across edges up to 50° and keeps sharper ones crisp, at no extra triangles. To round a ring of
  `sides` segments the angle must be above 360 / sides. `subdiv(1, ...items)` rounds
  geometry (Loop for triangles, Catmull-Clark otherwise; edges above `crease`, default 60°, stay sharp, and a
  `bevel` acts as a support edge): about 4× triangles per level, so spend it on silhouettes. `ao: true` on a
  model bakes ambient occlusion into vertex colours (`COLOR_0`). Godot shows it with its imported material;
  a material you assign must use vertex colour as albedo. `sphere` `detail` goes up to 6.
- **Look-dev**: `KILN render ... --look studio` (studio HDRI, contact AO) to judge shapes; `--preset game`
  frames the asset from a fixed game camera (yaw 45°, pitch 35°, 25° fov, 25.8 m) to see it at play size.

Full API: [reference.md](reference.md).

## Habits that make better low-poly assets

- `bevel` on `box`/`cyl` (5–15% of the smallest side) gives chunky, toy-like edges that catch light; use it on most hard-surface parts.
- Smooth stylised: build for it rather than flipping it on a flat model. `smooth: true` (50) on organic shapes
  first (free; 30–40 on hard-surface parts keeps chamfers crisp), `ao: { dist: 0.2 }` for contact shadows (free in
  triangles; `strength: 0.3` for a strict palette), `subdiv` last and only on parts whose outline shows. Mixed
  shape languages show: smooth limbs next to boxy hands, detail-0 noses with polygon outlines. Compare before/after with `kiln info` triangle counts and the
  same preview angle; a project with a fixed look (a game's style guide) only opts in when its owner says so.
- Shape language first: a few big primitives that read at a glance, then 2–3 detail parts.
- Low counts: 6–8 sides for trunks and rocks, `detail: 1` spheres; props 50–800 tris, characters
  under 1k. `jitter` (0.02–0.08) makes primitives feel hand-made.
- 2–3 tones per material (leaf / leafL / leafD) placed by where light falls: lighter on top.
- Never leave coplanar faces touching (they flicker in engines): make trim stand 1–3 cm proud.
- Use `sym` for anything symmetric and `stamp`/`scatter` for repeats; keep one palette per pack so
  assets sit together.
- Check the front and top views: rotations about the wrong axis show up there first.
