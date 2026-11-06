// Low-poly primitives. Boxes, cylinders, cones, lathes, prisms and extrusions sit on y = 0
// (centered in x/z); spheres and rocks are centered on the origin. Every face is CCW-outward.
import { KilnError } from "./errors.ts";
import { type Face, earClip, faceNormal, orient } from "./mesh.ts";
import { type V3, add, cross, dot, len, norm, rng, scl, sub } from "./util.ts";

export function box(w: number, h: number, d: number, mat: string, bevel = 0): Face[] {
  const b = Math.min(bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (b > 0) return chamferBox(w, h, d, b, mat);
  const x = w / 2, z = d / 2;
  const c: V3 = [0, h / 2, 0];
  const quads: V3[][] = [
    [[-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]], [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]],
    [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, z]], [[-x, 0, -z], [-x, 0, z], [-x, h, z], [-x, h, -z]],
    [[-x, h, z], [x, h, z], [x, h, -z], [-x, h, -z]], [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]],
  ];
  return quads.map((v) => ({ v: orient(v, sub(centroid(v), c)), mat }));
}

/** Box with every edge and corner cut at 45° by `b` (6 faces + 12 edge strips + 8 corner triangles): the soft, chunky look. */
function chamferBox(w: number, h: number, d: number, b: number, mat: string): Face[] {
  const X = w / 2, Y = h / 2, Z = d / 2, x = X - b, y = Y - b, z = Z - b;
  const loops: V3[][] = [];
  const S = [-1, 1], ring4: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const s of S) {
    loops.push(ring4.map(([a, c]) => [s * X, a * y, c * z] as V3), ring4.map(([a, c]) => [a * x, s * Y, c * z] as V3), ring4.map(([a, c]) => [a * x, c * y, s * Z] as V3));
    for (const t of S) {
      loops.push([[s * X, t * y, -z], [s * X, t * y, z], [s * x, t * Y, z], [s * x, t * Y, -z]]);   // X-Y edge
      loops.push([[s * X, -y, t * z], [s * X, y, t * z], [s * x, y, t * Z], [s * x, -y, t * Z]]);   // X-Z edge
      loops.push([[-x, s * Y, t * z], [x, s * Y, t * z], [x, s * y, t * Z], [-x, s * y, t * Z]]);   // Y-Z edge
      for (const u of S) loops.push([[s * X, t * y, u * z], [s * x, t * Y, u * z], [s * x, t * y, u * Z]]);
    }
  }
  return loops.map((v) => { const m = v.map((p) => [p[0], p[1] + Y, p[2]] as V3); return { v: orient(m, centroid(v)), mat }; });
}

function centroid(v: V3[]): V3 {
  return scl(v.reduce((a, p) => add(a, p), [0, 0, 0] as V3), 1 / v.length);
}

function ring(r: number, y: number, sides: number): V3[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    return [Math.sin(a) * r, y, Math.cos(a) * r] as V3;
  });
}

/** Revolve a profile of [radius, y] points (bottom to top) around the Y axis. */
export function lathe(profile: [number, number][], sides: number, mat: string): Face[] {
  if (profile.length < 2) throw new KilnError("lathe needs at least 2 [radius, y] points");
  if (!(sides >= 3)) throw new KilnError("sides must be >= 3");
  const rings = profile.map(([r, y]) => ring(r, y, sides));
  const faces: Face[] = [];
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    const nr = y1 - y0, ny = -(r1 - r0);                       // outward normal in the (r, y) plane
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
      const mid = norm(add(a, b).map((v, n) => (n === 1 ? 0 : v)) as V3);
      const out = add(scl(mid, nr), [0, ny, 0]);
      const v = r0 < 1e-9 ? [a, c, d] : r1 < 1e-9 ? [a, b, c] : [a, b, c, d];
      if (r0 < 1e-9 && r1 < 1e-9) continue;
      faces.push({ v: orient(v, out), mat });
    }
  }
  const capAt = (k: number, down: boolean) => {
    const [r, y] = profile[k];
    if (r > 1e-9) faces.push({ v: orient(rings[k], [0, down ? -1 : 1, 0]), mat });
    return y;
  };
  capAt(0, profile[0][1] <= profile[profile.length - 1][1]);
  capAt(profile.length - 1, profile[0][1] > profile[profile.length - 1][1]);
  return faces;
}

export const cyl = (r: number, h: number, sides: number, r2: number, mat: string) => lathe([[r, 0], [r2, h]], sides, mat);

/** Gable prism (a roof): triangle of width w and height h in X/Y, depth d along Z. */
export function prism(w: number, h: number, d: number, mat: string): Face[] {
  return extrude([[-w / 2, 0], [w / 2, 0], [0, h]], d, mat);
}

/** Ramp: full height at the back (-z), down to 0 at the front (+z). */
export function wedge(w: number, h: number, d: number, mat: string): Face[] {
  const x = w / 2, z = d / 2, c: V3 = [0, h / 3, -z / 3];
  const polys: V3[][] = [
    [[-x, 0, z], [x, 0, z], [x, h, -z], [-x, h, -z]], [[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z]],
    [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]], [[x, 0, z], [x, 0, -z], [x, h, -z]], [[-x, 0, z], [-x, 0, -z], [-x, h, -z]],
  ];
  return polys.map((v) => ({ v: orient(v, sub(centroid(v), c)), mat }));
}

/** Extrude a 2D outline (X/Y, any simple polygon) along Z, centered. */
export function extrude(pts: [number, number][], depth: number, mat: string): Face[] {
  const tris = earClip(pts);
  const z = depth / 2, faces: Face[] = [];
  for (const [a, b, c] of tris) {
    faces.push({ v: orient([[...pts[a], z], [...pts[b], z], [...pts[c], z]] as V3[], [0, 0, 1]), mat });
    faces.push({ v: orient([[...pts[a], -z], [...pts[b], -z], [...pts[c], -z]] as V3[], [0, 0, -1]), mat });
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const out: V3 = area > 0 ? [dy, -dx, 0] : [-dy, dx, 0];
    faces.push({ v: orient([[p[0], p[1], z], [p[0], p[1], -z], [q[0], q[1], -z], [q[0], q[1], z]], out), mat });
  }
  return faces;
}

/** Indexed icosphere. */
function ico(detail: number): { pts: V3[]; tris: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let pts: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V3));
  let tris: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < detail; k++) {
    const cache = new Map<string, number>(), next: [number, number, number][] = [];
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = cache.get(key);
      if (i === undefined) { i = pts.length; pts.push(norm(scl(add(pts[a], pts[b]), 0.5))); cache.set(key, i); }
      return i;
    };
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = next;
  }
  pts = pts.slice();
  return { pts, tris };
}

export function sphere(r: number, detail: number, mat: string): Face[] {
  if (!(detail >= 0 && detail <= 6)) throw new KilnError("detail must be 0..6");
  const { pts, tris } = ico(detail);
  return tris.map(([a, b, c]) => {
    const v: V3[] = [scl(pts[a], r), scl(pts[b], r), scl(pts[c], r)];
    return { v: orient(v, add(add(v[0], v[1]), v[2])), mat };
  });
}

/** A rock: an icosphere with each vertex pushed in or out, optionally squashed. */
export function rock(r: number, detail: number, rough: number, squash: number, seed: number, mat: string): Face[] {
  const { pts, tris } = ico(detail);
  const rr = rng(seed);
  const moved = pts.map((p) => {
    const k = 1 + (rr() * 2 - 1) * rough;
    return [p[0] * r * k, p[1] * r * k * squash, p[2] * r * k] as V3;
  });
  return tris.map(([a, b, c]) => {
    const v: V3[] = [moved[a], moved[b], moved[c]];
    return { v: orient(v, add(add(v[0], v[1]), v[2])), mat };
  });
}

/** A torus around the Y axis: ring radius R, tube radius r; `rings` segments around, `sides` around the tube. */
export function torus(R: number, r: number, rings: number, sides: number, mat: string): Face[] {
  if (!(rings >= 3 && sides >= 3)) throw new KilnError("torus: rings and sides must be >= 3");
  const pt = (i: number, j: number): V3 => {
    const a = (i / rings) * Math.PI * 2, b = (j / sides) * Math.PI * 2 + Math.PI / sides;
    const d = R + Math.cos(b) * r;
    return [Math.sin(a) * d, Math.sin(b) * r, Math.cos(a) * d];
  };
  const faces: Face[] = [];
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < sides; j++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const ca = (i + 0.5) / rings * Math.PI * 2, center: V3 = [Math.sin(ca) * R, 0, Math.cos(ca) * R];
      faces.push({ v: orient([a, b, c, d], sub(centroid([a, b, c, d]), center)), mat });
    }
  return faces;
}

/**
 * A tube of radius r swept along a polyline (pipes, cables, branches, rails). Rings are carried
 * along with parallel-transport frames so they never twist; `closed` joins the last point to the
 * first, otherwise both ends are capped.
 */
export function tube(path: V3[], r: number, sides: number, closed: boolean, mat: string): Face[] {
  if (path.length < 2) throw new KilnError("tube needs at least 2 points");
  if (!(sides >= 3)) throw new KilnError("sides must be >= 3");
  const pts = closed ? [...path, path[0]] : path;
  // one tangent per point: the average of the directions in and out; at a bend the ring is mitered
  // (stretched across the bend by 1 / cos(half angle)) so the pipe keeps its full cross section
  const miters: { s: V3; m: number }[] = [];
  const dirs = pts.map((p, i) => {
    const prev = pts[i - 1] ?? (closed ? pts[pts.length - 2] : undefined), next = pts[i + 1] ?? (closed ? pts[1] : undefined);
    const a = prev ? norm(sub(p, prev)) : [0, 0, 0] as V3, b = next ? norm(sub(next, p)) : [0, 0, 0] as V3;
    const t = norm(add(a, b));
    const bend = prev && next && len(sub(b, a)) > 1e-9;
    miters.push(bend ? { s: norm(sub(b, a)), m: Math.min(4, 1 / Math.max(0.25, dot(a, t))) } : { s: [0, 0, 0], m: 1 });
    return len(t) > 0 ? t : norm(len(b) ? b : a);
  });
  // parallel transport: start with any perpendicular, rotate it along the path
  let u: V3 = Math.abs(dirs[0][1]) < 0.9 ? norm(cross(dirs[0], [0, 1, 0])) : norm(cross(dirs[0], [1, 0, 0]));
  const frames = dirs.map((t, i) => {
    if (i) {
      const prev = dirs[i - 1], axis = cross(prev, t), s = len(axis);
      if (s > 1e-9) {
        const ax = scl(axis, 1 / s), ang = Math.atan2(s, dot(prev, t)), c = Math.cos(ang), sn = Math.sin(ang);
        u = norm(add(add(scl(u, c), scl(cross(ax, u), sn)), scl(ax, dot(ax, u) * (1 - c))));
      }
    }
    return { t, u, v: cross(t, u) };
  });
  const ring = (i: number): V3[] => Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2 + Math.PI / sides, f = frames[i], mt = miters[i];
    let o = add(scl(f.u, Math.cos(a) * r), scl(f.v, Math.sin(a) * r));
    if (mt.m !== 1) o = add(o, scl(mt.s, (mt.m - 1) * dot(o, mt.s)));
    return add(pts[i], o);
  });
  const rings = pts.map((_, i) => ring(i));
  const faces: Face[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = rings[i], B = rings[i + 1], mid = scl(add(pts[i], pts[i + 1]), 0.5);
    for (let k = 0; k < sides; k++) {
      const j = (k + 1) % sides, v = [A[k], A[j], B[j], B[k]];
      faces.push({ v: orient(v, sub(centroid(v), mid)), mat });
    }
  }
  if (!closed) {
    faces.push({ v: orient(rings[0], scl(dirs[0], -1)), mat });
    faces.push({ v: orient(rings[rings.length - 1], dirs[dirs.length - 1]), mat });
  }
  return faces;
}

/**
 * A heightfield w × d meters with nx × nz cells: `height(x, z)` gives 0..1 at world coordinates
 * (centered in x/z), scaled by `scale` meters. Diagonals alternate per cell. `matOf` picks each
 * triangle's material from its normalized height, slope (0 flat .. 1 vertical) and position.
 */
export function terrain(w: number, d: number, nx: number, nz: number, scale: number, height: (x: number, z: number) => number,
  matOf: (h: number, slope: number, x: number, z: number) => string): Face[] {
  if (!(nx >= 1 && nz >= 1)) throw new KilnError("terrain res must be >= 1");
  const hs = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const v = height((i / nx - 0.5) * w, (j / nz - 0.5) * d);
      if (typeof v !== "number" || !Number.isFinite(v)) throw new KilnError(`terrain height must return a number, got ${JSON.stringify(v)} at cell ${i},${j}`);
      hs[j * (nx + 1) + i] = Math.max(0, Math.min(1, v));
    }
  const P = (i: number, j: number): V3 => [(i / nx - 0.5) * w, hs[j * (nx + 1) + i] * scale, (j / nz - 0.5) * d];
  const faces: Face[] = [];
  const tri = (a: V3, b: V3, c: V3) => {
    const v = orient([a, b, c], [0, 1, 0]), n = faceNormal(v);
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3, h = (a[1] + b[1] + c[1]) / 3 / (scale || 1);
    faces.push({ v, mat: matOf(h, Math.max(0, Math.min(1, 1 - n[1])), cx, cz) });
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), e = P(i, j + 1);
      if ((i + j) % 2) { tri(a, b, c); tri(a, c, e); } else { tri(a, b, e); tri(b, c, e); }
    }
  return faces;
}
