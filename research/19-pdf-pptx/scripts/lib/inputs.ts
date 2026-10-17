/** The PoC inputs (relative to the repository root): two examples and a Japanese fixture. */
export const INPUTS = [
  "examples/system-architecture/system-architecture.sumi.yaml",
  "examples/decision-flow/decision-flow.sumi.yaml",
  "research/19-pdf-pptx/figures/ja-review.sumi.yaml",
];

export const figureId = (input: string): string =>
  (input.split("/").pop() ?? input).replace(/\.sumi\.yaml$/, "");
