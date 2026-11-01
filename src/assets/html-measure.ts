/** Source projection for Takumi 2.19's block/inline measurement tree. */
import { fromHtml } from "@takumi-rs/helpers/html";
import type { MeasuredNode, Node } from "@takumi-rs/wasm/node";
import type { Rect } from "../core/geometry";
import { tokenizeCss } from "./html-css";

/** Ignore only layout's subpixel rounding, in viewport CSS px, on all four sides. */
export const HTML_OVERFLOW_EPSILON = 0.5;

export interface HtmlTextStyle {
  offset: number;
  fontSize: number;
  families: string[];
  weight: number;
  pre: boolean;
}
export interface HtmlMeasuredText extends HtmlTextStyle {
  text: string;
  box: Rect;
}
export interface HtmlMeasurement {
  boxes: { offset: number; box: Rect }[];
  texts: HtmlMeasuredText[];
}
interface TextSource {
  text: string;
  style: HtmlTextStyle;
}
interface SourceNode {
  style: HtmlTextStyle;
  display: string;
  absolute: boolean;
  text?: string;
  children: SourceNode[];
}
interface Plan {
  style: HtmlTextStyle;
  texts: TextSource[];
  children: Plan[];
  absolute?: boolean;
  placeholder?: boolean;
}

/** CSS font-size resolves against the parent, not against an earlier declaration. */
export function htmlFontSize(value: string | number | undefined, inherited: number): number {
  if (value === undefined) return inherited;
  const v = String(value).toLowerCase();
  const scalar = Number.parseFloat(v);
  return v.endsWith("em")
    ? scalar * inherited
    : v.endsWith("%")
      ? (scalar * inherited) / 100
      : v.endsWith("pt")
        ? (scalar * 4) / 3
        : scalar;
}

function sourceTree(source: string, variables: Record<string, string>): SourceNode {
  // IDs exist only in this source-map parse. Neither render nor measure receives
  // this markup; CSS is inline-only, so the IDs cannot affect the cascade.
  const stack: string[] = [];
  const styles = new Map<number, Record<string, string>>();
  const closeFrom = (index: number) =>
    stack
      .splice(index)
      .reverse()
      .map((tag) => `</${tag}>`)
      .join("");
  const marked = source.replace(
    /<(\/?)([a-z][a-z0-9]*)([^>]*?)>/gi,
    (tag, closing: string, rawName: string, attrs: string, offset: number) => {
      const name = rawName.toLowerCase();
      if (closing) {
        const index = stack.lastIndexOf(name);
        return index < 0 ? "" : closeFrom(index);
      }
      const attribute = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const css: Record<string, string> = {};
      for (const declaration of tokenizeCss(attribute?.[1] ?? attribute?.[2] ?? "", ";").parts ??
        []) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        const property = declaration
          .slice(0, colon)
          .trim()
          .toLowerCase()
          .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
        css[property] = declaration.slice(colon + 1).trim();
      }
      styles.set(offset, css);
      // Rust's HTML tree builder closes p on div/p even when Sumi's strict
      // syntactic nesting is balanced. The JS helper does not do this recovery.
      const p = stack.lastIndexOf("p");
      const prefix = p >= 0 && (name === "div" || name === "p") ? closeFrom(p) : "";
      if (name !== "br") stack.push(name);
      return prefix + tag.replace(/^<[a-z][a-z0-9]*/i, `<${rawName} id="${offset}"`);
    },
  );
  const root = fromHtml(`<div>${marked}</div>`).node;
  const familyList = (value: string) =>
    value
      .replace(/var\((--sumi-(?:font|mono))\)/g, (_, name: string) => variables[name] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^(['"])(.*)\1$/, "$2"));
  const initial: HtmlTextStyle = {
    offset: 0,
    fontSize: 16,
    families: familyList(variables["--sumi-font"] ?? ""),
    weight: 400,
    pre: false,
  };
  const visit = (node: Node, inherited: HtmlTextStyle): SourceNode => {
    // Validated declarations own case folding and last-declaration resolution;
    // the helper's JS property parser does not fold uppercase property names.
    const css = {
      ...node.preset,
      ...(node.id === undefined ? {} : styles.get(Number(node.id))),
    } as Record<string, unknown>;
    const weight = css.fontWeight === undefined ? undefined : String(css.fontWeight).toLowerCase();
    const style: HtmlTextStyle = {
      offset: node.id === undefined ? inherited.offset : Number(node.id),
      fontSize: htmlFontSize(css.fontSize as string | number | undefined, inherited.fontSize),
      families:
        typeof css.fontFamily === "string" ? familyList(css.fontFamily) : inherited.families,
      weight:
        weight === undefined
          ? inherited.weight
          : weight === "bolder"
            ? inherited.weight < 350
              ? 400
              : inherited.weight < 550
                ? 700
                : 900
            : weight === "bold"
              ? 700
              : weight === "normal"
                ? 400
                : Number(weight),
      pre:
        css.whiteSpace === undefined
          ? inherited.pre
          : String(css.whiteSpace).toLowerCase().startsWith("pre"),
    };
    return {
      style,
      display: String(css.display ?? "inline").toLowerCase(),
      absolute: String(css.position).toLowerCase() === "absolute",
      ...(node.type === "text" && { text: node.text }),
      children: node.type === "container" ? (node.children ?? []).map((c) => visit(c, style)) : [],
    };
  };
  return visit(root, initial);
}

function projection(node: SourceNode): Plan {
  const children = node.children.filter((c) => c.display !== "none");
  const plan: Plan = { style: node.style, texts: [], children: [], absolute: node.absolute };
  if (node.text !== undefined) {
    plan.texts.push({ text: node.text, style: node.style });
    return plan;
  }
  if (node.display === "flex" || node.display === "grid") {
    plan.children = children
      .filter((c) => c.text === undefined || c.style.pre || c.text.trim() !== "")
      .map(projection);
    return plan;
  }
  const inline = (n: SourceNode) => n.display === "inline" && !n.absolute;
  const flatten = (n: SourceNode, target: Plan) => {
    if (!inline(n)) {
      if (n.absolute)
        target.children.push({ style: n.style, texts: [], children: [], placeholder: true });
      target.children.push(projection(n));
      return;
    }
    if (n.text !== undefined) target.texts.push({ text: n.text, style: n.style });
    for (const child of n.children.filter((c) => c.display !== "none")) {
      if (!inline(child) && child.display !== "inline-block" && !child.absolute)
        target.children.push({ style: child.style, texts: [], children: [projection(child)] });
      else flatten(child, target);
    }
  };
  const block = children.some((c) => !inline(c) && c.display !== "inline-block" && !c.absolute);
  const flow = (group: Plan): Plan[] => {
    const hasInline =
      group.texts.some((t) => t.style.pre || t.text.trim()) ||
      group.children.some((c) => !c.absolute && !c.placeholder);
    if (!hasInline) return group.children.filter((c) => !c.placeholder);
    // Inline formatting reports its placeholders first, then its out-of-flow
    // children, whereas flex/grid and ordinary block children keep DOM order.
    group.children.sort((a, b) => Number(!!a.absolute) - Number(!!b.absolute));
    return [group];
  };
  if (!block) {
    for (const child of children) flatten(child, plan);
    if (children.some((c) => c.absolute)) {
      const groups = flow({ ...plan, absolute: false });
      return { style: node.style, texts: [], children: groups, absolute: node.absolute };
    }
  } else {
    let group: Plan | undefined;
    for (const child of children) {
      if (inline(child) || child.display === "inline-block" || child.absolute) {
        group ??= { style: child.style, texts: [], children: [] };
        flatten(child, group);
      } else {
        if (group) plan.children.push(...flow(group));
        group = undefined;
        plan.children.push(projection(child));
      }
    }
    if (group) plan.children.push(...flow(group));
  }
  return plan;
}

/** Map wrapped runs to their inline source spans, retaining decoded HTML entities. */
function runSources(texts: TextSource[]) {
  let text = "";
  const owners: HtmlTextStyle[] = [];
  for (const source of texts) {
    for (const ch of source.text) {
      const space = /[ \t\n\f\r]/.test(ch) && !source.style.pre;
      if (space && text.endsWith(" ")) continue;
      const value = space ? " " : ch;
      text += value;
      for (let i = 0; i < value.length; i++) owners.push(source.style);
    }
  }
  return { text, owners };
}

export function locateHtmlMeasurement(
  source: string,
  variables: Record<string, string>,
  measured: MeasuredNode,
): HtmlMeasurement {
  const result: HtmlMeasurement = { boxes: [], texts: [] };
  const visit = (node: MeasuredNode, plan: Plan) => {
    const x = node.transform[4],
      y = node.transform[5];
    result.boxes.push({
      offset: plan.style.offset,
      box: { x, y, width: node.width, height: node.height },
    });
    const sources = runSources(plan.texts);
    let cursor = 0;
    for (const run of node.runs) {
      const at = sources.text.indexOf(run.text, cursor);
      const start = at < 0 ? cursor : at;
      const box = { x: x + run.x, y: y + run.y, width: run.width, height: run.height };
      let pos = 0;
      while (pos < run.text.length) {
        const style = sources.owners[start + pos] ?? plan.style;
        let end = pos + 1;
        while (end < run.text.length && sources.owners[start + end] === style) end++;
        result.texts.push({ ...style, text: run.text.slice(pos, end), box });
        pos = end;
      }
      cursor = start + run.text.length;
    }
    for (const [index, child] of node.children.entries())
      visit(child, plan.children[index] ?? plan);
  };
  visit(measured, projection(sourceTree(source, variables)));
  return result;
}

export function htmlOverflows(box: Rect, viewport: { width: number; height: number }): boolean {
  const e = HTML_OVERFLOW_EPSILON;
  return (
    box.x < -e ||
    box.y < -e ||
    box.x + box.width > viewport.width + e ||
    box.y + box.height > viewport.height + e
  );
}
