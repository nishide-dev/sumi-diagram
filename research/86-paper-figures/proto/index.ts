/** Prototype pipeline: proposed YAML → model → structured layout → routing → SVG → checks. */
import { type CheckReport, checkLayout } from "./check";
import { type PlacedLabel, placeEdgeLabels } from "./edge-labels";
import { type Layout, layoutModel } from "./layout";
import { type Model, parseModel } from "./model";
import { type RoutedEdge, routeEdges } from "./route";
import { renderSvg } from "./svg";

export interface PrototypeResult {
  model: Model;
  layout: Layout;
  routed: RoutedEdge[];
  edgeLabels: PlacedLabel[];
  svg: string;
  checks: CheckReport;
  timing: { parseMs: number; layoutMs: number; routeMs: number; svgMs: number };
}

export function runPrototype(text: string): PrototypeResult {
  const t0 = performance.now();
  const model = parseModel(text);
  const t1 = performance.now();
  const layout = layoutModel(model);
  const t2 = performance.now();
  const routed = routeEdges(model, layout);
  const edgeLabels = placeEdgeLabels(routed);
  const t3 = performance.now();
  const svg = renderSvg(model, layout, routed, edgeLabels);
  const t4 = performance.now();
  const ms = (a: number, b: number) => Math.round((b - a) * 100) / 100;
  return {
    model,
    layout,
    routed,
    edgeLabels,
    svg,
    checks: checkLayout(model, layout, routed, edgeLabels),
    timing: { parseMs: ms(t0, t1), layoutMs: ms(t1, t2), routeMs: ms(t2, t3), svgMs: ms(t3, t4) },
  };
}
