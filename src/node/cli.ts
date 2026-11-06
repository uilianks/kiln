// kiln command line.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { KilnError, didYouMean, wrap } from "../core/errors.ts";
import { glb } from "../core/gltf.ts";
import { blenderRender } from "./blender.ts";
import { loadProject } from "./load.ts";
import { dims, packLayout, writeOutputs } from "./output.ts";
import { serve } from "./server.ts";

const USAGE = `kiln — low-poly and voxel 3D game assets as code

  kiln build  <models.kx.js> [--out DIR] [--only a,b] [--turntable] [--stl] [--no-preview]
      Write a GLB per model (out/models), pack GLBs (one node per model), and previews
      (out/_preview: hero/front/right/top with dimensions). --turntable adds GIFs (ffmpeg);
      --stl adds a binary STL per model (3D printing, CAD).
      --rig exports part() nodes as a skinned skeleton (bones, weights, inverse binds) for Godot / Unity / Blender.
  kiln render <models.kx.js> <model|pack> [--out FILE] [--size 1600x1200] [--yaw 35] [--pitch 22]
              [--samples 64] [--no-ground] [--transparent] [--frames N] [--mood day|night] [--fog 0.03] [--lens 70]
      Beauty render with headless Blender (EEVEE). --frames N renders a turntable MP4 (ffmpeg).
      --mood night: dark world, dim moon and haze; the model's light() items light the scene.
      --focus x,y,z aims the camera at a point (model coordinates, see kiln info); --zoom N moves it closer.
      With --frames: --yaw-to / --pitch-to / --zoom-to make an eased camera move instead of a turntable;
      --audio FILE muxes a soundtrack into the MP4. --clip NAME plays an animate() clip (looping over the frames;
      --clip-frame N for a still); --still-camera with --frames keeps the camera fixed.
      --look studio: look-dev lighting (studio HDRI, soft key, contact AO) to judge shapes and shading.
      --preset game: a fixed-angle game camera (yaw 45, pitch 35, 25° vertical fov, 25.8 m away).
  kiln info   <models.kx.js> <name>
      Dimensions, triangle count, materials and build steps.
  kiln serve  <models.kx.js> [--port 4340] [--out DIR | --no-out]
      Live viewer: drag to orbit, step through the build, rebuilds on save.
  kiln list   <models.kx.js>

Model files may be .js or .ts. Default out dir: <model file dir>/out.`;

interface Args { cmd?: string; file?: string; rest: string[]; out?: string | false; only?: string[]; preview?: boolean; turntable?: boolean; stl?: boolean; rig?: boolean;
  port?: number; size?: [number, number]; yaw?: number; pitch?: number; samples?: number; ground?: boolean; transparent?: boolean; frames?: number; mood?: "day" | "night"; fog?: number; lens?: number; zoom?: number; focus?: [number, number, number]; yawTo?: number; pitchTo?: number; zoomTo?: number; audio?: string; bloom?: number; clip?: string; still?: boolean; clipFrame?: number; look?: "studio"; preset?: "game" }

function parse(argv: string[]): Args {
  const a: Args = { rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const val = () => { const x = argv[++i]; if (x === undefined) throw new KilnError(`${v} needs a value`); return x; };
    if (v === "--out") a.out = val();
    else if (v === "--no-out") a.out = false;
    else if (v === "--only") a.only = val().split(",").map((s) => s.trim()).filter(Boolean);
    else if (v === "--no-preview") a.preview = false;
    else if (v === "--turntable") a.turntable = true;
    else if (v === "--stl") a.stl = true;
    else if (v === "--rig") a.rig = true;
    else if (v === "--port") a.port = Number(val());
    else if (v === "--size") {
      const m = /^(\d+)x(\d+)$/.exec(val());
      if (!m) throw new KilnError("--size must look like 1600x1200");
      a.size = [Number(m[1]), Number(m[2])];
    } else if (v === "--yaw") a.yaw = Number(val());
    else if (v === "--pitch") a.pitch = Number(val());
    else if (v === "--samples") a.samples = Number(val());
    else if (v === "--no-ground") a.ground = false;
    else if (v === "--transparent") a.transparent = true;
    else if (v === "--frames") a.frames = Number(val());
    else if (v === "--mood") {
      const m = val();
      if (m !== "day" && m !== "night") throw new KilnError("--mood must be day or night");
      a.mood = m;
    } else if (v === "--fog") a.fog = Number(val());
    else if (v === "--lens") a.lens = Number(val());
    else if (v === "--zoom") a.zoom = Number(val());
    else if (v === "--yaw-to") a.yawTo = Number(val());
    else if (v === "--pitch-to") a.pitchTo = Number(val());
    else if (v === "--zoom-to") a.zoomTo = Number(val());
    else if (v === "--audio") a.audio = resolve(val());
    else if (v === "--bloom") a.bloom = Number(val());
    else if (v === "--clip") a.clip = val();
    else if (v === "--clip-frame") a.clipFrame = Number(val());
    else if (v === "--still-camera") a.still = true;
    else if (v === "--look") {
      const l = val();
      if (l !== "studio") throw new KilnError("--look must be studio");
      a.look = l;
    } else if (v === "--preset") {
      const p = val();
      if (p !== "game") throw new KilnError("--preset must be game");
      a.preset = p;
    }
    else if (v === "--focus") {
      const f = val().split(",").map(Number);
      if (f.length !== 3 || f.some((x) => !Number.isFinite(x))) throw new KilnError("--focus must be x,y,z (model coordinates)");
      a.focus = f as [number, number, number];
    }
    else if (v === "-h" || v === "--help") a.cmd = "help";
    else if (v.startsWith("--")) throw new KilnError(`unknown flag ${v}\n\n${USAGE}`);
    else if (!a.cmd) a.cmd = v;
    else if (!a.file) a.file = v;
    else a.rest.push(v);
  }
  return a;
}

export async function main(argv: string[]): Promise<number> {
  let a: Args;
  try { a = parse(argv); } catch (e) { console.error(wrap(e).message); return 2; }
  if (!a.cmd || a.cmd === "help" || !a.file) { console.log(USAGE); return a.cmd === "help" ? 0 : 2; }
  const file = resolve(a.file);
  const outDir = typeof a.out === "string" ? resolve(a.out) : join(dirname(file), "out");
  try {
    switch (a.cmd) {
      case "build": {
        const r = writeOutputs(loadProject(file), outDir, { only: a.only, preview: a.preview, turntable: a.turntable, stl: a.stl, rig: a.rig });
        for (const l of r.lines) console.log(l);
        for (const e of r.errors) console.error("error: " + e.message);
        console.log(`-> ${outDir}${r.errors.length ? ` (${r.errors.length} error${r.errors.length > 1 ? "s" : ""})` : ""}`);
        return r.errors.length ? 1 : 0;
      }
      case "render": {
        const name = a.rest[0];
        if (!name) throw new KilnError("render needs a model or pack name");
        const p = loadProject(file);
        const pk = p.packs.find((k) => k.name === name);
        const clip = a.clip ? p.clips.find((c) => c.model === name && c.name === a.clip) : undefined;
        if (a.clip && !clip) throw new KilnError(`model '${name}' has no clip '${a.clip}'${didYouMean(a.clip, p.clips.filter((c) => c.model === name).map((c) => c.name))}`);
        const bytes = pk ? glb(packLayout(p, pk).models) : (() => { const b = p.build(name); return glb([{ name, faces: b.faces, pal: b.pal, lights: b.lights, joints: b.joints, clips: clip ? [clip] : [], ao: b.ao }]); })();
        const turn = (a.frames ?? 1) > 1;
        const out = typeof a.out === "string" ? resolve(a.out) : join(dirname(file), "out", "renders", name + (turn ? ".mp4" : ".png"));
        mkdirSync(dirname(out), { recursive: true });
        const ro = { w: a.size?.[0], h: a.size?.[1], yaw: a.yaw, pitch: a.pitch, samples: a.samples, ground: a.ground, transparent: a.transparent, mood: a.mood, fog: a.fog, lens: a.lens, zoom: a.zoom, focus: a.focus, bloom: a.bloom, spin: !a.still, look: a.look, preset: a.preset,
          clip: clip ? { name: clip.name, fps: clip.fps, frames: clip.frames, frame: a.clipFrame ?? 0 } : undefined,
          move: a.yawTo !== undefined || a.pitchTo !== undefined || a.zoomTo !== undefined
            ? { yaw: a.yawTo ?? a.yaw ?? 35, pitch: a.pitchTo ?? a.pitch ?? 22, zoom: a.zoomTo ?? a.zoom ?? 1 } : undefined };
        if (!turn) blenderRender(bytes, out, ro);
        else {
          // Turntable: frames in one Blender session, then an MP4 (needs ffmpeg).
          const dir = mkdtempSync(join(dirname(out), ".frames-"));
          try {
            blenderRender(bytes, join(dir, "f%04d.png"), { ...ro, frames: a.frames });
            const audio = a.audio ? ["-i", a.audio, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest"] : [];
            const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(clip?.fps ?? 30), "-i", join(dir, "f%04d.png"), ...audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out]);
            if (r.error) throw new KilnError("--frames writes an MP4 and needs ffmpeg on PATH");
            if (r.status !== 0) throw new KilnError(`ffmpeg failed: ${String(r.stderr).trim()}`);
          } finally { rmSync(dir, { recursive: true, force: true }); }
        }
        console.log(`render ${name} -> ${out}`);
        return 0;
      }
      case "info": {
        const name = a.rest[0];
        if (!name) throw new KilnError("info needs a model name");
        const b = loadProject(file).build(name);
        const counts = new Map<string, number>();
        for (const f of b.faces) counts.set(f.mat, (counts.get(f.mat) ?? 0) + f.v.length - 2);
        console.log(`model ${name}: ${dims(b)} (w×h×d)  ${b.tris} tris  bounds min [${b.bounds.min.map((v) => v.toFixed(2))}] max [${b.bounds.max.map((v) => v.toFixed(2))}]`);
        console.log("materials: " + [...counts].map(([k, n]) => `${k} ${n}`).join(" · "));
        console.log("steps: " + b.steps.map((s, i) => `${i} ${s.label}`).join(" · "));
        return 0;
      }
      case "list": {
        const p = loadProject(file);
        for (const n of p.order) console.log(`${"model".padEnd(6)} ${n.padEnd(24)} ${p.models.get(n)!.loc ?? ""}`);
        for (const g of p.groups.values()) console.log(`${"group".padEnd(6)} ${g.name.padEnd(24)} ${g.loc ?? ""}  [${g.members.join(" ")}]`);
        for (const k of p.packs) console.log(`${"pack".padEnd(6)} ${k.name.padEnd(24)} ${k.loc ?? ""}`);
        return 0;
      }
      case "serve": {
        const s = await serve(file, { port: a.port, out: a.out === false ? false : outDir });
        console.log(`kiln live viewer: ${s.url}  (watching ${file}; Ctrl+C to stop)`);
        return await new Promise<number>(() => {});
      }
      default:
        console.error(`unknown command '${a.cmd}'\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    console.error("error: " + wrap(e).message);
    return 1;
  }
}
