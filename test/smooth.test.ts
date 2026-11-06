// The smooth stylised look: smooth (crease-angle normals), subdiv, baked AO, alpha / double materials,
// and the guarantee that files which use none of it build exactly as before.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { glb } from "../src/core/gltf.ts";
import { type Face, triangulate } from "../src/core/mesh.ts";
import { shade } from "../src/core/shade.ts";
import { cross, dot } from "../src/core/util.ts";
import { loadProject, loadSource } from "../src/node/load.ts";
import { writeOutputs } from "../src/node/output.ts";

const here = dirname(fileURLToPath(import.meta.url));
const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message));
const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const volume = (faces: Face[]) => triangulate(faces).reduce((s, t) => s + dot(t.v[0], cross(t.v[1], t.v[2])) / 6, 0);
const PAL = `pal({ a: "#ff0000", b: "#00ff00", soft: { color: "#0000ff", smooth: 30 }, glass: { color: "#ffffff", alpha: 0.4, double: true } })\n`;
const one = (src: string) => loadSource(PAL + src).build("m");

/** Parse a GLB into its JSON and a reader for float / index accessors. */
function readGlb(bytes: Uint8Array) {
  const buf = Buffer.from(bytes), jl = buf.readUInt32LE(12), json = JSON.parse(buf.toString("utf8", 20, 20 + jl)), bin = buf.subarray(20 + jl + 8);
  const read = (i: number): number[] => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const raw = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength), ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return Array.from(a.componentType === 5126 ? new Float32Array(ab, 0, n) : a.componentType === 5125 ? new Uint32Array(ab, 0, n) : new Uint16Array(ab, 0, n));
  };
  return { json, read };
}
const modelGlb = (src: string) => { const b = loadSource(PAL + src).build("m"); return readGlb(glb([{ name: "m", faces: b.faces, pal: b.pal, lights: b.lights, joints: b.joints, ao: b.ao }])); };

test("smooth: precedence is shape, then material, then model; true = 50, false = flat", () => {
  const f = one(`model("m", { smooth: 20 }, box(1, 1, 1, "a"), box(1, 1, 1, { mat: "a", smooth: false, pos: [2, 0, 0] }),
    box(1, 1, 1, { mat: "soft", pos: [4, 0, 0] }), box(1, 1, 1, { mat: "soft", smooth: true, pos: [6, 0, 0] }))`).faces;
  assert.deepEqual([f[0].smooth, f[6].smooth, f[12].smooth, f[18].smooth], [20, 0, 30, 50]);
  assert.equal(one(`model("m", box(1, 1, 1, "a"))`).faces[0].smooth, undefined, "no option, no field");
  throwsMsg(() => one(`model("m", box(1, 1, 1, { mat: "a", smooth: 200 }))`), /smooth is a crease angle/);
  throwsMsg(() => one(`model("m", { smooth: "yes" }, box(1, 1, 1, "a"))`), /smooth is a crease angle/);
});

test("smooth normals: a sphere's corner normals point away from its center; a box keeps its 90° corners sharp", () => {
  const sph = shade(one(`model("m", { pivot: "center" }, sphere(1, { mat: "a", detail: 2, smooth: 40 }))`).faces);
  for (const t of sph) t.v.forEach((p, k) => near(dot(t.n[k], p), 1, 1e-3));   // angle-weighted average of face normals: radial within 0.1%
  const bx = shade(one(`model("m", box(1, 1, 1, { mat: "a", smooth: 80 }))`).faces);
  for (const t of bx) for (const n of t.n) near(Math.max(...n.map(Math.abs)), 1, 1e-12);
  // with a crease above 90° the box corners average three faces
  const soft = shade(one(`model("m", box(1, 1, 1, { mat: "a", smooth: 100 }))`).faces);
  near(Math.abs(soft[0].n[0][0]), 1 / Math.sqrt(3), 1e-9);
});

test("GLB: smooth primitives are welded and indexed with shared normals; flat ones are not", () => {
  const { json, read } = modelGlb(`model("m", sphere(1, { mat: "a", detail: 2, smooth: 40 }), box(1, 1, 1, { mat: "b", pos: [3, 0, 0] }))`);
  const [s, f] = json.meshes[0].primitives;
  assert.equal(json.accessors[s.attributes.POSITION].count, 162, "a detail-2 icosphere has 162 vertices");
  assert.equal(json.accessors[s.indices].count, 320 * 3);
  assert.equal(json.accessors[s.indices].componentType, 5123);
  assert.equal(json.bufferViews[json.accessors[s.indices].bufferView].target, 34963);
  assert.equal(f.indices, undefined);
  assert.equal(json.accessors[f.attributes.POSITION].count, 36);
  const n = read(s.attributes.NORMAL);
  for (let i = 0; i < n.length; i += 3) near(Math.hypot(n[i], n[i + 1], n[i + 2]), 1, 1e-5);
  const idx = read(s.indices);
  assert.ok(Math.max(...idx) < 162);
});

test("subdiv: an unbevelled box stays the box; a bevel rounds; Loop on triangles; levels multiply faces", () => {
  const box = one(`model("m", subdiv(2, box(1, 1, 1, "a")))`);
  near(volume(box.faces), 1, 1e-9);
  assert.equal(box.faces.length, 6 * 16);
  assert.ok(box.faces.every((f) => f.smooth === 60), "marked smooth at the crease");
  const chamfer = one(`model("m", box(1, 1, 1, { mat: "a", bevel: 0.2 }))`), round = one(`model("m", subdiv(2, box(1, 1, 1, { mat: "a", bevel: 0.2 })))`);
  const vc = volume(chamfer.faces), vr = volume(round.faces);
  assert.ok(vr > 0.6 && vr < vc, `rounded box ${vr} sits inside the chamfered cage ${vc}`);
  const sph = one(`model("m", subdiv(1, sphere(1, { mat: "a", detail: 1 })))`);
  assert.equal(sph.tris, 80 * 4, "Loop: 4 triangles per triangle");
  assert.ok(sph.faces.every((f) => f.v.length === 3));
  assert.ok(volume(sph.faces) > 3 && volume(sph.faces) < (4 / 3) * Math.PI);
  // the crease option: at 30 the 45° chamfers stay sharp too, so the bevelled box keeps its shape
  near(volume(one(`model("m", subdiv({ levels: 1, crease: 30 }, box(1, 1, 1, { mat: "a", bevel: 0.2 })))`).faces), vc, 1e-9);
  // parts subdivide on their own and keep their part
  const parts = loadSource(PAL + `model("m", subdiv(1, part("p", { pivot: [0, 0, 0] }, box(1, 1, 1, "a")), box(1, 1, 1, { mat: "b", pos: [2, 0, 0] })))`).build("m");
  assert.equal(parts.faces.filter((f) => f.part === "p").length, 24);
  throwsMsg(() => one(`model("m", subdiv(5, box(1, 1, 1, "a")))`), /levels must be a whole number 1\.\.4/);
  throwsMsg(() => one(`model("m", subdiv({ levels: 1, sharp: 3 }, box(1, 1, 1, "a")))`), /unknown option 'sharp'/);
});

test("sphere detail goes to 6", () => {
  assert.equal(one(`model("m", sphere(1, { mat: "a", detail: 6 }))`).tris, 20 * 4 ** 6);
  throwsMsg(() => one(`model("m", sphere(1, { mat: "a", detail: 7 }))`), /detail must be 0\.\.6/);
});

test("ao: COLOR_0 per vertex, darker in a corner than in the open, white with nothing around", () => {
  // AO lives on vertices: the slab's top corners at x = -1 stand right against the wall
  const { json, read } = modelGlb(`model("m", { ao: true }, box(2, 0.1, 2, "a"), box(0.2, 1.2, 2, { mat: "b", pos: [-1.1, 0, 0] }))`);
  const prim = json.meshes[0].primitives[0];
  const pos = read(prim.attributes.POSITION), col = read(prim.attributes.COLOR_0);
  assert.equal(json.accessors[prim.attributes.COLOR_0].type, "VEC3");
  let corner = 1, open = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    assert.ok(col[i * 3] >= 0 && col[i * 3] <= 1);
    if (Math.abs(pos[i * 3 + 1] - 0.1) > 1e-6) continue;                                  // top of the floor slab
    if (pos[i * 3] < -0.85) corner = Math.min(corner, col[i * 3]); else open = Math.max(open, col[i * 3]);
  }
  assert.ok(corner < open - 0.1, `corner ${corner} vs open ${open}`);
  const lone = modelGlb(`model("m", { ao: { strength: 1, rays: 16 } }, sphere(1, { mat: "a", detail: 1 }))`);
  assert.ok(read.length >= 0 && lone.read(lone.json.meshes[0].primitives[0].attributes.COLOR_0).every((c) => c === 1));
  throwsMsg(() => one(`model("m", { ao: { strenght: 1 } }, box(1, 1, 1, "a"))`), /unknown option 'strenght'/);
});

test("materials: alpha exports BLEND with the alpha in baseColorFactor; double exports doubleSided", () => {
  const { json } = modelGlb(`model("m", box(1, 1, 1, "glass"), box(1, 1, 1, { mat: "a", pos: [2, 0, 0] }))`);
  const g = json.materials.find((m: { name: string }) => m.name === "glass"), a = json.materials.find((m: { name: string }) => m.name === "a");
  assert.equal(g.alphaMode, "BLEND");
  assert.equal(g.pbrMetallicRoughness.baseColorFactor[3], 0.4);
  assert.equal(g.doubleSided, true);
  assert.equal(a.alphaMode, undefined);
  assert.equal(a.doubleSided, undefined);
  throwsMsg(() => loadSource(`pal({ g: { color: "#fff", alpha: 2 } })`), /alpha is opacity 0\.\.1/);
});

test("rig + smooth + ao: indexed primitive with joints and weights per welded vertex", () => {
  const b = loadSource(PAL + `model("m", { smooth: 50, ao: true }, sphere(1, { mat: "a", detail: 1 }), part("p", { pivot: [0, 2, 0] }, sphere(0.5, { mat: "a", detail: 1, pos: [0, 2, 0] })))`).build("m");
  const { json, read } = readGlb(glb([{ name: "m", faces: b.faces, pal: b.pal, joints: b.joints, rig: true, ao: b.ao }]));
  const prim = json.meshes[0].primitives[0], n = json.accessors[prim.attributes.POSITION].count;
  assert.equal(n, 42 * 2, "two welded detail-1 icospheres");
  assert.equal(json.accessors[prim.attributes.JOINTS_0].count, n);
  assert.equal(json.accessors[prim.attributes.WEIGHTS_0].count, n);
  assert.equal(json.accessors[prim.attributes.COLOR_0].count, n);
  assert.equal(read(prim.indices).length, 160 * 3);
});

test("every example builds (GLBs, no errors)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiln-ex-"));
  try {
    for (const f of readdirSync(join(here, "../examples")).filter((n) => n.endsWith(".kx.js"))) {
      const r = writeOutputs(loadProject(join(here, "../examples", f)), join(dir, f), { preview: false });
      assert.deepEqual(r.errors.map((e) => e.message), [], f);
      assert.ok(r.lines.length > 0, f);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ao: a part resting exactly on a surface gets its contact shadow (same as a hair's gap)", () => {
  const rim = (gap: number) => {
    const b = loadSource(PAL + `model("m", { pivot: "origin", ao: { strength: 1 } }, box(4, 0.2, 4, "b"), box(1, 1, 1, { mat: "a", pos: [0, ${0.2 + gap}, 0] }))`).build("m");
    let lo = 1;
    for (const t of shade(b.faces, b.ao)) if (t.mat === "a") t.v.forEach((p, k) => { if (Math.abs(p[1] - 0.2 - gap) < 1e-9 && Math.abs(t.n[k][1]) < 1e-9) lo = Math.min(lo, t.ao![k]); });
    return lo;
  };
  const touching = rim(0), gap = rim(1e-4);
  assert.ok(touching < 0.6, `touching ${touching}`);
  near(touching, gap, 0.03);
});

test("smooth bevel: the big faces stay nearly flat (area-weighted normals)", () => {
  const b = one(`model("m", box(1, 1, 1, { mat: "a", bevel: 0.08, smooth: 50 }))`);
  for (const t of shade(b.faces)) if (t.v.every((p) => Math.abs(p[1] - 1) < 1e-9)) for (const n of t.n) assert.ok(Math.acos(n[1]) < (10 * Math.PI) / 180, `tilt ${(Math.acos(n[1]) * 180) / Math.PI}°`);
});

test("variants keep their base's smooth faces and ao unless they set their own", () => {
  const p = loadSource(PAL + `model("a", { smooth: 30, ao: true }, box(1, 1, 1, "a"))\nmodel("v", { base: "a", swap: { a: "b" } })\nmodel("w", { base: "a", ao: false })`);
  assert.deepEqual(p.build("v").ao, {});
  assert.equal(p.build("v").faces[0].smooth, 30);
  assert.equal(p.build("w").ao, undefined);
});

// Byte-for-byte guarantee: the flat examples and the showcase build exactly the GLBs listed in
// test/golden-glb.json (recorded with kiln 4fd70c6, before smooth / subdiv / ao existed), plain and --rig.
// After an intended change to the flat writer: KILN_UPDATE_GOLDEN=1 npm test, and say why in the commit.
test("files that use none of the new options build byte-identical GLBs (golden hashes)", () => {
  const golden = join(here, "golden-glb.json"), dir = mkdtempSync(join(tmpdir(), "kiln-golden-"));
  const files = ["examples/basics.kx.js", "examples/animated.kx.js", ...readdirSync(join(here, "../showcase")).filter((n) => n.endsWith(".kx.js") && n !== "dragon_hoard.kx.js").map((n) => `showcase/${n}`)];   // dragon_hoard needs the loom repo's textures
  const got: Record<string, string> = {};
  try {
    for (const f of files)
      for (const rig of [false, true]) {
        const out = join(dir, f, String(rig));
        const r = writeOutputs(loadProject(join(here, "..", f)), out, { preview: false, rig });
        assert.deepEqual(r.errors.map((e) => e.message), [], f);
        for (const sub of ["models", "."])
          for (const n of readdirSync(join(out, sub)).filter((x) => x.endsWith(".glb")).sort())
            got[`${f}${rig ? " --rig" : ""} ${sub === "." ? "" : "models/"}${n}`] = createHash("sha256").update(readFileSync(join(out, sub, n))).digest("hex");
      }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (process.env.KILN_UPDATE_GOLDEN) writeFileSync(golden, JSON.stringify(got, null, 1) + "\n");
  assert.deepEqual(got, JSON.parse(readFileSync(golden, "utf8")));
});
