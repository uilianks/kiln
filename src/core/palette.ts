// Materials by key. Colors are sRGB hex; glTF wants linear, converted at export.
import { KilnError, didYouMean } from "./errors.ts";

/** A loom material used as a texture: resolved by the node layer (files, decoded albedo). */
export interface TexRef {
  /** As written in pal(): a loom output folder or its .material.json, relative to the model file. */
  src: string;
  /** Meters per texture tile (box-projected onto every face). */
  uv: number;
  /** Normal map strength. */
  bump: number;
  /** Filled in by the node layer. */
  name?: string;
  bytes?: { albedo: Uint8Array; normal: Uint8Array; orm: Uint8Array; emissive?: Uint8Array };
  albedo?: { n: number; data: Float32Array };
  emissive?: { n: number; data: Float32Array };
}

/** Box projection: a face's dominant axis picks the plane its UVs come from, in tiles. v runs down. */
export function boxUV(p: readonly number[], n: readonly number[], uv: number): [number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [(n[0] > 0 ? -p[2] : p[2]) / uv, -p[1] / uv];
  if (ay >= az) return [p[0] / uv, (n[1] > 0 ? p[2] : -p[2]) / uv];
  return [(n[2] > 0 ? p[0] : -p[0]) / uv, -p[1] / uv];
}

export interface Mat {
  /** A loom material as the surface; `color` then tints it (default white). */
  tex?: TexRef;
  color: string;
  rough: number;
  metal: number;
  /** Emissive color (glowing parts: lamps, lava, magic). */
  emit?: string;
  /** Emission strength (default 3 when `emit` is set). */
  glow?: number;
  /** Crease angle in degrees for faces of this material (0 = flat). */
  smooth?: number;
  /** Opacity 0..1 (below 1: glTF alphaMode BLEND). */
  alpha?: number;
  /** Double-sided (no back-face culling). */
  double?: boolean;
}

/** A `smooth` option: true = 50°, false = 0 (flat), or a crease angle 0..180. */
export function smoothAngle(v: unknown, what: string): number {
  if (v === true) return 50;
  if (v === false) return 0;
  if (typeof v !== "number" || !(v >= 0 && v <= 180)) throw new KilnError(`${what}: smooth is a crease angle in degrees 0..180, or true (50) / false (flat)`);
  return v;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAT_KEYS = ["color", "rough", "metal", "emit", "glow", "tex", "uv", "bump", "smooth", "alpha", "double"];
const SWEETIE = ["1a1c2c", "5d275d", "b13e53", "ef7d57", "ffcd75", "a7f070", "38b764", "257179",
  "29366f", "3b5dc9", "41a6f6", "73eff7", "f4f4f4", "94b0c2", "566c86", "333c57"];

export function normHex(c: string): string {
  if (!HEX.test(c)) throw new KilnError(`bad color '${c}': use "#rgb" or "#rrggbb"`);
  let h = c.slice(1).toLowerCase();
  if (h.length === 3) h = [...h].map((x) => x + x).join("");
  return "#" + h;
}

export function srgbToLinear(hex: string): [number, number, number] {
  const h = normHex(hex).slice(1);
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

export class Palette {
  readonly mats: ReadonlyMap<string, Mat>;

  constructor(mats: Map<string, Mat>) {
    this.mats = mats;
  }

  static default(): Palette {
    return new Palette(new Map(SWEETIE.map((c, i) => [i.toString(16), { color: "#" + c, rough: 0.8, metal: 0 }])));
  }

  /** key: "#hex" | another key | { color, rough, metal, emit, glow, tex, uv, bump, smooth, alpha, double } */
  extend(defs: Record<string, unknown>): Palette {
    const m = new Map(this.mats);
    for (const [k, v] of Object.entries(defs)) {
      if (!/^[A-Za-z0-9_]+$/.test(k)) throw new KilnError(`material key '${k}' must be letters, digits or _`);
      if (typeof v === "string") {
        if (HEX.test(v)) m.set(k, { color: normHex(v), rough: 0.8, metal: 0 });
        else m.set(k, { ...this.get(v, m) });
      } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        for (const key of Object.keys(o))
          if (!MAT_KEYS.includes(key)) throw new KilnError(`material '${k}': unknown option '${key}'${didYouMean(key, MAT_KEYS)}`);
        if (o.tex !== undefined && (typeof o.tex !== "string" || !o.tex)) throw new KilnError(`material '${k}': tex is the path of a loom material folder (or its .material.json)`);
        if (typeof o.color !== "string" && o.tex === undefined) throw new KilnError(`material '${k}' needs a color "#hex" (or a loom tex)`);
        const mat: Mat = { color: normHex(typeof o.color === "string" ? o.color : "#ffffff"), rough: Number(o.rough ?? 0.8), metal: Number(o.metal ?? 0) };
        if (o.tex !== undefined) {
          const uv = Number(o.uv ?? 1), bump = Number(o.bump ?? 1);
          if (!(uv > 0)) throw new KilnError(`material '${k}': uv is meters per texture tile, > 0`);
          mat.tex = { src: o.tex as string, uv, bump };
        }
        if (o.emit !== undefined) { mat.emit = normHex(String(o.emit)); mat.glow = Number(o.glow ?? 3); }
        if (o.smooth !== undefined) mat.smooth = smoothAngle(o.smooth, `material '${k}'`);
        if (o.alpha !== undefined) {
          const a = Number(o.alpha);
          if (!(a >= 0 && a <= 1)) throw new KilnError(`material '${k}': alpha is opacity 0..1`);
          mat.alpha = a;
        }
        if (o.double !== undefined) mat.double = !!o.double;
        m.set(k, mat);
      } else throw new KilnError(`material '${k}': use "#hex" or { color, rough, metal, emit, glow }`);
    }
    return new Palette(m);
  }

  has(k: string): boolean {
    return this.mats.has(k);
  }

  get(k: string, m: ReadonlyMap<string, Mat> = this.mats): Mat {
    const v = m.get(k);
    if (!v) {
      const keys = [...m.keys()];
      throw new KilnError(`unknown material '${k}'${didYouMean(k, keys)} (keys: ${keys.slice(0, 24).join(" ")}${keys.length > 24 ? " …" : ""})`);
    }
    return v;
  }
}
