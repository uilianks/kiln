# kiln reference

Model files are plain JavaScript (or TypeScript) evaluated with the DSL as globals. Geometry is
built when a shape is called; references (`stamp`, `scatter`) resolve at build time, so models may
use each other in any order.

Units are meters, Y is up, +Z faces the front, rotations are degrees applied X, then Y, then Z.
Meshes are flat-shaded (low-poly look); primitives are built with every face pointing outward (tested by signed volume).

## Materials

```js
pal({
  wood: "#9c6a4d",                                   // plain color, rough 0.8
  gold: { color: "#ffb43a", metal: 0.2, rough: 0.3 },
  lamp: { color: "#ffd28c", emit: "#ffc070", glow: 3 },   // emissive (glow = strength)
  copy: "wood",                                      // alias
})
```

**Textures from loom**: `{ tex: "path/to/loom/out/brick_wall", uv: 1.5, bump: 1, color: "#fff" }` uses a
[loom](https://github.com/uilianks/loom) material (its output folder, or the `.material.json` in it,
relative to the model file). Every face gets box-projected UVs from its dominant axis, `uv` meters per
texture tile, so tiles line up across faces and keep their size on any shape. The GLB embeds the albedo
(tinted by `color`), the ORM map (glTF metallic-roughness from G/B, occlusion from R), the GL normal map
(`bump` = strength) and the emissive map, all repeat-wrapped; `glow` > 1 boosts the emission. The
preview rasterizer samples the albedo and emissive, so the viewer shows the texture too.

The default palette has keys `0`–`f` (sweetie16). Voxel grids need single-character keys.
Every model keeps the palette active where it was defined.

## Models

```js
model(name, opts?, ...items)
group(name, ["rock_a", "rock_a", "rock_b"])   // random pick per stamp/scatter; repeat to weight
pack(name, ["tree*", "rock", group], { cols, spacing = 0.4 })
include("other.kx.js")
```

| Option | Meaning |
|---|---|
| `pivot` | `"bottom"` (default: centered in x/z, base on y = 0), `"center"`, `"origin"` (as built). |
| `base` | Start from another model (variant). |
| `swap` | `{ from: "to" }` material replacements. |
| `scale` | Uniform number or `[x, y, z]`. |

Names starting with `_` are parts: usable everywhere, never exported.

## Shapes

The last argument is a material key, or an options object with `mat` plus:

| Common option | Meaning |
|---|---|
| `pos`, `rot`, `scale` | Placement (scale, then rotate, then move). Rotation pivots on the shape's origin. |
| `jitter` | Move welded vertices randomly by up to this distance (hand-made look). |
| `seed` | Jitter seed (and rock shape). |

| Shape | Origin | Options |
|---|---|---|
| `box(w, h, d)` | base center | `bevel`: chamfer every edge and corner by this distance (26 faces): the soft, chunky stylised look. |
| `cyl(r, h)` | base center | `sides` (8), `top` (top radius: tapers), `bevel` (chamfer both rims) |
| `cone(r, h)` | base center | `sides` (8) |
| `sphere(r)` | center | `detail` 0–4 (1) |
| `rock(r)` | center | `detail` (1), `rough` (0.22), `squash` (0.75), `seed` |
| `lathe([r0, y0, r1, y1, ...])` | axis | `sides` (8). Profile from bottom to top; radius 0 closes a tip. |
| `extrude([x0, y0, x1, y1, ...], depth)` | outline coordinates | Any simple polygon (concave ok), in X/Y, extruded along Z. |
| `prism(w, h, d)` | base center | Gable roof: triangle in X/Y, ridge along Z. |
| `wedge(w, h, d)` | base center | Ramp: full height at the back, 0 at the front. |
| `torus(R, r)` | center | Ring of radius R around Y, tube radius r; `rings` (24) around, `sides` (12) around the tube. Rings, tires, donuts, halos. |
| `tube([x0, y0, z0, x1, y1, z1, ...], r)` | path coordinates | A pipe of radius r swept along the points: `sides` (8); `closed: true` joins the ends (otherwise they are capped). Frames are carried along the path so the tube never twists, and bends are mitered so the cross section stays full. Pipes, cables, rails, branches, tentacles, handles. |
| `terrain(w, d, { res, height, fn \| heightmap, mat })` | base center | A heightfield w × d meters: `res` cells per side (32, or `[nx, nz]`), `height` the vertical scale in meters (1). Heights 0..1 come from `fn: (x, z) => h` at world coordinates (centered) or `heightmap: "file.png"` (gray PNG, 16-bit kept, top row = back; a loom `_height.png` works as is). `mat` is a key, or `(h, slope, x, z) => key` per triangle (`slope` 0 flat .. 1 vertical): grass low, rock steep, snow high. Islands, hills, dungeon floors, dioramas. |

## Voxels

```js
voxels([layer0, layer1, ...], { size = 1, pos, rot, scale })
voxfn([nx, ny, nz], (x, y, z) => key | null, { size })
```

Layers run bottom to top. Each layer is a top-down map: rows go from the back (-z) to the front
(+z), columns from left (-x) to right (+x); `.` or space is empty, any other character is a
palette key. The grid is centered in x/z with its base on y = 0. Faces between voxels are removed
and coplanar faces of one material merge (greedy meshing).

```js
voximg("hero.png", { size = 0.1, depth = 1, alpha = 128, flat = false })
```

Voxels from a PNG (a pxl sprite, a logo, a map): every pixel with alpha ≥ `alpha` becomes `depth`
voxels of `size` meters in a material named after its color (`px_rrggbb`, added to the palette, so
`swap` can recolor it). Standing by default (image up = model up, depth along z); `flat: true` lays
it down (image rows run back to front, depth up: floor plans, tile maps). Paths are relative to the
model file.

## Structure and reuse

| Item | Meaning |
|---|---|
| `tf({ pos, rot, scale }, ...items)` | Transform a group. |
| `sym("x" \| "z", ...items)` | Items plus their mirror image across x = 0 (or z = 0). Nest for 4-way symmetry. |
| `stamp(name, { pos, rot, scale, swap })` | Place another model (or a random member of a group / glob). |
| `scatter(name, { area: [x0, z0, x1, z1], count, scale: [min, max], rot, y, seed, swap })` | Random copies, reproducible. `rot`: `[min, max]` degrees around Y, default random 0–360, `false` for none. |
| lists, `null`, `false` | Flattened / skipped. |

## Lights

```js
light({ type: "point" | "spot", color: "#ffbe78", power: 20, pos: [0, 0, 0], dir: [0, -1, 0], angle: 35, range })
```

`power` is in watts (Blender's unit); `angle` is the spot's cone half-angle in degrees. Lights are
items like shapes: they move with `tf`, `sym`, `stamp`, `scatter` and the model pivot, and export
as `KHR_lights_punctual` (child nodes of the model). Keep a light outside closed meshes such as a
bulb sphere, or that mesh will shadow it. When a model has lights, previews render at night.

## Animation

```js
model("windmill", ...,
  part("sails", { pivot: [0, 2.3, 0.6] }, ...items),            // a named node rotating about its pivot
  part("lantern", { pivot: [1.1, 1.3, 0.9] }, ...items,
    part("flame", { pivot: [1.1, 1.06, 0.9] }, ...items)))       // nested parts inherit their parent's motion
animate("windmill", "turn", { frames: 48, fps: 24 }, {
  sails: { rot: [[0, [0, 0, 0], "linear"], [48, [0, 0, -360]]] },
  flame: { scale: [[0, 1, "step"], [7, 0.5, "step"], [9, 1]] },
})
```

| Part | Meaning |
|---|---|
| `part(name, { pivot, parent? }, ...items)` | Items become a named node (glTF node) that rotates, moves and scales about `pivot`. Lights inside move with it. |
| `animate(model, clip, { frames, fps = 24 }, tracks)` | Keyframed clip: `{ part: { rot, move, scale } }`. |
| keys | `[[frame, value, ease?], ...]`, frames 0..`frames`; `rot` is `[x, y, z]` degrees (a number = around Y), `move` `[dx, dy, dz]`, `scale` a number or `[x, y, z]`. Eases: `inOut` (default), `linear`, `in`, `out`, `step`. |
| axes | Rotations are about the final model's axes, through the pivot. A model stamped with `rot: [0, -90, 0]` turns its "forward" axis too: check the clip strip. |
| `stamp(name, { as })` | Prefixes the stamped model's parts (`lamp1.sway`) so several copies can animate separately. `sym` copies get a `~m` suffix. Scattered copies are static. |

Clips export as glTF animations (one sample per frame, linear). `kiln build` writes
`out/_preview/<model>.<clip>.png`: 8 posed frames. Hide a part by scaling it to 0.001 (blinking signs, flames).

## Output and commands

`kiln build file.kx.js [--out DIR] [--only a,b] [--turntable] [--stl] [--no-preview]`

| Path | Content |
|---|---|
| `out/models/<name>.glb` | glTF 2.0 binary: one node, one primitive per material, flat normals, PBR materials. |
| `out/models/<name>.glb` with `--rig` | Models that use `part()` export as a **skinned skeleton**: one mesh weighted 100% per bone (rigid skinning), one bone per part (named after it) plus a `root` bone for the static body, inverse bind matrices, and the `animate()` clips targeting the bones. Godot imports it as `Skeleton3D` + `AnimationPlayer`; Blender / Unity as an armature. Models without parts are unchanged. Packs are not rigged. |
| `out/models/<name>.stl` | `--stl`: binary STL (triangles + normals, no materials) for 3D printing and CAD. |
| `out/<pack>.glb` | One node per model, laid out in rows. Engines import it as a library of named meshes. |
| `out/_preview/<name>.png` | Hero / front / right / top views, dimensions, triangle count, grid spacing, materials. |
| `out/_preview/<name>.gif` | `--turntable`: 36-frame orbit (needs ffmpeg). |

`kiln render file.kx.js <model|pack> [--out FILE] [--size WxH] [--yaw] [--pitch] [--samples] [--no-ground] [--transparent] [--frames N]`
renders with headless Blender (EEVEE, AgX, sun + sky lights, compositor bloom). `--frames N` renders
a turntable MP4 (needs ffmpeg).

| Flag | Meaning |
|---|---|
| `--mood night` | Dark world, faint moonlight and volumetric haze (`--fog`, default 0.03); the model's lights do the work. |
| `--focus x,y,z` | Aim at a point in model coordinates (Y up) instead of the bounds center. |
| `--zoom N`, `--lens MM` | Move the camera N times closer than fit-to-bounds; focal length (default 70). |
| `--yaw-to`, `--pitch-to`, `--zoom-to` | With `--frames`: an eased camera move from the start values to these, instead of a turntable. |
| `--audio FILE` | Mux a soundtrack into the MP4 (e.g. a chirp WAV). |
| `--clip NAME` | Play an `animate()` clip: looping over `--frames` (the video uses the clip's fps), or one pose with `--clip-frame N`. |
| `--still-camera` | With `--frames` and no camera move: keep the camera fixed (otherwise it orbits). |
| `--bloom N` | Glow strength around emissive materials (default 3, 0 = off). | Blender is found via `$KILN_BLENDER`, `blender` on PATH, or the
`org.blender.Blender` flatpak.

`kiln info file.kx.js <name>` prints bounds, triangles per material and build steps.
`kiln serve file.kx.js [--port 4340] [--no-out]` runs the live viewer. Its **annotate** mode (`a`)
freezes the camera; pins (click, then type a note) and pen strokes are drawn on that view and sent with
it (`yaw`, `pitch`, size). The server picks each one against the model with the viewer's own camera
and writes `<out>/_feedback/<model>.json`: `pins` (`text`, `screen`, `hit: { point, normal, mat, part,
step: { index, label, loc } }` or `null`), `strokes` (`onModel`, `covers`: hits grouped by step,
material and part with `min`/`max` bounds), `comment`, `view`; plus `<model>.annotated.png`. `kiln list file.kx.js` lists everything.
