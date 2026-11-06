# kiln reference

Model files are plain JavaScript (or TypeScript) evaluated with the DSL as globals. Geometry is
built when a shape is called; references (`stamp`, `scatter`) resolve at build time, so models may
use each other in any order.

Units are meters, Y is up, +Z faces the front, rotations are degrees applied X, then Y, then Z.
Meshes are flat-shaded by default (the low-poly look); `smooth`, `subdiv` and `ao` opt into the smooth stylised look
(see [Smooth shading, subdivision and baked AO](#smooth-shading-subdivision-and-baked-ao)). Primitives are built
with every face pointing outward (tested by signed volume).

## Materials

```js
pal({
  wood: "#9c6a4d",                                   // plain color, rough 0.8
  gold: { color: "#ffb43a", metal: 0.2, rough: 0.3 },
  lamp: { color: "#ffd28c", emit: "#ffc070", glow: 3 },   // emissive (glow = strength)
  copy: "wood",                                      // alias
  skin: { color: "#e2a97e", smooth: 40 },            // smooth-shaded wherever it is used
  glass: { color: "#a8c8e0", alpha: 0.35, double: true, rough: 0.1 },
})
```

| Material option | Meaning |
|---|---|
| `color`, `rough` (0.8), `metal` (0) | sRGB base colour and PBR roughness / metalness. |
| `emit`, `glow` | Emissive colour and strength (`KHR_materials_emissive_strength` when > 1). |
| `smooth` | Crease angle in degrees for faces of this material (see below); `0` or `false` = flat. |
| `alpha` | Opacity 0..1. Below 1 the material is exported with glTF `alphaMode: "BLEND"` and the alpha in `baseColorFactor`; previews blend it. Engines sort blended surfaces per object, so keep glass in its own model or part when it overlaps other glass. |
| `double` | `true` exports `doubleSided` (no back-face culling): leaves, flags, paper, single-plane cards, glass panes seen from both sides. |
| `tex`, `uv`, `bump` | A loom material (below). |

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
| `smooth` | Default crease angle for the model's faces (degrees; `true` = 50). A shape's or material's own `smooth` wins. |
| `ao` | Bake ambient occlusion into the vertex colours: `true` or `{ strength = 0.6, dist, rays = 48 }` (see below). |

Names starting with `_` are parts: usable everywhere, never exported.

## Shapes

The last argument is a material key, or an options object with `mat` plus:

| Common option | Meaning |
|---|---|
| `pos`, `rot`, `scale` | Placement (scale, then rotate, then move). Rotation pivots on the shape's origin. |
| `jitter` | Move welded vertices randomly by up to this distance (hand-made look). |
| `seed` | Jitter seed (and rock shape). |
| `smooth` | Crease angle in degrees for this shape's faces: edges sharper than this stay crisp, the rest shade smooth. `true` = 50, `0` / `false` = flat (overrides the model and the material). |

| Shape | Origin | Options |
|---|---|---|
| `box(w, h, d)` | base center | `bevel`: chamfer every edge and corner by this distance (26 faces): the soft, chunky stylised look. |
| `cyl(r, h)` | base center | `sides` (8), `top` (top radius: tapers), `bevel` (chamfer both rims) |
| `cone(r, h)` | base center | `sides` (8) |
| `sphere(r)` | center | `detail` 0–6 (1): 20 × 4^detail triangles (detail 5 = 20,480, 6 = 81,920). With `smooth`, detail 2–3 already reads round. |
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
| `subdiv(levels, ...items)` or `subdiv({ levels, crease = 60 }, ...items)` | Subdivide the items' surfaces (see below). |
| lists, `null`, `false` | Flattened / skipped. |

## Smooth shading, subdivision and baked AO

The default is flat: every face has its own normal, and files that do not use these options build
byte-identical GLBs (a golden-hash test guards it; previews may differ by a pixel or two). The smooth stylised look is three opt-in tools that work together: soft forms, crisp creases,
darker cavities, flat colours.

**`smooth: angle`** (a shape, a material or a model). Faces shade smooth across edges whose dihedral angle
(the angle between the two face normals) is at most `angle` degrees; sharper edges stay crisp. A ring of
`sides` segments turns 360 / `sides` degrees per edge, so the angle must be above that: 50 (`true`) rounds
8-sided cylinders, tubes and lathes, detail-1 spheres and the 45° chamfers of a `bevel` (a bevelled box
becomes a soft-edged box: normals are weighted by face area, so its big faces stay within a few degrees
of flat); 65 rounds 6-sided ones; 30 keeps chamfers and 8-sided rings crisp but rounds
spheres of detail 2 and up. A box's 90° corners stay sharp below 90. Precedence: the shape's option, then the material's, then the model's. Faces made by `subdiv` carry its
`crease` as their own (set `smooth` on the shape inside `subdiv` to change it), and a `base` variant keeps
its base's faces as built, with their smooth, and its base's `ao` unless it sets its own. Smoothing only joins faces
that share vertices within one part: two shapes that intersect keep a crisp seam, and every `part()` shades
on its own. Smooth costs no triangles; the GLB gets welded, indexed primitives (fewer vertices than flat).

**`subdiv(levels, ...items)`** rounds the items' geometry: Loop subdivision when every face is a triangle
(spheres, rocks, jittered shapes), Catmull-Clark otherwise. Each level multiplies triangles by about 4
(Catmull-Clark on a triangle: 6). Edges whose dihedral angle is above `crease` (default 60°), open edges and
edges shared by more than two faces stay sharp, with the crease and corner rules, so an unbevelled box stays a
box, a cylinder's rims stay crisp while its sides round, and a `bevel` lets a box round at all: it subdivides
into a soft, slightly pillowed block whose roundness grows with the bevel (the corner radius ends up about
twice the bevel). Output quads can be a few millimetres off-plane; every exporter splits them into triangles. The result is marked
`smooth: crease` unless its faces already have a `smooth`. `levels` is 1–4. The surface shrinks toward the
inside of the original control shape (a subdivided detail-1 sphere is about 10% smaller): size it slightly
bigger, or use a higher `detail` and `smooth` instead. Spend it where silhouettes show (heads, hair, crowns,
tyres); `smooth` alone is usually enough on small parts.

**`ao: true | { strength = 0.6, dist, rays = 48 }`** (a model option; variants inherit it) bakes ambient occlusion per vertex at
build: rays from every vertex over the hemisphere around its normal, against all of the model's triangles,
out to `dist` meters (default a quarter of the model's bounding radius, at most 1 m, so it differs between
a character alone and the same character on a bike: a project should set `dist` itself, for example 0.2 for
characters, so its assets match). Occlusion `o` (0..1)
becomes the vertex colour `1 - strength × o` in `COLOR_0` (linear), which glTF multiplies into the base
colour: creases, contacts and the undersides of overhangs darken, flat colour stays flat colour. Flat faces
get per-corner values too (a gradient across the face). It is computed in the rest pose with all parts
together, and adds no triangles; the build takes longer (about 1 s per 10,000 triangles). The previews,
the viewer, `kiln render` and Blender show it. AO lives **on vertices**: a big flat face with vertices only
at its corners (a box's top) gets no contact shadow in its middle, so give the receiving surface vertices
where the shadow should fall (a `terrain`, more `sides`, `subdiv`), or let the engine's SSAO do floors.
Parts that rest exactly on a surface get their contact shadow. Every AO step is a shade darker than the
palette colour: for a strict small palette, try `strength: 0.3`. AO is baked in the rest pose, so it does not
follow animated parts. Posed clip strips and pack previews leave AO out (the pack GLB has it).

**Engines.** Godot 4.7 imports `COLOR_0` as the mesh's vertex colours (linear) and smooth normals as they
are. Its importer also turns on *Vertex Color → Use as Albedo* on the imported materials, except, in
4.7.2, on the material of the file's very first primitive when no later primitive uses it (checked on
kiln GLBs; cause unknown). So set it yourself rather than rely on it: `vertex_color_use_as_albedo = true` on
every `StandardMaterial3D` the model uses (an import script, a material override, or the component that
dresses imported models), or `ALBEDO = albedo.rgb * COLOR.rgb;` in a `ShaderMaterial`. Leave
*Vertex Color → Is sRGB* off: the values are linear. Smooth normals need nothing. Blender 5.2's importer
wires the vertex colour into each material by itself. Unity and three.js multiply vertex colours only when
the material asks for it (`vertexColors: true` in three.js).

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
| `out/models/<name>.glb` | glTF 2.0 binary: one node, one primitive per material, PBR materials. Flat primitives have one normal per triangle (no index buffer); primitives with `smooth` faces or `ao` are welded and indexed, with corner normals and `COLOR_0`. |
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
| `--bloom N` | Glow strength around emissive materials (default 3, 0 = off). |
| `--look studio` | Look-dev lighting: Blender's bundled studio HDRI as the world (lighting only: the camera sees a flat grey backdrop), one soft key light, horizon-scan ambient occlusion for contact shading, a light grey floor, no bloom unless `--bloom` is given. Judges shapes and shading rather than mood. |
| `--preset game` | The camera a fixed-angle game uses: yaw 45°, pitch 35°, 25° vertical field of view, 25.8 m from the model's center (Garupa's follow camera), so you see the asset at the size the player does. `--zoom` still moves it closer; `--yaw`/`--pitch` override the angles. |

Blender is found via `$KILN_BLENDER`, `blender` on PATH, or the `org.blender.Blender` flatpak. Renders keep
the GLB's normals (flat or smooth) and multiply baked `COLOR_0` into each material's base colour.

`kiln info file.kx.js <name>` prints bounds, triangles per material and build steps.
`kiln serve file.kx.js [--port 4340] [--no-out]` runs the live viewer. Its **annotate** mode (`a`)
freezes the camera; pins (click, then type a note) and pen strokes are drawn on that view and sent with
it (`yaw`, `pitch`, size). The server picks each one against the model with the viewer's own camera
and writes `<out>/_feedback/<model>.json`: `pins` (`text`, `screen`, `hit: { point, normal, mat, part,
step: { index, label, loc } }` or `null`), `strokes` (`onModel`, `covers`: hits grouped by step,
material and part with `min`/`max` bounds), `comment`, `view`; plus `<model>.annotated.png`. `kiln list file.kx.js` lists everything.
