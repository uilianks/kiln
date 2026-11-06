// Agent-facing preview: hero / front / right / top views with dimensions and grid scale.
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";
import { len, sub } from "../core/util.ts";
import { png } from "../core/png.ts";
import type { Built } from "../core/project.ts";
import { type ClipDef, poseFaces } from "../core/anim.ts";
import { gridStep, renderView, type ViewOpts } from "../core/render.ts";

export function viewPng(b: Built, o: ViewOpts): Buffer {
  const w = o.w ?? 400, h = o.h ?? 400;
  return Buffer.from(png(w, h, renderView(b.faces, b.pal, b.bounds, { lights: b.lights, ao: b.ao, ...o }), (x) => deflateSync(x)));
}

/** A clip as a strip of 8 evenly spaced frames from the hero angle, framed on the rest pose. */
export function clipStrip(b: Built, c: ClipDef, o: ViewOpts = {}): Buffer {
  const n = 8, cell = 240, W = cell * n, H = cell + 26;
  let body = "";
  for (let k = 0; k < n; k++) {
    const i = Math.round((k * c.frames) / n);
    const posed = poseFaces(b.faces, b.lights, b.joints, c.tracks, i);
    // posed frames: smooth normals follow the pose; AO is left out (it is a rest-pose bake)
    const uri = "data:image/png;base64," + viewPng({ ...b, ...posed, ao: undefined }, { yaw: 35, pitch: 20, ...o, w: cell, h: cell, fit: b.bounds }).toString("base64");
    body += `<image x="${k * cell}" y="26" width="${cell}" height="${cell}" href="${uri}"/>` +
      `<text x="${k * cell + 6}" y="44" fill="#c9c3dd" font-size="11" font-family="monospace">f${i}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14131b"/>` +
    `<text x="6" y="18" fill="#e9e5f2" font-size="13" font-weight="bold" font-family="monospace">${b.name} · ${c.name} · ${c.frames} frames @ ${c.fps} fps</text>${body}</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
}

const VIEWS: [string, ViewOpts][] = [["hero", { yaw: 35, pitch: 25 }], ["front", { yaw: 0, pitch: 6 }], ["right", { yaw: 90, pitch: 6 }], ["top", { yaw: 0, pitch: 89.5 }]];

export function previewPng(b: Built): Buffer {
  const cell = 360, gap = 8, top = 34, foot = 30;
  const W = cell * 2 + gap * 3, H = top + cell * 2 + gap * 3 + foot;
  const [sx, sy, sz] = sub(b.bounds.max, b.bounds.min).map((v) => Math.round(v * 100) / 100);
  const step = gridStep(Math.max(0.01, len(sub(b.bounds.max, b.bounds.min)) / 2));
  const mats = [...new Set(b.faces.map((f) => f.mat))];
  let body = "";
  VIEWS.forEach(([label, o], i) => {
    const x = gap + (i % 2) * (cell + gap), y = top + gap + Math.floor(i / 2) * (cell + gap);
    const uri = "data:image/png;base64," + viewPng(b, { ...o, w: cell, h: cell }).toString("base64");
    body += `<image x="${x}" y="${y}" width="${cell}" height="${cell}" href="${uri}"/>` +
      `<text x="${x + 8}" y="${y + 18}" fill="#c9c3dd" font-size="12" font-family="monospace">${label}</text>`;
  });
  let sw = "";
  mats.slice(0, 14).forEach((m, i) => {
    const c = b.pal.get(m);
    sw += `<rect x="${gap + i * 52}" y="${H - foot + 8}" width="12" height="12" rx="2" fill="${c.color}" stroke="#000"/>` +
      `<text x="${gap + i * 52 + 16}" y="${H - foot + 18}" fill="#9a93ab" font-size="10" font-family="monospace">${m.slice(0, 5)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#14131b"/>` +
    `<text x="${gap}" y="22" fill="#e9e5f2" font-size="14" font-weight="bold" font-family="monospace">${b.name}</text>` +
    `<text x="${W - gap}" y="22" fill="#b9b3c9" font-size="12" font-family="monospace" text-anchor="end">${sx} × ${sy} × ${sz} (w×h×d)  ${b.tris} tris  grid ${step}</text>` +
    body + sw + `</svg>`;
  return Buffer.from(new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
}
