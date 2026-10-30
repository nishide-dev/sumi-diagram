/** Rebuild the acceptance copy from the committed #233 source and assets. */
export {};

const origin = "research/233-lora";
const target = "research/248-fill";
let source = await Bun.file(`${origin}/c-h3world.sumi.yaml`).text();
source = source
  .replace(
    "# #233 acceptance: copy of #188 H3-World; two separated trapezoids per LoRA.",
    "# #248: fill the projection/token columns; keep panel (c) at its natural height.",
  )
  .replace(
    "row: { align: stretch, items: [ adapt, lora ] }",
    "row: { align: start, items: [ adapt, lora ] }",
  )
  .replace(
    "        align: center\n        items:\n          - ct",
    "        align: stretch\n        items:\n          - stack: { gap: 1.5pt, justify: stretch, items: [ ct1, ct2, ct3, ct4, ct5, ct6, ct7, ct8, ct9 ] }",
  )
  .replaceAll(
    "stack: { gap: 6mm, items: [ lora-",
    "stack: { gap: 6mm, justify: stretch, items: [ lora-",
  )
  .replace(
    "stack: { gap: 1.5mm, items: [ key-axis, { row: { gap: 1mm, items: [ query-axis, mask ] } }, mask-title ] }",
    "row: { gap: 1mm, items: [ query-axis, mask ] }",
  )
  .replace("          - mask-key", "          - stack: { items: [ mask-key ] }")
  .replace(
    "label: Masked Attention }",
    "label: Masked Attention, attach: { to: mask, side: south, gap: 1mm } }",
  )
  .replace("label: Key → }", "label: Key →, attach: { to: mask, side: north, gap: 1mm } }")
  .replaceAll("from: ct.5", "from: ct5")
  .replaceAll("props: { gap: 8 }, tone: pink", "props: { gap: 8, height: 28pt }, tone: pink");
source = source.replace(
  /^ {2}- \{ id: ct,.*$/m,
  ["gray", "purple", "purple", "purple", "gray", "orange", "orange", "orange", "gray"]
    .map(
      (tone, i) =>
        `  - { id: ct${i + 1}, component: box, variant: filled, tone: ${tone}, props: { width: 9pt } }`,
    )
    .join("\n"),
);
await Bun.write(`${target}/c-h3world.sumi.yaml`, source);
for await (const asset of new Bun.Glob("assets/**").scan(origin)) {
  await Bun.write(`${target}/${asset}`, Bun.file(`${origin}/${asset}`));
}
