/**
 * A patched copy of the product router (`src/layout/route/router.ts`) for the
 * crossing-reduction experiments (#124, docs/research/124-stage-b.md §8).
 *
 * The product source is read at run time and rewritten into
 * `out/router-variant.ts` and `out/ports-variant.ts` (gitignored) with textual patches, each of
 * which must match exactly once, so the experiment always runs against the
 * checked-out router and fails loudly if it drifts:
 *
 *  1. imports point back at `src/` (read-only);
 *  2. `ROUTE` is no longer frozen (cost tuning);
 *  3. `HOOKS.order` may reorder the routing loop (edge / net ordering);
 *  4. `HOOKS.history` adds a per-point cost (negotiated congestion: rip up
 *     every route and route again with the cost of past crossings);
 *  5. that cost is added to every step that is not a free step on the
 *     edge's own net (non-negative, so the A* lower bound stays admissible);
 *  6. (in a patched `ports.ts`) `HOOKS.side` may choose the side of an end
 *     without an anchor instead of `facingSide()`;
 *  7. `HOOKS.labelEdge` may stand in another edge for the label placement
 *     (the `labelAt` prototype of §2).
 *
 * With `HOOKS` empty and `ROUTE` unchanged the variant is the product router;
 * `bench.ts` checks that it returns byte-identical layouts.
 */

import { join } from "node:path";
import type { EdgeIR, FigureIR } from "../../../src/compiler/ir";
import type { LayoutIR } from "../../../src/layout/ir";
import type { resolveEnds as productResolveEnds } from "../../../src/layout/route/ports";
import type { RouteResult } from "../../../src/layout/route/router";
import { OUT, patch, readProduct, writeCopy } from "../patch";

/** The router's `Edge` as the hooks see it (internal to the router). */
export interface HookEdge {
  readonly ir: { readonly key: string };
  readonly from: { readonly key: string; readonly port: { x: number; y: number } };
  readonly to: { readonly key: string; readonly port: { x: number; y: number } };
  readonly net: number;
  readonly index: number;
}

export interface Hooks {
  /** Side of an end without an anchor (`undefined`: the product's `facingSide`). */
  side:
    | ((
        edge: { readonly key: string },
        self: string,
        other: string,
        isSource: boolean,
      ) => "north" | "east" | "south" | "west" | undefined)
    | null;
  order: ((edges: readonly HookEdge[]) => HookEdge[]) | null;
  /** Extra cost of stepping onto a grid point, keyed `"x,y"` (grid coordinates). */
  history: Map<string, number> | null;
  /** The edge the label placement sees instead of `edge` (`labelAt` prototype). */
  labelEdge: ((edge: EdgeIR) => EdgeIR) | null;
}

export interface VariantRouter {
  routeEdges(ir: FigureIR, layout: LayoutIR): RouteResult;
  /** The patched `ports.ts`'s `resolveEnds` (sees `HOOKS.side`). */
  resolveEnds: typeof productResolveEnds;
  ROUTE: Record<string, number>;
  HOOKS: Hooks;
}

/**
 * The patched sources (throws if a patch target no longer matches the
 * checked-out product source: the experiment is pinned to it, see README).
 */
export function variantSources(): { ports: string; router: string } {
  // ports.ts: 6. `HOOKS.side` may pick the side of an end without an anchor.
  let ports = readProduct("src/layout/route/ports.ts");
  ports = patch(
    ports,
    "    return { side: facingSide(self.rect, other.rect), inward: false, anchored: false };",
    `    return {
    side: HOOKS.side?.(edge, self.key, other.key, isSource) ?? facingSide(self.rect, other.rect),
    inward: false,
    anchored: false,
  };`,
  );

  let src = readProduct("src/layout/route/router.ts");
  src = patch(src, 'from "../../../src/layout/route/ports";', 'from "./ports-variant";');
  // 2. Mutable costs.
  src = patch(src, "export const ROUTE = Object.freeze({", "export const ROUTE = ({");
  // 3. Ordering, and 4. the history array, built once the grid exists.
  src = patch(
    src,
    "    for (const edge of routable) this.#reserveStubs(edge);",
    `    for (const edge of routable) this.#reserveStubs(edge);
  if (HOOKS.history !== null) {
    const NX = this.#NX;
    const hist = new Float64Array(this.#X.length * this.#Y.length);
    for (let j = 0; j < this.#Y.length; j++)
      for (let i = 0; i < NX; i++)
        hist[j * NX + i] = HOOKS.history.get(\`\${this.#X[i]},\${this.#Y[j]}\`) ?? 0;
    this.#hist = hist;
  }`,
  );
  src = patch(
    src,
    "    for (const edge of routable) {",
    "    for (const edge of HOOKS.order !== null ? HOOKS.order(routable) : routable) {",
  );
  src = patch(
    src,
    "  #lowerBound: boolean;",
    "  #hist: Float64Array | null = null;\n  #lowerBound: boolean;",
  );
  // 5. The history cost in the search.
  src = patch(
    src,
    "    const roomTo = this.#roomTo;",
    "    const roomTo = this.#roomTo;\n    const hist = this.#hist;",
  );
  src = patch(
    src,
    "        const next = q * 4 + nd;",
    "        if (hist !== null && cost > 0) cost += hist[q] as number;\n        const next = q * 4 + nd;",
  );
  // 7. `HOOKS.labelEdge` may stand in another edge for the label placement
  // (`labelAt` prototype: an edge without arrowheads gets the mid-line label).
  src = patch(
    src,
    "      const label = placeEdgeLabel(e.labelMetrics, points, edge, arrow, {",
    "      const label = placeEdgeLabel(e.labelMetrics, points, HOOKS.labelEdge?.(edge) ?? edge, arrow, {",
  );
  return {
    ports: `import { HOOKS } from "./hooks";\n${ports}`,
    router: `import { HOOKS } from "./hooks";\nexport { HOOKS };\n${src}`,
  };
}

let cached: Promise<VariantRouter> | undefined;

export function loadVariantRouter(): Promise<VariantRouter> {
  cached ??= (async () => {
    const sources = variantSources();
    writeCopy(
      "hooks.ts",
      "export const HOOKS = { order: null, history: null, side: null, labelEdge: null };\n",
    );
    writeCopy("ports-variant.ts", sources.ports);
    const file = writeCopy("router-variant.ts", sources.router);
    const router = (await import(file)) as Omit<VariantRouter, "resolveEnds">;
    const { resolveEnds } = (await import(join(OUT, "ports-variant.ts"))) as Pick<
      VariantRouter,
      "resolveEnds"
    >;
    return { ...router, resolveEnds } as VariantRouter;
  })();
  return cached;
}
