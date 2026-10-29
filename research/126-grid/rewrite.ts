/** Reproduce the two grid acceptance sources from their unchanged originals. */
import { parse, stringify } from "yaml";

const source = "research/109-dogfood-v0.4/figures/training-pipeline.sumi.yaml";
const training = parse(await Bun.file(source).text());
training.figure.layout.arrange = {
  grid: {
    columns: 4,
    rowGap: "10mm",
    columnGap: "6mm",
    align: "center",
    items: [
      "dataset",
      "sample",
      "augment",
      "augmented",
      "model",
      "loss",
      { item: "optimizer", span: 2 },
    ],
  },
};
delete training.groups;
for (const node of training.nodes) {
  if (node.props?.src) {
    const name = node.props.src;
    node.props.src = `grid-assets/${name}`;
    await Bun.write(
      `tests/fixtures/figures/layout/grid-assets/${name}`,
      Bun.file(`research/109-dogfood-v0.4/figures/${name}`),
    );
  }
}
await Bun.write(
  "tests/fixtures/figures/layout/grid-training.sumi.yaml",
  stringify(training, { lineWidth: 0 }),
);

const h3 = parse(await Bun.file("research/185-acceptance/figures/c-h3world.sumi.yaml").text());
const body = h3.groups[0].arrange.row.items[1].stack;
const columns = body.items[0].row.items;
body.items[0] = {
  grid: {
    columns: 5,
    rowGap: "3mm",
    columnGap: "10pt",
    align: "center",
    items: [0, 1, 2, 3].flatMap((row) =>
      columns.map((column: { stack: { items: unknown[] } }) => column.stack.items[row]),
    ),
  },
};
for (const node of h3.nodes) {
  if (node.props?.src)
    await Bun.write(
      `research/126-grid/${node.props.src}`,
      Bun.file(`research/185-acceptance/figures/${node.props.src}`),
    );
}
await Bun.write("research/126-grid/c-h3world.sumi.yaml", stringify(h3, { lineWidth: 0 }));
