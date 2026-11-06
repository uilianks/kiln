// The smooth stylised look: the same toy built three ways.
//   toy_flat     the default: every face flat (the classic low-poly look)
//   toy_smooth   the same triangles with smooth: 50 and baked ao: soft forms, crisp creases, darker contacts
//   toy_subdiv   subdiv(1) on the round parts, with detail-1 spheres: rounder outlines for about 1.8x the triangles
// plus a few single features: a bevelled block before and after subdiv, and a glass jar (alpha, double).
pal({
  shell: "#cb8175", belly: "#f0cf8e", cap: "#6d8d8a", eye: "#655057", cream: "#f6edcd", leaf: "#a8c8a6", wood: "#e2a97e",
  glass: { color: "#bfe3e0", alpha: 0.35, rough: 0.08, double: true },
  sticker: { color: "#cb8175", double: true },
})

// a round little creature on a wooden base: body, belly, head, cap, eyes, feet, a leaf sprout
const toy = ({ detail = 2, round = (x) => x } = {}) => [
  box(1.2, 0.16, 0.9, { mat: "wood", bevel: 0.05 }),
  round(sphere(0.42, { mat: "shell", detail, pos: [0, 0.62, 0], scale: [1, 0.92, 0.9] })),
  round(sphere(0.3, { mat: "belly", detail, pos: [0, 0.56, 0.2], scale: [1, 1.05, 0.7] })),
  round(sphere(0.3, { mat: "shell", detail, pos: [0, 1.1, 0.02] })),
  round(lathe([0, 1.25, 0.3, 1.27, 0.27, 1.38, 0.12, 1.47, 0, 1.49], { mat: "cap", sides: 12 })),
  sym("x", [
    sphere(0.055, { mat: "eye", detail: 1, pos: [0.11, 1.12, 0.27] }),
    round(cyl(0.11, 0.08, { mat: "belly", sides: 10, bevel: 0.03, pos: [0.2, 0.16, 0.1] })),
    round(tube([0.36, 0.7, 0.05, 0.5, 0.55, 0.12, 0.52, 0.42, 0.18], 0.06, { mat: "shell", sides: 8 })),
  ]),
  tube([0, 1.46, 0, 0.02, 1.6, 0.03], 0.02, { mat: "leaf", sides: 6 }),
  round(sphere(0.08, { mat: "leaf", detail: 1, pos: [0.07, 1.63, 0.05], scale: [1.4, 0.5, 0.9] })),
]

model("toy_flat", toy())
model("toy_smooth", { smooth: 50, ao: true }, toy())
model("toy_subdiv", { smooth: 50, ao: true }, toy({ detail: 1, round: (item) => subdiv(1, item) }))

// subdiv keeps sharp edges and uses a bevel as a support edge
model("block_flat", box(0.6, 0.6, 0.6, { mat: "cap", bevel: 0.08 }), box(0.6, 0.3, 0.6, { mat: "belly", pos: [0.8, 0, 0] }))
model("block_subdiv", subdiv(2, box(0.6, 0.6, 0.6, { mat: "cap", bevel: 0.08 }), box(0.6, 0.3, 0.6, { mat: "belly", pos: [0.8, 0, 0] })))

// a glass jar (blended, double-sided) with a sticker card inside and a cork
model("jar", { smooth: 50, ao: true },
  lathe([0.2, 0, 0.26, 0.04, 0.27, 0.42, 0.18, 0.5, 0.17, 0.56], { mat: "glass", sides: 20 }),
  extrude([-0.09, 0, 0.09, 0, 0.09, 0.22, -0.09, 0.22], 0.004, { mat: "sticker", pos: [0, 0.08, 0] }),
  cyl(0.15, 0.1, { mat: "wood", sides: 14, bevel: 0.02, pos: [0, 0.52, 0] }))

pack("smooth_kit", ["toy_flat", "toy_smooth", "toy_subdiv"], { cols: 3 })
pack("blocks", ["block_flat", "block_subdiv"], { cols: 2 })
