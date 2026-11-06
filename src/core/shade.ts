// Shading data computed from the final geometry (see docs/adr/0001-welded-shading.md): corner normals
// for smooth faces (welded by position within a part, crease-angle limited) and, with `ao`, baked
// ambient occlusion per corner. Flat faces keep their face normal.
import { type AoOpts, bakeAO } from "./ao.ts";
import { type Face, faceNormal, triangulate } from "./mesh.ts";
import { type V3, cross, dot, len, norm, sub } from "./util.ts";

/** A triangle with its corner normals and, when baked, corner occlusion colour (1 = open). */
export interface ShadedTri extends Face {
  n: V3[];
  ao?: number[];
}

/** Position key used for welding: 0.01 mm grid, scoped by part. */
export const weldKey = (p: V3, part = ""): string =>
  `${part}|${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;

export const isSmooth = (f: Face): boolean => (f.smooth ?? 0) > 0;
export const needsShading = (faces: Face[], ao?: AoOpts): boolean => !!ao || faces.some(isSmooth);

function cornerAngle(p: V3, a: V3, b: V3): number {
  const u = norm(sub(a, p)), v = norm(sub(b, p));
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
}
const area = (t: Face): number => len(cross(sub(t.v[1], t.v[0]), sub(t.v[2], t.v[0]))) / 2;

/** Triangulate and give every corner its normal: smooth faces average their smooth neighbours within the
 *  crease, weighted by area × corner angle, so a bevel's narrow chamfers barely tilt the big faces next to them. */
export function shade(faces: Face[], ao?: AoOpts): ShadedTri[] {
  const tris = triangulate(faces);
  const fn = tris.map((t) => faceNormal(t.v));
  const around = new Map<string, { t: number; w: number }[]>();
  tris.forEach((t, i) => {
    if (!isSmooth(t)) return;
    for (let k = 0; k < 3; k++) {
      const key = weldKey(t.v[k], t.part);
      const w = cornerAngle(t.v[k], t.v[(k + 1) % 3], t.v[(k + 2) % 3]) * area(t);
      (around.get(key) ?? around.set(key, []).get(key)!).push({ t: i, w });
    }
  });
  const out: ShadedTri[] = tris.map((t, i) => {
    if (!isSmooth(t)) return { ...t, n: [fn[i], fn[i], fn[i]] };
    const n = t.v.map((p) => {
      let x = 0, y = 0, z = 0;
      for (const { t: j, w } of around.get(weldKey(p, t.part))!) {
        const cos = Math.cos((Math.min(t.smooth!, tris[j].smooth!) * Math.PI) / 180);
        if (j !== i && dot(fn[i], fn[j]) < cos - 1e-9) continue;
        x += fn[j][0] * w; y += fn[j][1] * w; z += fn[j][2] * w;
      }
      return x || y || z ? norm([x, y, z]) : fn[i];
    });
    return { ...t, n };
  });
  if (ao) {
    const occ = bakeAO(out, ao);
    out.forEach((t, i) => (t.ao = occ[i]));
  }
  return out;
}
