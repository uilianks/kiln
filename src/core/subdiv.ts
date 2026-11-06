// Subdivision surfaces on polygon soup: weld by position (per part), then Loop (all triangles) or
// Catmull-Clark (anything else). Sharp edges (dihedral angle above the crease, open edges, edges of
// more than two faces) keep the crease and corner rules and stay sharp at every level.
import { KilnError } from "./errors.ts";
import { type Face, faceNormal } from "./mesh.ts";
import { weldKey } from "./shade.ts";
import { type V3, dot } from "./util.ts";

interface Poly { idx: number[]; src: Face }
const EK = 67108864;
const ekey = (a: number, b: number) => (a < b ? a * EK + b : b * EK + a);

interface Topo { edges: Map<number, { a: number; b: number; faces: number[]; i: number }>; list: { a: number; b: number; faces: number[]; i: number }[] }
function topology(F: Poly[]): Topo {
  const edges: Topo["edges"] = new Map(), list: Topo["list"] = [];
  F.forEach((f, fi) => f.idx.forEach((a, k) => {
    const b = f.idx[(k + 1) % f.idx.length], key = ekey(a, b);
    let e = edges.get(key);
    if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), faces: [], i: list.length }; edges.set(key, e); list.push(e); }
    e.faces.push(fi);
  }));
  return { edges, list };
}

const avg = (ps: V3[]): V3 => {
  const o: V3 = [0, 0, 0];
  for (const p of ps) { o[0] += p[0]; o[1] += p[1]; o[2] += p[2]; }
  return [o[0] / ps.length, o[1] / ps.length, o[2] / ps.length];
};
const lin = (terms: [number, V3][]): V3 => {
  const o: V3 = [0, 0, 0];
  for (const [w, p] of terms) { o[0] += w * p[0]; o[1] += w * p[1]; o[2] += w * p[2]; }
  return o;
};

/** Per vertex: incident edges and the other ends of its sharp edges. */
function vertexInfo(n: number, list: Topo["list"], isSharp: (e: Topo["list"][0]) => boolean) {
  const inc: number[][] = Array.from({ length: n }, () => []), sharpNb: number[][] = Array.from({ length: n }, () => []);
  for (const e of list) {
    inc[e.a].push(e.i); inc[e.b].push(e.i);
    if (isSharp(e)) { sharpNb[e.a].push(e.b); sharpNb[e.b].push(e.a); }
  }
  return { inc, sharpNb };
}

function catmullClark(P: V3[], F: Poly[], sharp: Set<number>): { P: V3[]; F: Poly[]; sharp: Set<number> } {
  const { edges, list } = topology(F), nV = P.length, nE = list.length;
  const isSharp = (e: Topo["list"][0]) => e.faces.length !== 2 || sharp.has(ekey(e.a, e.b));
  const fp = F.map((f) => avg(f.idx.map((i) => P[i])));
  const ep = list.map((e) => (isSharp(e) ? avg([P[e.a], P[e.b]]) : avg([P[e.a], P[e.b], fp[e.faces[0]], fp[e.faces[1]]])));
  const { inc, sharpNb } = vertexInfo(nV, list, isSharp);
  const incF: number[][] = Array.from({ length: nV }, () => []);
  F.forEach((f, fi) => f.idx.forEach((v) => incF[v].push(fi)));
  const vp = P.map((p, v) => {
    const k = sharpNb[v].length, n = inc[v].length;
    if (!n) return p;
    if (k >= 3) return p;
    if (k === 2) return lin([[0.75, p], [0.125, P[sharpNb[v][0]]], [0.125, P[sharpNb[v][1]]]]);
    const Fa = avg(incF[v].map((f) => fp[f])), R = avg(inc[v].map((e) => avg([P[list[e].a], P[list[e].b]])));
    return lin([[1 / n, Fa], [2 / n, R], [(n - 3) / n, p]]);
  });
  const out: Poly[] = [], next = new Set<number>();
  const E = (a: number, b: number) => nV + edges.get(ekey(a, b))!.i;
  F.forEach((f, fi) => {
    const m = f.idx.length;
    for (let i = 0; i < m; i++) {
      const v = f.idx[i], nx = f.idx[(i + 1) % m], pv = f.idx[(i + m - 1) % m];
      out.push({ idx: [v, E(v, nx), nV + nE + fi, E(pv, v)], src: f.src });
    }
  });
  for (const e of list) if (isSharp(e)) { next.add(ekey(e.a, nV + e.i)); next.add(ekey(nV + e.i, e.b)); }
  return { P: [...vp, ...ep, ...fp], F: out, sharp: next };
}

function loop(P: V3[], F: Poly[], sharp: Set<number>): { P: V3[]; F: Poly[]; sharp: Set<number> } {
  const { edges, list } = topology(F), nV = P.length;
  const isSharp = (e: Topo["list"][0]) => e.faces.length !== 2 || sharp.has(ekey(e.a, e.b));
  const opp = (fi: number, a: number, b: number) => F[fi].idx.find((v) => v !== a && v !== b)!;
  const ep = list.map((e) => (isSharp(e) ? avg([P[e.a], P[e.b]])
    : lin([[0.375, P[e.a]], [0.375, P[e.b]], [0.125, P[opp(e.faces[0], e.a, e.b)]], [0.125, P[opp(e.faces[1], e.a, e.b)]]])));
  const { inc, sharpNb } = vertexInfo(nV, list, isSharp);
  const vp = P.map((p, v) => {
    const k = sharpNb[v].length, n = inc[v].length;
    if (!n || k >= 3) return p;
    if (k === 2) return lin([[0.75, p], [0.125, P[sharpNb[v][0]]], [0.125, P[sharpNb[v][1]]]]);
    const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
    return lin([[1 - n * beta, p], ...inc[v].map((e): [number, V3] => [beta, P[list[e].a === v ? list[e].b : list[e].a]])]);
  });
  const out: Poly[] = [], next = new Set<number>();
  const E = (a: number, b: number) => nV + edges.get(ekey(a, b))!.i;
  for (const f of F) {
    const [a, b, c] = f.idx, ab = E(a, b), bc = E(b, c), ca = E(c, a);
    out.push({ idx: [a, ab, ca], src: f.src }, { idx: [b, bc, ab], src: f.src }, { idx: [c, ca, bc], src: f.src }, { idx: [ab, bc, ca], src: f.src });
  }
  for (const e of list) if (isSharp(e)) { next.add(ekey(e.a, nV + e.i)); next.add(ekey(nV + e.i, e.b)); }
  return { P: [...vp, ...ep], F: out, sharp: next };
}

/** Subdivide faces `levels` times; edges with a dihedral angle above `crease` degrees stay sharp. */
export function subdivide(faces: Face[], levels: number, crease: number): Face[] {
  const byPart = new Map<string, Face[]>();
  for (const f of faces) { const k = f.part ?? ""; (byPart.get(k) ?? byPart.set(k, []).get(k)!).push(f); }
  const out: Face[] = [];
  const cosC = Math.cos((crease * Math.PI) / 180);
  for (const group of byPart.values()) {
    const index = new Map<string, number>();
    let P: V3[] = [];
    let F: Poly[] = [];
    for (const f of group) {
      const idx: number[] = [];
      for (const p of f.v) {
        const k = weldKey(p);
        let i = index.get(k);
        if (i === undefined) { i = P.length; P.push(p); index.set(k, i); }
        if (idx[idx.length - 1] !== i && idx[0] !== i) idx.push(i);
      }
      if (idx.length >= 3) F.push({ idx, src: f });
    }
    // sharp at the start: edges whose two faces meet at more than the crease angle (open / non-manifold edges are always sharp)
    const fn = F.map((f) => faceNormal(f.idx.map((i) => P[i])));
    let sharp = new Set<number>();
    for (const e of topology(F).list) if (e.faces.length === 2 && dot(fn[e.faces[0]], fn[e.faces[1]]) < cosC - 1e-9) sharp.add(ekey(e.a, e.b));
    const tri = F.every((f) => f.idx.length === 3);
    for (let l = 0; l < levels; l++) {
      if (F.length * 4 > 4_000_000) throw new KilnError("subdiv: more than 4M faces; use fewer levels or subdivide fewer items");
      ({ P, F, sharp } = tri ? loop(P, F, sharp) : catmullClark(P, F, sharp));
    }
    for (const f of F) out.push({ ...f.src, v: f.idx.map((i) => P[i]), smooth: f.src.smooth ?? crease });
  }
  return out;
}
