import type { FigureIR } from "../../compiler/ir";
import type { ElementKey } from "../../core/check-state";
import type { Diagnostic } from "../../core/diagnostics";
import type { LayoutIR, Rect } from "../ir";
import { isZoomEdge } from "./zoom";

/** Explain horizontal jogs caused by aligning a titled frame rather than its contents. */
export function groupTitleDiagnostics(ir: FigureIR, layout: LayoutIR): Diagnostic[] {
  const elements = new Map([...layout.nodes, ...layout.groups].map((e) => [e.key, e]));
  const center = (r: Rect) => r.y + r.height / 2;
  const frames = (key: ElementKey) => {
    const result = [];
    let element = elements.get(key);
    while (element !== undefined) {
      result.push(element);
      element = element.parent === undefined ? undefined : elements.get(element.parent);
    }
    return result;
  };
  const diagnostics: Diagnostic[] = [];
  for (const edge of ir.edges) {
    if (isZoomEdge(edge)) continue;
    const route = layout.edges.find((e) => e.key === edge.key)?.route;
    if (
      route === undefined ||
      route.points.length <= 2 ||
      !["east", "west"].includes(route.fromSide ?? "") ||
      !["east", "west"].includes(route.toSide ?? "")
    )
      continue;
    const from = elements.get(edge.from);
    const to = elements.get(edge.to);
    if (
      from === undefined ||
      to === undefined ||
      Math.abs(center(from.rect) - center(to.rect)) < 0.01
    )
      continue;
    const pair = frames(edge.from)
      .flatMap((a) => frames(edge.to).map((b) => ({ a, b })))
      .find(
        ({ a, b }) =>
          a.key !== b.key &&
          Math.abs(center(a.rect) - center(b.rect)) < 0.01 &&
          Math.abs(center(from.rect) - center(a.kind === "group" ? a.content : a.rect)) < 0.01 &&
          Math.abs(center(to.rect) - center(b.kind === "group" ? b.content : b.rect)) < 0.01 &&
          [a, b].some(
            (e) =>
              e.kind === "group" &&
              e.label !== undefined &&
              Math.abs(center(e.rect) - center(e.content)) > 0.01,
          ),
      );
    if (pair === undefined) continue;
    const titled = [pair.a, pair.b].filter((e) => e.kind === "group" && e.label !== undefined);
    const names = titled.map((e) => `"${ir.elements.get(e.key)?.id}"`).join(", ");
    const fromId = ir.elements.get(edge.from)?.id;
    const toId = ir.elements.get(edge.to)?.id;
    const source = ir.sourceMap.get(edge.key);
    diagnostics.push({
      code: "layout/group-title-offset",
      severity: "info",
      message: `Edge "${fromId}" → "${toId}" bends between aligned frames: the title of group ${names} reserves space above its contents, so the frame center and content center differ.`,
      path: source?.path ?? ["edges", edge.index],
      ...(source?.location !== undefined && { location: source.location }),
      subject: { kind: "edge", id: edge.id ?? `edges[${edge.index}]` },
      hint: `Align the connected nodes instead of their frames: figure.layout.align: [{ y: [${fromId}, ${toId}] }]. For an attached input, attach to the connected node instead of its frame. Use a caption or an untitled group if no header space is wanted.`,
    });
  }
  return diagnostics;
}
