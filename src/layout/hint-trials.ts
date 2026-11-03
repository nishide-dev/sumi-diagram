import type { ArrangeBoxIR, FigureIR } from "../compiler/ir";
import { type Diagnostic, hasErrors } from "../core/diagnostics";
import type { LayoutIR } from "./ir";
import { routeEdges } from "./route/router";
import { placeStructured, type StructuredLayoutOptions } from "./structured/engine";

// Import cycle: engine.ts imports `hintLayoutOptions` from here and this file imports the
// engine. Both sides must use the other's exports only at call time, never at module load.
export const MAX_HINT_TRIALS = 6;
let trialDepth = 0;
/** True while a trial layout runs, so placement does not start hint trials of its own. */
export const inHintTrial = (): boolean => trialDepth > 0;
export const MAX_HINT_ELEMENTS = 80;
/** Preserve the actual profile/measurer, without adding anything to the output IR. */
export const hintLayoutOptions = new WeakMap<FigureIR, StructuredLayoutOptions>();

export function mapBoxes(
  ir: FigureIR,
  edit: (box: ArrangeBoxIR, original: ArrangeBoxIR) => ArrangeBoxIR,
): FigureIR {
  const visit = (box: ArrangeBoxIR): ArrangeBoxIR =>
    edit(
      {
        ...box,
        items: box.items.map((item) =>
          item !== null && typeof item !== "string" ? visit(item) : item,
        ),
      },
      box,
    );
  const groups = ir.groups.map((g) => ({ ...g, ...(g.arrange && { arrange: visit(g.arrange) }) }));
  return {
    ...ir,
    groups,
    ...(ir.arrange && { arrange: visit(ir.arrange) }),
    elements: new Map([...ir.nodes, ...groups, ...ir.edges].map((e) => [e.key, e])),
  };
}

/** A per-diagnostic deterministic budget; no renders, and no recursive hint trials. */
export class HintTrials {
  count = 0;
  readonly eligible: boolean;
  constructor(readonly original: FigureIR) {
    let items = 0;
    const small = (box: ArrangeBoxIR): boolean => {
      items += box.items.length;
      return (
        items <= 240 &&
        (box.columns ?? 0) <= MAX_HINT_ELEMENTS &&
        box.items.every((item) => item === null || typeof item === "string" || small(item))
      );
    };
    this.eligible =
      original.meta.engine === "structured" &&
      original.elements.size <= MAX_HINT_ELEMENTS &&
      original.arrange !== undefined &&
      small(original.arrange) &&
      original.groups.every((g) => !g.arrange || small(g.arrange));
  }
  run(
    candidate: FigureIR,
    route = true,
  ): { layout: LayoutIR; diagnostics: readonly Diagnostic[] } | undefined {
    if (!this.eligible || this.count >= MAX_HINT_TRIALS) return;
    this.count++;
    trialDepth++;
    try {
      const placed = placeStructured(candidate, hintLayoutOptions.get(this.original));
      if (hasErrors(placed.diagnostics)) return;
      if (!route) return { layout: placed.layout, diagnostics: placed.diagnostics };
      const routed = routeEdges(candidate, placed.layout, { hintTrials: false });
      return { layout: routed.layout, diagnostics: [...placed.diagnostics, ...routed.diagnostics] };
    } finally {
      trialDepth--;
    }
  }
}
