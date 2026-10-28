// Generates figures/c-h3world.sumi.yaml: the H3-World-style overview of #86
// (figures/ideal/c-h3world.sumi.yaml) written with today's syntax only.
// The keycaps, token rows and the 9 x 9 attention matrix have no component
// yet (#86 §7), so they are spelled out node by node; the generator exists to
// measure that cost (docs/research/167-stage-c.md §2.3) and to keep the file
// consistent. Usage: bun research/167-stage-c/gen-c.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Tone = "gray" | "orange" | "purple" | "green" | "blue" | "pink" | "red" | "yellow";
const nodes: string[] = [];
const edges: string[] = [];
const node = (s: string) => nodes.push(`  - ${s}`);
const edge = (s: string) => edges.push(`  - ${s}`);
const list = (ids: string[]) => `[ ${ids.join(", ")} ]`;

// --- (a) -------------------------------------------------------------------
const frames = ["00", "01", "05", "09", "13"];
const frameLabels = ["$I_0$", "$I_{1-4}$", "$I_{5-8}$", "$I_{9-12}$", "$I_{13-16}$"];
const pressed: string[][] = [
  [],
  ["a"],
  ["a", "s", "l"],
  ["a", "s", "i", "l"],
  ["a", "s", "f", "l"],
];
const prompts = [
  "Character\nstands still,\ncamera holds\nsteady",
  "Character\nstrafes left,\ncamera\nfollows him",
  "Walks back,\nstrafes left;\ncamera pans\nright slowly",
  "Walks back,\nstrafes left;\npans right,\ntilts up",
  "Walks back,\nstrafes left;\ncamera pans\nright sharply",
];
const keySize = "8.5pt";
const columns: string[] = [];
for (let i = 0; i < 5; i++) {
  const key = (k: string) => {
    const id = `k${i}-${k}`;
    // pressed keys: orange on the left cluster, blue on the right (as in the reference)
    const left = ["w", "a", "s", "d"].includes(k);
    const tone = pressed[i]?.includes(k) ? `, tone: ${left ? "orange" : "blue"}` : "";
    node(
      `{ id: ${id}, component: square, label: ${k.toUpperCase()}${tone}, props: { width: ${keySize}, height: ${keySize} } }`,
    );
    return id;
  };
  const wasd = `stack: { gap: 0.5mm, items: [ ${key("w")}, row: { gap: 0.5mm, items: ${list(["a", "s", "d"].map(key))} } ] }`;
  const ijkl = `stack: { gap: 0.5mm, items: [ row: { gap: 0.5mm, items: ${list(["i", "f"].map(key))} }, row: { gap: 0.5mm, items: ${list(["j", "k", "l"].map(key))} } ] }`;
  node(
    `{ id: frame${i}, component: image, variant: framed, props: { src: assets/frame-${frames[i]}.jpg, width: 72pt, height: 40.5pt, fit: cover } }`,
  );
  node(`{ id: frame${i}-label, component: label, label: '${frameLabels[i]}' }`);
  node(
    `{ id: prompt${i}, component: box, tone: gray, label: "${prompts[i]?.replaceAll("\n", "\\n")}", props: { width: 72pt } }`,
  );
  node(`{ id: enc${i}, component: box, label: H3 Encoder, tone: purple, props: { width: 72pt } }`);
  columns.push(
    `- stack: { gap: 3mm, items: [ stack: { gap: 0.5mm, items: [ frame${i}, frame${i}-label ] }, row: { gap: 1.5mm, items: [ ${wasd}, ${ijkl} ] }, prompt${i}, enc${i} ] }`,
  );
  if (i > 0) edge(`{ from: prompt${i - 1}, to: prompt${i} }`);
  edge(`{ from: prompt${i}, to: enc${i} }`);
}
node("{ id: visual-heading, component: label, label: Visual Stream }");
node("{ id: action-heading, component: label, label: Action Stream }");
node(
  "{ id: first-frame, component: image, variant: framed, props: { src: assets/frame-00.jpg, width: 40pt, height: 22.5pt, fit: cover } }",
);
node(
  "{ id: first-frame-label, component: label, label: '$I_0$', attach: { to: first-frame, side: west, gap: 0.5mm } }",
);
node("{ id: first-encoder, component: box, label: H3 Encoder, tone: purple }");
node("{ id: seq-heading, component: label, label: Sequence }");
node("{ id: refiner, component: box, label: 2-Layer Token Refiner, tone: gray }");
node(
  '{ id: vae, component: box, label: "Visual\\nVAE\\nEncoder", tone: orange, props: { height: 120pt } }',
);
node(
  '{ id: frames-more, component: label, label: "…", attach: { to: frame4, side: east, gap: 0.5mm } }',
);

// the packed sequence: one row of cells (no tokens component yet)
type Cell = { id: string; label: string; tone?: Tone; width?: string };
const seqCells: Cell[] = [
  { id: "static", label: "Static", width: "36pt" },
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, label: `$A_${n}$`, tone: "purple" as Tone })),
  { id: "adots", label: "$A_{\\ldots}$", tone: "purple" },
  { id: "i0", label: "$I_0$" },
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `v${n}`, label: `$V_${n}$`, tone: "orange" as Tone })),
  { id: "vdots", label: "$V_{\\ldots}$", tone: "orange" },
];
const cells = (prefix: string, cs: Cell[], size: string) =>
  cs.map((c) => {
    const id = `${prefix}-${c.id}`;
    const tone = c.tone ? `, tone: ${c.tone}` : "";
    node(
      `{ id: ${id}, component: box, label: '${c.label}'${tone}, props: { width: ${c.width ?? size}, height: 14pt } }`,
    );
    return id;
  });
const seq = cells("seq", seqCells, "20pt");
edge("{ from: first-frame, to: first-encoder }");
edge("{ from: first-encoder, to: refiner, toAnchor: west }");
// Straight drops (#151 C1): the anchors must be the encoder centres as exact
// fractions of the refiner's top side. Round numbers (0.1, 0.3, …) gave a
// small jog under every encoder and a loop around enc1; fractions read back
// from the SVG to 4 decimals made all five loop (sub-unit offsets, bug R1).
// So the columns are forced to 72pt with 10pt gaps (400pt in all): the
// centres 36, 118, 200, 282, 364 are then terminating decimals.
const drops = ["0.09", "0.295", "0.5", "0.705", "0.91"];
for (let i = 0; i < 5; i++) edge(`{ from: enc${i}, to: refiner, toAnchor: "north:${drops[i]}" }`);
edge("{ from: refiner, to: seq-a5 }");
edge('{ from: frames-more, to: vae, toAnchor: "west:0.1" }');
edge("{ from: vae, to: seq-vdots, fromAnchor: south, toAnchor: east }");
edge(
  '{ from: action-heading, to: prompt0, toAnchor: west, label: "scheduled\\nprompt", labelAt: middle, variant: muted }',
);

// --- (b) -------------------------------------------------------------------
const bCells = cells(
  "bt",
  [
    { id: "static", label: "Static", width: "30pt" },
    ...[1, 2, 3].map((n) => ({ id: `a${n}`, label: `$A_${n}$`, tone: "purple" as Tone })),
    { id: "i0", label: "$I_0$" },
    ...[1, 2, 3].map((n) => ({ id: `v${n}`, label: `$V_${n}$`, tone: "orange" as Tone })),
    { id: "pad", label: "Pad", width: "20pt" },
  ],
  "16pt",
);
node("{ id: b-block1, component: box, label: H3 Omni Transformer Block, tone: blue }");
node('{ id: b-dots1, component: label, label: "⋮" }');
node("{ id: b-attn, component: box, label: Single Stream Self-Attention, tone: orange }");
node("{ id: b-ffn, component: box, label: Feed Forward Network, tone: gray }");
node('{ id: b-dots2, component: label, label: "⋮" }');
node("{ id: b-block2, component: box, label: H3 Omni Transformer Block, tone: blue }");
edge("{ from: bt-a3, to: b-block1 }");
node("{ id: b-out, component: junction, variant: hidden }");
edge("{ from: b-block2, to: b-out }");
// zoom callout today: dashed lines from the attention box's right corners to
// the (c) panel's left corners (orthogonal, not the diagonals of the reference)
edge(
  '{ from: b-attn, fromAnchor: "east:0", to: lora, toAnchor: "west:0", component: line, variant: dashed }',
);
edge(
  '{ from: b-attn, fromAnchor: "east:1", to: lora, toAnchor: "west:1", component: line, variant: dashed }',
);

// --- (c) -------------------------------------------------------------------
const cTones: Tone[] = [
  "gray",
  "purple",
  "purple",
  "purple",
  "gray",
  "orange",
  "orange",
  "orange",
  "gray",
];
const cTok = cTones.map((t, n) => {
  node(`{ id: ct-${n}, component: box, tone: ${t}, props: { width: 9pt, height: 7pt } }`);
  return `ct-${n}`;
});
node("{ id: lora-in, component: trapezoid, label: LoRA, tone: pink }");
node('{ id: qkv, component: box, label: "QKV\\nProj.", tone: blue }');
node("{ id: c-add-in, component: operator, props: { symbol: plus }, tone: orange }");
node("{ id: lora-out, component: trapezoid, label: LoRA, tone: pink }");
node('{ id: out-proj, component: box, label: "Out\\nProj.", tone: blue }');
node("{ id: c-add-out, component: operator, props: { symbol: plus }, tone: orange }");
for (const [id, icon] of [
  ["lora-in", "flame"],
  ["qkv", "snowflake"],
  ["lora-out", "flame"],
  ["out-proj", "snowflake"],
] as const) {
  node(
    `{ id: ${id}-badge, component: label, icon: tabler/${icon}, attach: { to: ${id}, side: north, gap: 0.5mm } }`,
  );
}
// the 9 x 9 mask: o = allowed (green), L = A<->V link (orange), . = masked
const rows = [
  "o...oooo.",
  "oo..oL...",
  "o.o.o.L..",
  "o..oo..L.",
  "o...oooo.",
  "oL..oooo.",
  "o.L.oooo.",
  "o..Loooo.",
  "........o",
];
const heads = ["S", "$A_1$", "$A_2$", "$A_3$", "$I_0$", "$V_1$", "$V_2$", "$V_3$", "P"];
const matrixRows: string[] = [];
const colHeads = heads.map((h, c) => {
  node(`{ id: mc-${c}, component: label, label: '${h}', props: { width: 12pt } }`);
  return `mc-${c}`;
});
node("{ id: mc-corner, component: label, label: Q / K, props: { width: 22pt } }");
matrixRows.push(`row: { gap: 0, items: ${list(["mc-corner", ...colHeads])} }`);
rows.forEach((r, i) => {
  node(`{ id: mr-${i}, component: label, label: '${heads[i]}', props: { width: 22pt } }`);
  const ids = [...r].map((ch, j) => {
    const id = `m-${i}-${j}`;
    const tone = ch === "o" ? ", tone: green" : ch === "L" ? ", tone: orange" : "";
    node(`{ id: ${id}, component: box${tone}, props: { width: 12pt, height: 9pt } }`);
    return id;
  });
  matrixRows.push(`row: { gap: 0, items: ${list([`mr-${i}`, ...ids])} }`);
});
node("{ id: mask-title, component: label, label: Masked Attention }");
node(
  `- id: mask-key
    component: legend
    props:
      entries:
        - { node: { tone: green }, label: Allowed }
        - { node: { tone: orange }, label: "A↔V Link" }
        - { node: { component: box }, label: Masked }`.slice(2),
);
edge("{ from: ct-4, to: lora-in, fromAnchor: east }");
edge("{ from: ct-4, to: qkv, fromAnchor: east }");
edge("{ from: lora-in, to: c-add-in }");
edge("{ from: qkv, to: c-add-in }");
edge("{ from: c-add-in, to: mask }");
edge("{ from: mask, to: lora-out }");
edge("{ from: mask, to: out-proj }");
edge("{ from: lora-out, to: c-add-out }");
edge("{ from: out-proj, to: c-add-out }");

const yaml = `# #167 figure C: the H3-World overview (the user's own figure, "Figure 3.
# Overview of H3-World"; not committed), redrawn with today's syntax only,
# starting from #86's draft ideal/c-h3world.sumi.yaml. GENERATED by
# research/167-stage-c/gen-c.ts: edit the generator, not this file. Frames are
# placeholder images made for this study, not the reference's pixels.
version: 1
figure:
  id: stage-c-h3world
  theme: color
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 3mm
        align: stretch
        items:
          - build
          - row: { gap: 3mm, align: stretch, items: [ adapt, lora ] }
    align:
      - { y: [ visual-heading, frame0 ] }
      - { y: [ action-heading, k0-s ] }
      - { y: [ first-frame, prompt0 ] }
      - { y: [ first-encoder, enc0 ] }
      - { y: [ seq-heading, seq-static ] }

groups:
  - id: build
    label: (a) Build the packed H3-World sequence
    labelAt: top-left
    arrange:
      row:
        gap: 6mm
        align: start
        items:
          - stack: { gap: 2mm, align: center, items: [ visual-heading, action-heading, first-frame, first-encoder, seq-heading ] }
          - stack:
              gap: 2.5mm
              align: stretch
              items:
                - row:
                    gap: 10pt
                    items:
${columns.map((c) => `                      ${c}`).join("\n")}
                - refiner
                - row: { gap: 1.5pt, items: ${list(seq)} }
          - vae
  - id: adapt
    label: (b) Adapt the H3 block
    labelAt: top-left
    arrange:
      stack:
        gap: 3mm
        align: stretch
        items:
          - row: { gap: 1pt, items: ${list(bCells)} }
          - b-block1
          - b-dots1
          - b-inner
          - b-dots2
          - b-block2
          - b-out
  - id: b-inner
    tone: blue
    arrange:
      stack: { gap: 2mm, align: stretch, items: [ b-attn, b-ffn ] }
  - id: lora
    label: (c) LoRA inside H3 self-attention
    labelAt: top-left
    variant: muted
    arrange:
      row:
        gap: 4mm
        align: center
        items:
          - stack: { gap: 1.5pt, items: ${list(cTok)} }
          - stack: { gap: 6mm, items: [ lora-in, qkv ] }
          - c-add-in
          - stack: { gap: 1.5mm, items: [ mask, mask-title ] }
          - stack: { gap: 6mm, items: [ lora-out, out-proj ] }
          - c-add-out
          - mask-key
  - id: mask
    arrange:
      stack:
        gap: 0
        items:
${matrixRows.map((r) => `          - ${r}`).join("\n")}

nodes:
${nodes.join("\n")}

edges:
${edges.join("\n")}
`;
writeFileSync(join(import.meta.dir, "figures/c-h3world.sumi.yaml"), yaml);
console.log(`nodes ${nodes.length}, edges ${edges.length}, lines ${yaml.split("\n").length}`);
