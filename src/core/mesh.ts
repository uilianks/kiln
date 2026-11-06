// A mesh is a list of flat, convex, planar polygons with a material key each (subdiv() output may be a few mm
// off-plane quads; every consumer fan-triangulates and uses Newell normals): polygon soup, which every
// operation (transforms, mirrors, stamps, jitter, posing) works on. Shading is data on the faces
// (`smooth`); welded corner normals are computed from the final geometry (shade.ts, docs/adr/0001).
import { KilnError } from "./errors.ts";
import { type M, type V3, apply, det, dot, hash, norm, rng } from "./util.ts";

export interface Face {
  v: V3[];
  mat: string;
  /** Animated part this face belongs to (none = the model's static body). */
  part?: string;
  /** Crease angle in degrees: shade smooth across edges up to this angle (absent or 0 = flat). */
  smooth?: number;
}

/** An animatable part: a named node that rotates / moves / scales about its pivot. */
export interface Joint {
  name: string;
  parent?: string;
  pivot: V3;
}

/** Newell normal (robust for any planar polygon), counter-clockwise = outward. */
export function faceNormal(v: V3[]): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return norm([x, y, z]);
}

/** Flip a face if it points against `outward` (used by primitives to guarantee CCW-outward). */
export function orient(v: V3[], outward: V3): V3[] {
  return dot(faceNormal(v), outward) < 0 ? v.slice().reverse() : v;
}

/** A punctual light carried with geometry (exported as KHR_lights_punctual). */
export interface Light {
  type: "point" | "spot";
  color: string;
  /** Watts, Blender-style. */
  power: number;
  pos: V3;
  /** Spot direction (unit). */
  dir: V3;
  /** Spot cone half-angle in degrees. */
  angle?: number;
  range?: number;
  part?: string;
}

/** Geometry plus the lights that travel with it through stamps, mirrors and transforms. */
export interface Part {
  faces: Face[];
  lights: Light[];
  joints?: Joint[];
}

/** Rename every part in a bundle (stamp `as`, mirrored copies, scatter instances). */
export function renameParts(p: Part, fn: (n: string) => string): Part {
  if (!p.joints?.length) return p;
  return {
    faces: p.faces.map((f) => (f.part ? { ...f, part: fn(f.part) } : f)),
    lights: p.lights.map((l) => (l.part ? { ...l, part: fn(l.part) } : l)),
    joints: p.joints.map((j) => ({ name: fn(j.name), parent: j.parent && fn(j.parent), pivot: j.pivot })),
  };
}

export function transformLights(lights: Light[], m: M): Light[] {
  return lights.map((l) => {
    const o = apply(m, [0, 0, 0]), d = apply(m, l.dir);
    return { ...l, pos: apply(m, l.pos), dir: norm([d[0] - o[0], d[1] - o[1], d[2] - o[2]]) };
  });
}

export function transformPart(p: Part, m: M): Part {
  return { faces: transform(p.faces, m), lights: transformLights(p.lights, m), joints: p.joints?.map((j) => ({ ...j, pivot: apply(m, j.pivot) })) };
}

export function transform(faces: Face[], m: M): Face[] {
  const flip = det(m) < 0;
  return faces.map((f) => {
    const v = f.v.map((p) => apply(m, p));
    return { ...f, v: flip ? v.reverse() : v };
  });
}

export function recolor(faces: Face[], swap: Record<string, string>): Face[] {
  return faces.map((f) => (swap[f.mat] ? { ...f, mat: swap[f.mat] } : f));
}

/** Move welded vertices together by up to `amount` (deterministic): the classic low-poly wobble. */
export function jitter(faces: Face[], amount: number, seed: number): Face[] {
  const moved = new Map<string, V3>();
  const at = (p: V3): V3 => {
    const k = p.map((c) => Math.round(c * 1e4)).join(",");
    let o = moved.get(k);
    if (!o) {
      const r = rng(hash(k) ^ seed);
      o = [p[0] + (r() * 2 - 1) * amount, p[1] + (r() * 2 - 1) * amount, p[2] + (r() * 2 - 1) * amount];
      moved.set(k, o);
    }
    return o;
  };
  // Polygons with more than 3 corners would turn non-planar: triangulate first.
  return triangulate(faces).map((f) => ({ ...f, v: f.v.map(at) }));
}

/** Fan triangulation (faces are convex). */
export function triangulate(faces: Face[]): Face[] {
  const out: Face[] = [];
  for (const f of faces) {
    if (f.v.length === 3) { out.push(f); continue; }
    for (let i = 1; i < f.v.length - 1; i++) out.push({ ...f, v: [f.v[0], f.v[i], f.v[i + 1]] });
  }
  return out;
}

export interface Bounds {
  min: V3;
  max: V3;
}

export function bounds(faces: Face[]): Bounds {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const f of faces)
    for (const p of f.v)
      for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
  if (!faces.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function triCount(faces: Face[]): number {
  return faces.reduce((a, f) => a + f.v.length - 2, 0);
}

/** Ear-clipping triangulation of a simple 2D polygon (any winding). Returns index triples. */
export function earClip(pts: [number, number][]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) throw new KilnError("a polygon needs at least 3 points");
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = Array.from({ length: n }, (_, i) => i);
  if (area < 0) idx.reverse();
  const crossZ = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: number[], a: number[], b: number[], c: number[]) => crossZ(a, b, p) >= 0 && crossZ(b, c, p) >= 0 && crossZ(c, a, p) >= 0;
  const out: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (crossZ(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new KilnError("polygon is self-intersecting; points must trace the outline without crossing");
  }
  out.push([idx[0], idx[1], idx[2]]);
  return out;
}

