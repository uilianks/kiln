# ADR 0001: smooth shading on a polygon-soup model (welded at export)

Date: 2026-11-06 · Status: accepted

## Context

kiln builds every model as polygon soup: a list of flat, convex, planar polygons (`Face`), each with a
material and an optional animated part. Every operation works on that list: transforms, `sym`, `stamp`,
`scatter`, `jitter`, part posing, voxel meshing, packs. The GLB writer triangulates and writes one face
normal per triangle with no index buffer, and the Blender render forces flat shading. The result is the
faceted low-poly look and nothing else: round things (heads, hair, tyres, tree crowns) can only get
rounder by adding triangles, and every edge reads as a hard crease.

The owner chose a "smooth stylised" direction (2026-11-06): soft rounded forms, crisp creases, baked
ambient occlusion, still flat colour, up to about 2× today's triangle budgets. Existing assets (Garupa's
especially) must not change unless they opt in.

## Decision

1. **The modeling representation stays polygon soup.** Shading is data on the faces, not a new mesh type:
   `Face.smooth` (a crease angle in degrees; absent or 0 = flat) travels through every existing operation
   unchanged, because they all copy faces with `{ ...f }`.
2. **Welding happens where it is needed, by position.** `src/core/shade.ts` welds triangle corners by
   quantized position (0.01 mm) within one part and computes **corner normals**: a smooth face's corner
   averages, weighted by face area × corner angle (so a bevel's narrow chamfers barely tilt the big faces), the normals of the smooth faces around that point whose normal is
   within the crease angle (the smaller of the two faces' angles). Flat faces keep their face normal. The
   GLB writer, the preview rasterizer and the AO baker all use these normals, so what the agent sees is
   what the engine gets.
3. **Indexed output only when it is used.** A glTF primitive with no smooth face and no baked AO is
   written exactly as before (non-indexed, one face normal per triangle), so old `.kx.js` files build
   byte-identical GLBs (`test/golden-glb.json`, recorded with the previous release). A primitive that has
   either is written welded and indexed: one vertex per unique (position, normal, AO, UV, bone), an index buffer (`UNSIGNED_SHORT`, or `UNSIGNED_INT` past 65,535 vertices).
4. **Subdivision is a build-time item, not a mesh mode.** `subdiv(levels, ...items)` welds its items into
   an indexed half-edge-free face/edge table (per part), subdivides (Loop when every face is a triangle,
   Catmull-Clark otherwise) keeping sharp edges (dihedral angle above the crease, boundaries,
   non-manifold edges) with the crease/corner rules, and returns polygon soup again, marked smooth. Its
   Catmull-Clark quads may be slightly non-planar; every consumer fan-triangulates and uses Newell normals.
5. **Ambient occlusion is baked per vertex at export** (`ao` on a model): rays from every welded corner
   against all the model's triangles (a BVH), written as `COLOR_0` (linear float RGB). A surface whose plane
   passes through the vertex (a part resting on it) counts from t = 0, so exact contacts get their shadow. It multiplies the
   base colour in glTF, so the palette stays flat colour with darker cavities.

## Consequences

- No existing operation changed; the risk is contained in three new modules (`shade.ts`, `subdiv.ts`,
  `ao.ts`) and the writer's indexed path.
- Normals are recomputed from the final (posed, for clip strips) geometry, never stored, so they cannot
  go stale after a transform. A mirrored or negatively scaled copy is handled because faces are already
  re-wound by `transform`.
- Smoothing never crosses parts (each part is its own node) and never joins shapes that do not share
  vertex positions: two interpenetrating spheres stay two surfaces with a crisp intersection.
- AO is computed in the rest pose, with all parts together. A part that moves far (an opening lid) keeps
  the occlusion of its rest pose.
- Welded, indexed primitives are smaller than flat ones for smooth meshes (about 3× fewer vertices).
- Rejected: an indexed half-edge mesh as the core type (every operation would need rewriting and voxels,
  `jitter` and posing would gain nothing); storing normals on faces at build time (they would go stale
  through `stamp`/`sym`/posing).
