// Writes builds to disk: GLB per model, packs (one GLB with many named nodes), previews, turntables.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { KilnError, didYouMean, wrap } from "../core/errors.ts";
import { type GlbModel, glb } from "../core/gltf.ts";
import { stl } from "../core/stl.ts";
import { type Face, type Light, bounds, transform, transformLights, triCount } from "../core/mesh.ts";
import type { Built, PackDef, Project } from "../core/project.ts";
import { type V3, translate } from "../core/util.ts";
import { clipStrip, previewPng, viewPng } from "./preview.ts";

export interface OutputOptions {
  only?: string[];
  preview?: boolean;
  /** Also write a turntable GIF per model to out/_preview (needs ffmpeg). */
  turntable?: boolean;
  /** Also write a binary STL per model to out/models (3D printing, CAD). */
  stl?: boolean;
  /** Export animatable parts as a skinned skeleton (bones + skin) so engines get a Skeleton3D / armature. */
  rig?: boolean;
}

export interface OutputResult {
  lines: string[];
  errors: KilnError[];
}

function write(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function dims(b: Built): string {
  return b.bounds.max.map((v, i) => Math.round((v - b.bounds.min[i]) * 100) / 100).join("×");
}

/** Lay pack members out in rows on the ground, each its own node, spaced by its own size. */
export function packLayout(p: Project, pk: PackDef): { models: GlbModel[]; combined: Built } {
  const names = p.packNames(pk);
  if (!names.length) throw new KilnError("pack is empty (no entries matched)");
  const built = names.map((n) => p.build(n));
  const cols = pk.opts.cols ?? Math.ceil(Math.sqrt(built.length));
  const gap = pk.opts.spacing ?? 0.4;
  const size = (b: Built) => [b.bounds.max[0] - b.bounds.min[0], b.bounds.max[2] - b.bounds.min[2]];
  const rows: Built[][] = [];
  for (let i = 0; i < built.length; i += cols) rows.push(built.slice(i, i + cols));
  const depth = rows.map((r) => Math.max(...r.map((b) => size(b)[1])));
  const totalD = depth.reduce((a, d) => a + d, 0) + gap * (rows.length - 1);
  const models: GlbModel[] = [], all: Face[] = [], allLights: Light[] = [];
  let z = -totalD / 2;
  rows.forEach((row, ri) => {
    const width = row.reduce((a, b) => a + size(b)[0], 0) + gap * (row.length - 1);
    let x = -width / 2;
    for (const b of row) {
      const [w] = size(b);
      const t: V3 = [x + w / 2 - (b.bounds.min[0] + b.bounds.max[0]) / 2, 0, z + depth[ri] / 2 - (b.bounds.min[2] + b.bounds.max[2]) / 2];
      models.push({ name: b.name, faces: b.faces, pal: b.pal, lights: b.lights, translation: t, ao: b.ao });
      all.push(...transform(b.faces, translate(t)));
      allLights.push(...transformLights(b.lights, translate(t)));
      x += w + gap;
    }
    z += depth[ri] + gap;
  });
  return { models, combined: { name: pk.name, faces: all, steps: [], bounds: bounds(all), tris: triCount(all), pal: built[0].pal, lights: allLights, joints: [] } };
}

function turntable(b: Built, out: string): void {
  const dir = mkdtempSync(join(tmpdir(), "kiln-tt-"));
  try {
    for (let i = 0; i < 36; i++) writeFileSync(join(dir, `f${String(i).padStart(2, "0")}.png`), viewPng(b, { yaw: i * 10, pitch: 22, w: 360, h: 360 }));
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "18", "-i", join(dir, "f%02d.png"),
      "-vf", "split[a][b];[a]palettegen=max_colors=200[p];[b][p]paletteuse=dither=none", "-loop", "0", out]);
    if (r.error) throw new KilnError("--turntable needs ffmpeg on PATH");
    if (r.status !== 0) throw new KilnError(`ffmpeg failed: ${String(r.stderr).trim()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeOutputs(p: Project, out: string, opts: OutputOptions = {}): OutputResult {
  const lines: string[] = [], errors: KilnError[] = [];
  const packNames = new Set(p.packs.map((k) => k.name));
  if (opts.only)
    for (const n of opts.only)
      if (!p.models.has(n) && !packNames.has(n)) errors.push(new KilnError(`unknown model or pack '${n}'${didYouMean(n, [...p.order, ...packNames])}`));
  const want = opts.only ? new Set(opts.only) : undefined;

  for (const name of want ? p.order.filter((n) => want.has(n)) : p.exported()) {
    try {
      const b = p.build(name);
      const clips = p.clips.filter((c) => c.model === name);
      write(join(out, "models", name + ".glb"), glb([{ name, faces: b.faces, pal: b.pal, lights: b.lights, joints: b.joints, clips, rig: opts.rig, ao: b.ao }]));
      if (opts.stl) write(join(out, "models", name + ".stl"), stl(b.faces, name));
      if (opts.preview !== false) {
        write(join(out, "_preview", name + ".png"), previewPng(b));
        for (const c of clips) write(join(out, "_preview", `${name}.${c.name}.png`), clipStrip(b, c));
      }
      if (opts.turntable) turntable(b, join(out, "_preview", name + ".gif"));
      lines.push(`model ${name} ${dims(b)} ${b.tris} tris${b.lights.length ? ` ${b.lights.length} light${b.lights.length > 1 ? "s" : ""}` : ""}` +
        `${b.joints.length ? ` ${b.joints.length} parts` : ""}${clips.length ? ` clips: ${clips.map((c) => `${c.name} (${c.frames}f @ ${c.fps}fps)`).join(", ")}` : ""}`);
    } catch (e) {
      errors.push(wrap(e));
    }
  }
  for (const pk of p.packs) {
    if (want && !want.has(pk.name)) continue;
    try {
      const { models, combined } = packLayout(p, pk);
      write(join(out, pk.name + ".glb"), glb(models));
      if (opts.preview !== false) write(join(out, "_preview", pk.name + ".png"), viewPng(combined, { yaw: 30, pitch: 32, w: 1000, h: 640 }));
      lines.push(`pack ${pk.name} ${models.length} models, ${combined.tris} tris`);
    } catch (e) {
      errors.push(wrap(e).within(`pack '${pk.name}'`, pk.loc));
    }
  }
  return { lines, errors };
}
