// glTF 2.0 binary (GLB) writer: one node per model, one primitive per material, flat normals.
import { type ClipDef, partValues } from "./anim.ts";
import { type Face, type Joint, type Light, faceNormal, triangulate } from "./mesh.ts";
import { type Palette, boxUV, srgbToLinear } from "./palette.ts";
import type { V3 } from "./util.ts";

export interface GlbModel {
  name: string;
  faces: Face[];
  pal: Palette;
  lights?: Light[];
  translation?: V3;
  /** Animatable parts: each becomes a node rotating about its pivot. */
  joints?: Joint[];
  clips?: ClipDef[];
  /** Export the parts as a skinned skeleton (bones + weights) instead of one mesh node per part. */
  rig?: boolean;
}

/** Quaternion [x, y, z, w] for kiln's rotation order (X, then Y, then Z), degrees. */
function quatXYZ(r: V3): number[] {
  const [hx, hy, hz] = r.map((d) => (d * Math.PI) / 360);
  const qx = [Math.sin(hx), 0, 0, Math.cos(hx)], qy = [0, Math.sin(hy), 0, Math.cos(hy)], qz = [0, 0, Math.sin(hz), Math.cos(hz)];
  const m = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  return m(qz, m(qy, qx));
}

/** Shortest rotation taking -Z (a glTF light's direction) to `d`, as [x, y, z, w]. */
function quatToDir(d: V3): number[] {
  const a: V3 = [0, 0, -1], c = a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  if (c < -0.999999) return [0, 1, 0, 0];
  const x = a[1] * d[2] - a[2] * d[1], y = a[2] * d[0] - a[0] * d[2], z = a[0] * d[1] - a[1] * d[0], w = 1 + c;
  const l = Math.hypot(x, y, z, w);
  return [x / l, y / l, z / l, w / l];
}

export function glb(models: GlbModel[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  /** Raw bytes into the binary chunk (4-byte aligned); returns the bufferView. */
  const blob = (bytes: Uint8Array, target?: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    return bufferViews.length - 1;
  };
  const push = (data: Float32Array, kind: "VEC2" | "VEC3" | "VEC4" | "MAT4" | "SCALAR", min?: number[], max?: number[], vertex = true): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(vertex ? { target: 34962 } : {}) });
    chunks.push(bytes);
    byteLength += bytes.length;
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / SIZE[kind], type: kind, ...(min ? { min, max } : {}) });
    return accessors.length - 1;
  };

  // Materials are shared by key across models (first definition wins).
  const matIndex = new Map<string, number>(), materials: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [], textures: Record<string, unknown>[] = [], texOf = new Map<Uint8Array, number>();
  /** An embedded PNG as a texture (repeat-wrapped, mipmapped), shared when the same bytes repeat. */
  const texture = (bytes: Uint8Array): number => {
    const hit = texOf.get(bytes);
    if (hit !== undefined) return hit;
    images.push({ bufferView: blob(bytes), mimeType: "image/png" });
    textures.push({ source: images.length - 1, sampler: 0 });
    texOf.set(bytes, textures.length - 1);
    return textures.length - 1;
  };
  let emissiveStrength = false;
  const material = (key: string, pal: Palette): number => {
    let i = matIndex.get(key);
    if (i !== undefined) return i;
    const m = pal.get(key);
    const mat: Record<string, unknown> = {
      name: key,
      pbrMetallicRoughness: { baseColorFactor: [...srgbToLinear(m.color), 1], metallicFactor: m.metal, roughnessFactor: m.rough },
    };
    if (m.tex?.bytes) {
      // loom maps: albedo (tinted by color), ORM = occlusion R + roughness G + metalness B, GL normal
      const t = m.tex.bytes, orm = texture(t.orm);
      mat.pbrMetallicRoughness = { baseColorFactor: [...srgbToLinear(m.color), 1], baseColorTexture: { index: texture(t.albedo) }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: orm } };
      mat.occlusionTexture = { index: orm };
      mat.normalTexture = { index: texture(t.normal), scale: m.tex.bump };
      if (t.emissive) {
        mat.emissiveTexture = { index: texture(t.emissive) };
        mat.emissiveFactor = [1, 1, 1];
        if ((m.glow ?? 1) > 1) { mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.glow } }; emissiveStrength = true; }
      }
    }
    if (m.emit) {
      mat.emissiveFactor = srgbToLinear(m.emit);
      if ((m.glow ?? 1) > 1) { mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: m.glow } }; emissiveStrength = true; }
    }
    materials.push(mat);
    i = materials.length - 1;
    matIndex.set(key, i);
    return i;
  };

  const meshes: Record<string, unknown>[] = [], nodes: Record<string, unknown>[] = [], roots: number[] = [];
  const lights: Record<string, unknown>[] = [], animations: Record<string, unknown>[] = [], skins: Record<string, unknown>[] = [];

  /** One mesh from faces, positions relative to `origin`; undefined when there are no faces. */
  const mesh = (name: string, faces: Face[], pal: Palette, origin: V3, boneOf?: (f: Face) => number): number | undefined => {
    const byMat = new Map<string, Face[]>();
    for (const f of triangulate(faces)) {
      const l = byMat.get(f.mat) ?? [];
      l.push(f);
      byMat.set(f.mat, l);
    }
    if (!byMat.size) return undefined;
    const primitives: Record<string, unknown>[] = [];
    for (const [key, tris] of byMat) {
      const tex = pal.get(key).tex;
      const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9), uv = tex ? new Float32Array(tris.length * 6) : undefined;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      const jb = boneOf ? new Uint8Array(tris.length * 12) : undefined;
      tris.forEach((t, i) => {
        if (jb && boneOf) jb.fill(0, i * 12, i * 12 + 12), [0, 1, 2].forEach((k) => (jb[i * 12 + k * 4] = boneOf(t)));
        const n = faceNormal(t.v);
        t.v.forEach((p, k) => {
          // UVs from the model-space position (before re-centering), so tiles line up across meshes
          if (uv && tex) { const [u, v] = boxUV(p, n, tex.uv); uv[i * 6 + k * 2] = u; uv[i * 6 + k * 2 + 1] = v; }
          for (let c = 0; c < 3; c++) {
            const x = p[c] - origin[c];
            pos[i * 9 + k * 3 + c] = x;
            nrm[i * 9 + k * 3 + c] = n[c];
            if (x < min[c]) min[c] = x;
            if (x > max[c]) max[c] = x;
          }
        });
      });
      const attributes: Record<string, number> = { POSITION: push(pos, "VEC3", min, max), NORMAL: push(nrm, "VEC3") };
      if (uv) attributes.TEXCOORD_0 = push(uv, "VEC2");
      if (jb) {
        // rigid skinning: every vertex follows exactly one bone
        const bv = blob(jb, 34962);
        accessors.push({ bufferView: bv, componentType: 5121, count: tris.length * 3, type: "VEC4" });
        attributes.JOINTS_0 = accessors.length - 1;
        attributes.WEIGHTS_0 = push(new Float32Array(tris.length * 12).map((_, i) => (i % 4 === 0 ? 1 : 0)), "VEC4");
      }
      primitives.push({ attributes, material: material(key, pal), mode: 4 });
    }
    meshes.push({ name, primitives });
    return meshes.length - 1;
  };

  const lightNode = (mdl: GlbModel, i: number, l: Light, origin: V3): number => {
    // Watts -> candela, the inverse of Blender's importer, so power survives the round trip.
    const light: Record<string, unknown> = { name: `${mdl.name}_light_${i}`, type: l.type, color: srgbToLinear(l.color), intensity: (l.power * 683) / (4 * Math.PI) };
    if (l.range) light.range = l.range;
    if (l.type === "spot") {
      const outer = ((l.angle ?? 35) * Math.PI) / 180;
      light.spot = { outerConeAngle: Math.min(outer, Math.PI / 2), innerConeAngle: Math.min(outer, Math.PI / 2) * 0.7 };
    }
    lights.push(light);
    nodes.push({ name: light.name, translation: [l.pos[0] - origin[0], l.pos[1] - origin[1], l.pos[2] - origin[2]], rotation: quatToDir(l.dir), extensions: { KHR_lights_punctual: { light: lights.length - 1 } } });
    return nodes.length - 1;
  };

  for (const mdl of models) {
    const joints = mdl.joints ?? [], names = new Set(joints.map((j) => j.name));
    const partOf = (k?: string) => (k && names.has(k) ? k : "");
    const facesBy = new Map<string, Face[]>(), lightsBy = new Map<string, [number, Light][]>();
    for (const f of mdl.faces) { const k = partOf(f.part); (facesBy.get(k) ?? facesBy.set(k, []).get(k)!).push(f); }
    (mdl.lights ?? []).forEach((l, i) => { const k = partOf(l.part); (lightsBy.get(k) ?? lightsBy.set(k, []).get(k)!).push([i, l]); });

    // Nodes: the body at the model's translation, each part a child of its parent at pivot - parent pivot.
    const nodeOf = new Map<string, number>();
    const pivotOf = (k: string): V3 => (k ? joints.find((j) => j.name === k)!.pivot : [0, 0, 0]);
    const build = (k: string): number => {
      const hit = nodeOf.get(k);
      if (hit !== undefined) return hit;
      const pv = pivotOf(k), j = joints.find((x) => x.name === k);
      const parent = k ? partOf(j!.parent) : undefined;
      const children = (lightsBy.get(k) ?? []).map(([i, l]) => lightNode(mdl, i, l, pv));
      const m = mesh(k ? `${mdl.name}.${k}` : mdl.name, facesBy.get(k) ?? [], mdl.pal, pv);
      const node: Record<string, unknown> = { name: k ? `${mdl.name}.${k}` : mdl.name, ...(m !== undefined ? { mesh: m } : {}) };
      if (k) {
        const pp = pivotOf(parent ?? "");
        node.translation = [pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]];
      } else if (mdl.translation) node.translation = mdl.translation;
      nodes.push(node);
      const idx = nodes.length - 1;
      nodeOf.set(k, idx);
      for (const c of joints.filter((x) => partOf(x.parent) === k && x.name !== k)) children.push(build(c.name));
      if (children.length) node.children = children;
      return idx;
    };
    if (mdl.rig && joints.length) {
      // Skinned export: one mesh weighted 100% to the bone of its part, bones named after the parts, plus a "root" bone for the static body.
      const order = ["", ...joints.map((j) => j.name)], boneIdx = new Map(order.map((k, i) => [k, i]));
      const m = mesh(mdl.name, mdl.faces, mdl.pal, [0, 0, 0], (f) => boneIdx.get(partOf(f.part)) ?? 0);
      const bone = (k: string): number => {
        const pv = pivotOf(k), j = joints.find((x) => x.name === k);
        const pp = k ? pivotOf(partOf(j!.parent)) : ([0, 0, 0] as V3);
        const children = (lightsBy.get(k) ?? []).map(([i, l]) => lightNode(mdl, i, l, pv));
        const node: Record<string, unknown> = { name: k || "root", translation: [pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]] };
        nodes.push(node);
        const idx = nodes.length - 1;
        nodeOf.set(k, idx);
        for (const c of joints.filter((x) => partOf(x.parent) === k && x.name !== k)) children.push(bone(c.name));
        if (children.length) node.children = children;
        return idx;
      };
      const rootBone = bone("");
      const ibm = new Float32Array(order.length * 16);
      order.forEach((k, i) => { const pv = pivotOf(k); ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pv[0], -pv[1], -pv[2], 1], i * 16); });
      skins.push({ name: `${mdl.name}_skeleton`, joints: order.map((k) => nodeOf.get(k)!), inverseBindMatrices: push(ibm, "MAT4", undefined, undefined, false), skeleton: rootBone });
      nodes.push({ name: mdl.name, ...(m !== undefined ? { mesh: m, skin: skins.length - 1 } : {}), ...(mdl.translation ? { translation: mdl.translation } : {}), children: [rootBone] });
      roots.push(nodes.length - 1);
    } else roots.push(build(""));

    // Animations: one sample per frame (0..frames inclusive), linear between them.
    for (const clip of mdl.clips ?? []) {
      const times = new Float32Array(clip.frames + 1).map((_, i) => i / clip.fps);
      const input = push(times, "SCALAR", [0], [clip.frames / clip.fps], false);
      const samplers: Record<string, unknown>[] = [], channels: Record<string, unknown>[] = [];
      for (const [part, keys] of Object.entries(clip.tracks)) {
        const node = nodeOf.get(part);
        if (node === undefined) continue;
        const rest = nodes[node].translation as V3;
        const vals = Array.from({ length: clip.frames + 1 }, (_, i) => partValues(keys, i));
        const add = (path: string, data: number[], kind: "VEC3" | "VEC4") => {
          samplers.push({ input, output: push(new Float32Array(data), kind, undefined, undefined, false), interpolation: "LINEAR" });
          channels.push({ sampler: samplers.length - 1, target: { node, path } });
        };
        if (keys.rot) add("rotation", vals.flatMap((v) => quatXYZ(v.rot)), "VEC4");
        if (keys.move) add("translation", vals.flatMap((v) => [rest[0] + v.move[0], rest[1] + v.move[1], rest[2] + v.move[2]]), "VEC3");
        if (keys.scale) add("scale", vals.flatMap((v) => v.scale), "VEC3");
      }
      if (channels.length) animations.push({ name: clip.name, samplers, channels });
    }
  }

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "kiln" },
    scene: 0, scenes: [{ nodes: roots }],
    nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength }],
  };
  if (animations.length) json.animations = animations;
  if (skins.length) json.skins = skins;
  if (textures.length) Object.assign(json, { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] });
  const used = [...(emissiveStrength ? ["KHR_materials_emissive_strength"] : []), ...(lights.length ? ["KHR_lights_punctual"] : [])];
  if (used.length) json.extensionsUsed = used;
  if (lights.length) json.extensions = { KHR_lights_punctual: { lights } };

  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(enc.length / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + byteLength;
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, jsonLen, true); v.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(enc, 20);
  let o = 20 + jsonLen;
  v.setUint32(o, byteLength, true); v.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
