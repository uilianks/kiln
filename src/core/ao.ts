// Baked ambient occlusion: cosine-weighted rays from every welded corner against all of the model's
// triangles (a BVH), deterministic per vertex. Returns per-corner colour 1 - strength * occlusion.
import { KilnError } from "./errors.ts";
import type { V3 } from "./util.ts";
import { hash, rng } from "./util.ts";

export interface AoOpts {
  /** How dark a fully occluded corner gets (0..1, default 0.6). */
  strength?: number;
  /** Ray length in meters (default: a quarter of the bounding radius, at most 1). */
  dist?: number;
  /** Rays per vertex (default 48). */
  rays?: number;
}

interface Tri { v: V3[]; n: V3[] }

/** Normalize an `ao` option: true | { strength, dist, rays } -> AoOpts, false/undefined -> undefined. */
export function aoOpts(v: unknown, what = "ao"): AoOpts | undefined {
  if (v === undefined || v === false) return undefined;
  if (v === true) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new KilnError(`${what}: true or { strength, dist, rays }`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["strength", "dist", "rays"].includes(k)) throw new KilnError(`${what}: unknown option '${k}' (strength, dist, rays)`);
  const n = (k: string, lo: number, hi: number) => {
    if (o[k] === undefined) return undefined;
    const x = Number(o[k]);
    if (!(x >= lo && x <= hi)) throw new KilnError(`${what}.${k} must be a number in ${lo}..${hi}`);
    return x;
  };
  return { strength: n("strength", 0, 1), dist: n("dist", 1e-6, 1e6), rays: n("rays", 1, 1024) };
}

/** Flat BVH over triangles: nodes [min3, max3, left|first, right|count, leaf]. */
function buildBVH(tris: Tri[]) {
  const n = tris.length, cen = new Float64Array(n * 3), lo = new Float64Array(n * 3), hi = new Float64Array(n * 3);
  tris.forEach((t, i) => {
    for (let c = 0; c < 3; c++) {
      const a = t.v[0][c], b = t.v[1][c], d = t.v[2][c];
      lo[i * 3 + c] = Math.min(a, b, d); hi[i * 3 + c] = Math.max(a, b, d); cen[i * 3 + c] = (a + b + d) / 3;
    }
  });
  const idx = Array.from({ length: n }, (_, i) => i);
  const bmin: number[] = [], bmax: number[] = [], left: number[] = [], right: number[] = [], first: number[] = [], count: number[] = [];
  const node = (s: number, e: number): number => {
    const id = bmin.length / 3;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = s; k < e; k++) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], lo[idx[k] * 3 + c]); mx[c] = Math.max(mx[c], hi[idx[k] * 3 + c]); }
    bmin.push(...mn); bmax.push(...mx); left.push(-1); right.push(-1); first.push(s); count.push(e - s);
    if (e - s <= 4) return id;
    let ax = 0;
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    if (ext[1] > ext[ax]) ax = 1;
    if (ext[2] > ext[ax]) ax = 2;
    const part = idx.slice(s, e).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax] || a - b);
    for (let k = s; k < e; k++) idx[k] = part[k - s];
    const m = (s + e) >> 1;
    count[id] = 0;
    left[id] = node(s, m);
    right[id] = node(m, e);
    return id;
  };
  if (n) node(0, n);
  return { idx, bmin, bmax, left, right, first, count };
}

/** Per-corner occlusion colour for every triangle (same order as `tris`). */
export function bakeAO(tris: Tri[], o: AoOpts): number[][] {
  const strength = o.strength ?? 0.6, rays = Math.round(o.rays ?? 48);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.v) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], p[c]); mx[c] = Math.max(mx[c], p[c]); }
  const radius = Math.max(1e-6, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
  const dist = o.dist ?? Math.min(1, radius * 0.25), eps = Math.max(1e-6, radius * 1e-5);
  const bvh = buildBVH(tris);
  const V = tris.map((t) => t.v);
  const TN = tris.map((t) => {
    const [a, b, c] = t.v, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const x = u[1] * w[2] - u[2] * w[1], y = u[2] * w[0] - u[0] * w[2], z = u[0] * w[1] - u[1] * w[0], l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  });

  /** Nearest hit within tmax. A surface the corner rests on (its plane through the ray origin, facing
   *  across the corner's normal) counts from t = 0 when the ray goes into its front: that is the contact. */
  const hit = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number, n: V3): number => {
    const inv = [1 / dx, 1 / dy, 1 / dz], o3 = [ox, oy, oz], stack = [0];
    let best = tmax;
    while (stack.length) {
      const nd = stack.pop()!;
      let t0 = 0, t1 = best;
      for (let c = 0; c < 3; c++) {
        let a = (bvh.bmin[nd * 3 + c] - o3[c]) * inv[c], b = (bvh.bmax[nd * 3 + c] - o3[c]) * inv[c];
        if (a > b) { const s = a; a = b; b = s; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) break;
      }
      if (t0 > t1) continue;
      if (bvh.left[nd] >= 0) { stack.push(bvh.left[nd], bvh.right[nd]); continue; }
      for (let k = bvh.first[nd]; k < bvh.first[nd] + bvh.count[nd]; k++) {
        const v = V[bvh.idx[k]], a = v[0];
        const e1x = v[1][0] - a[0], e1y = v[1][1] - a[1], e1z = v[1][2] - a[2];
        const e2x = v[2][0] - a[0], e2y = v[2][1] - a[1], e2z = v[2][2] - a[2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const id = 1 / det, tx = ox - a[0], ty = oy - a[1], tz = oz - a[2];
        const u = (tx * px + ty * py + tz * pz) * id;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * id;
        if (w < 0 || u + w > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * id;
        if (t < best && (t > eps || (t > -eps * 8 && dx * TN[bvh.idx[k]][0] + dy * TN[bvh.idx[k]][1] + dz * TN[bvh.idx[k]][2] < 0
          && n[0] * TN[bvh.idx[k]][0] + n[1] * TN[bvh.idx[k]][1] + n[2] * TN[bvh.idx[k]][2] < 0.5))) best = Math.max(0, t);
      }
    }
    return best;
  };

  const cache = new Map<string, number>();
  const at = (p: V3, n: V3): number => {
    const key = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}|${Math.round(n[0] * 1e3)},${Math.round(n[1] * 1e3)},${Math.round(n[2] * 1e3)}`;
    const hitC = cache.get(key);
    if (hitC !== undefined) return hitC;
    // tangent frame around n
    const ux = Math.abs(n[0]) < 0.9 ? [0, n[2], -n[1]] : [-n[2], 0, n[0]];
    const ul = Math.hypot(ux[0], ux[1], ux[2]) || 1;
    const u = [ux[0] / ul, ux[1] / ul, ux[2] / ul];
    const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const r = rng(hash(key)), spin = r() * Math.PI * 2;
    const ox = p[0] + n[0] * eps * 4, oy = p[1] + n[1] * eps * 4, oz = p[2] + n[2] * eps * 4;
    let occ = 0;
    for (let i = 0; i < rays; i++) {
      // cosine-weighted, stratified: a golden-angle spiral over the disk, lifted onto the hemisphere
      const s = (i + 0.5) / rays, rad = Math.sqrt(s), a = i * 2.399963229728653 + spin;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad, z = Math.sqrt(Math.max(0, 1 - s));
      const dx = u[0] * x + w[0] * y + n[0] * z, dy = u[1] * x + w[1] * y + n[1] * z, dz = u[2] * x + w[2] * y + n[2] * z;
      const t = hit(ox, oy, oz, dx, dy, dz, dist, n);
      if (t < dist) occ += 1 - t / dist;
    }
    const c = Math.max(0, Math.min(1, 1 - (strength * occ) / rays));
    cache.set(key, c);
    return c;
  };
  return tris.map((t) => t.v.map((p, k) => at(p, t.n[k])));
}
