// Live viewer server: watch model files, rebuild, push updates over SSE, render views on request.
import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type KilnError, wrap } from "../core/errors.ts";
import { glb } from "../core/gltf.ts";
import { bounds } from "../core/mesh.ts";
import type { Project } from "../core/project.ts";
import { loadProject } from "./load.ts";
import { dims, writeOutputs } from "./output.ts";
import { viewPng } from "./preview.ts";
import { FeedbackError, writeFeedback } from "./feedback.ts";

export interface ServeOptions { port?: number; out?: string | false; log?: (line: string) => void }

interface ErrInfo { message: string; loc?: string }
interface ModelInfo { name: string; part: boolean; dims?: string; tris?: number; steps?: { label: string; loc?: string }[]; changed: boolean; error?: ErrInfo }
interface State { version: number; file: string; time: string; ms: number; error?: ErrInfo; models: ModelInfo[]; errors: ErrInfo[] }

const viewerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "viewer");
const errInfo = (e: KilnError): ErrInfo => ({ message: e.message, loc: e.loc });

export function serve(file: string, opts: ServeOptions = {}): Promise<{ url: string; close: () => void }> {
  const abs = resolve(file);
  const out = opts.out === false ? undefined : opts.out ?? join(dirname(abs), "out");
  const log = opts.log ?? ((l: string) => console.log(l));
  const clients = new Set<ServerResponse>();
  let project: Project | undefined;
  let state: State = { version: 0, file: basename(abs), time: "", ms: 0, models: [], errors: [] };
  const last = new Map<string, string>();
  let watched = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  const rebuild = () => {
    const t0 = performance.now();
    const next: State = { version: state.version + 1, file: basename(abs), time: new Date().toLocaleTimeString(), ms: 0, models: [], errors: [] };
    try { project = loadProject(abs); } catch (e) { project = undefined; next.error = errInfo(wrap(e)); }
    if (project) {
      for (const name of project.order) {
        const info: ModelInfo = { name, part: name.startsWith("_"), changed: false };
        try {
          const b = project.build(name);
          const fp = `${b.tris}:${b.bounds.min}:${b.bounds.max}:${b.faces.map((f) => f.mat).join("").length}:${JSON.stringify(b.faces[b.faces.length - 1]?.v ?? [])}`;
          Object.assign(info, { dims: dims(b), tris: b.tris, steps: b.steps.map((s) => ({ label: s.label, loc: s.loc })), changed: last.get(name) !== fp });
          last.set(name, fp);
        } catch (e) {
          info.error = errInfo(wrap(e));
          info.changed = true;
          last.delete(name);
        }
        next.models.push(info);
      }
      if (out) {
        const r = writeOutputs(project, out, { preview: false });
        next.errors = r.errors.filter((e) => !next.models.some((m) => m.error?.message === e.message)).map(errInfo);
      }
      watch(project.files);
    } else watch([abs]);
    next.ms = Math.round(performance.now() - t0);
    state = next;
    const bad = next.error ? 1 : next.models.filter((m) => m.error).length + next.errors.length;
    log(`[kiln] v${next.version} ${next.ms}ms: ${next.models.length} models, ${bad} error(s)` + (next.error ? `\n  ${next.error.message}` : ""));
    const msg = `event: build\ndata: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 80); };
  function watch(files: string[]) {
    const nextSet = new Set(files);
    for (const f of watched) if (!nextSet.has(f)) unwatchFile(f);
    for (const f of nextSet) if (!watched.has(f)) watchFile(f, { interval: 150 }, (a, b) => { if (a.mtimeMs !== b.mtimeMs) schedule(); });
    watched = nextSet;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const q = url.searchParams, name = q.get("name") ?? "";
    try {
      if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(readFileSync(join(viewerDir, "index.html"))); }
      else if (url.pathname === "/app.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" }); res.end(readFileSync(join(viewerDir, "app.js"))); }
      else if (url.pathname === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: build\ndata: ${JSON.stringify(state)}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
      } else if (url.pathname === "/api/view" && project) {
        const b = project.build(name);
        const step = q.has("step") ? Number(q.get("step")) : b.steps.length - 1;
        const faces = step >= b.steps.length - 1 ? b.faces : b.faces.slice(0, b.steps[step]?.end ?? b.faces.length);
        const w = Math.min(1200, Number(q.get("w") ?? 640)), h = Math.min(1200, Number(q.get("h") ?? 640));
        const png = viewPng({ ...b, faces, bounds: faces.length ? bounds(faces) : b.bounds }, { yaw: Number(q.get("yaw") ?? 35), pitch: Number(q.get("pitch") ?? 25), w, h, fit: b.bounds });
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        res.end(png);
      } else if (url.pathname === "/api/feedback" && req.method === "POST") {
        // Pins and strokes from the viewer's annotate mode, picked on the model, written to <out>/_feedback/.
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (d: Buffer) => { size += d.length; if (size > 32 << 20) req.destroy(); else chunks.push(d); });
        req.on("end", () => {
          const reply = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
          if (!project) return reply(409, { error: "the model file does not build right now" });
          try {
            const r = writeFeedback(project, out ?? join(dirname(abs), "out"), JSON.parse(Buffer.concat(chunks).toString("utf8")));
            log(`[kiln] feedback: ${r.summary} -> ${r.files.find((f) => f.endsWith(".json"))}`);
            reply(200, { ok: true, ...r });
          } catch (e) {
            reply(e instanceof FeedbackError || e instanceof SyntaxError ? 400 : 500, { error: (e as Error).message });
          }
        });
        return;
      } else if (url.pathname === "/api/glb" && project) {
        const b = project.build(name);
        res.writeHead(200, { "content-type": "model/gltf-binary", "content-disposition": `attachment; filename="${name}.glb"` });
        res.end(Buffer.from(glb([{ name, faces: b.faces, pal: b.pal, lights: b.lights, ao: b.ao }])));
      } else { res.writeHead(404); res.end("not found"); }
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const ping = setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 15000);

  return new Promise((ok, fail) => {
    server.on("error", fail);
    server.listen(opts.port ?? 4340, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      rebuild();
      ok({ url: `http://127.0.0.1:${port}/`, close: () => { clearInterval(ping); clearTimeout(timer); for (const f of watched) unwatchFile(f); for (const c of clients) c.end(); server.close(); } });
    });
  });
}
