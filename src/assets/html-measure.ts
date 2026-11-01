/** Source projection for Takumi 2.19's block/inline measurement tree. */
import type { MeasuredNode } from "@takumi-rs/wasm/node";
import { decodeHTML } from "entities";
import type { Rect } from "../core/geometry";
import { parseHtml } from "./html";

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
  const root: SourceNode = { style: initial, display: "block", absolute: false, children: [] };
  const stack = [{ name: "", node: root }];
  const parsed = parseHtml(source);
  if (parsed.issues.length) throw new Error(parsed.issues[0]?.message);
  for (const token of parsed.tokens) {
    if (token.kind === "close") {
      const at = stack.map((entry) => entry.name).lastIndexOf(token.name);
      if (at > 0) stack.splice(at);
      continue;
    }
    if (token.kind === "open" && (token.name === "div" || token.name === "p")) {
      // Match Takumi's implicit p closing without reparsing author markup.
      const p = stack.map((entry) => entry.name).lastIndexOf("p");
      if (p > 0) stack.splice(p);
    }
    const parent = stack.at(-1)?.node ?? root;
    if (token.kind === "text") {
      const text = decodeHTML(token.text).replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");
      parent.children.push({
        style: parent.style,
        display: "inline",
        absolute: false,
        text,
        children: [],
      });
      continue;
    }
    const inherited = parent.style;
    const css = token.css;
    const weight = (
      css["font-weight"] ?? (token.name === "b" ? "bolder" : undefined)
    )?.toLowerCase();
    const style: HtmlTextStyle = {
      offset: token.offset,
      fontSize: htmlFontSize(css["font-size"], inherited.fontSize),
      families:
        css["font-family"] !== undefined ? familyList(css["font-family"]) : inherited.families,
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
        css["white-space"] === undefined
          ? inherited.pre
          : css["white-space"].toLowerCase().startsWith("pre"),
    };
    const node: SourceNode = {
      style,
      display: (
        css.display ?? (["div", "p"].includes(token.name) ? "block" : "inline")
      ).toLowerCase(),
      absolute: String(css.position).toLowerCase() === "absolute",
      ...(token.name === "br" && { text: "\n" }),
      children: [],
    };
    parent.children.push(node);
    if (token.name !== "br") stack.push({ name: token.name, node });
  }
  const normalize = (node: SourceNode, blockifies = false) => {
    const flex = node.display === "flex" || node.display === "grid";
    let afterInline = node.display === "inline";
    node.children = node.children.filter((child) => {
      if (child.display === "none") return false;
      if (
        child.text !== undefined &&
        !child.style.pre &&
        !child.text.trim() &&
        (flex || !afterInline)
      )
        return false;
      if (!child.absolute)
        afterInline = child.display === "inline" || child.display === "inline-block";
      return true;
    });
    for (const child of node.children) normalize(child, flex);
    if ((blockifies || node.absolute) && node.display === "inline") node.display = "block";
  };
  normalize(root);
  return root;
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
    let blocks: SourceNode[] = [];
    const flush = () => {
      if (blocks.length)
        target.children.push({ style: n.style, texts: [], children: blocks.map(projection) });
      blocks = [];
    };
    for (const child of n.children.filter((c) => c.display !== "none")) {
      if (!inline(child) && child.display !== "inline-block" && !child.absolute) blocks.push(child);
      else {
        flush();
        flatten(child, target);
      }
    }
    flush();
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
    const holdsAbsolute = (n: SourceNode): boolean =>
      n.absolute || (inline(n) && n.children.some(holdsAbsolute));
    if (node.display !== "inline" && children.some(holdsAbsolute)) {
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
  const root = projection(sourceTree(source, variables));
  const descendants = (plan: Plan): Plan[] => [plan, ...plan.children.flatMap(descendants)];
  const matches = (node: MeasuredNode, plan: Plan): boolean => {
    const sources = runSources(plan.texts);
    let cursor = 0;
    for (const run of node.runs) {
      const at = sources.text.indexOf(run.text, cursor);
      if (at < 0 || sources.text.slice(cursor, at).trim()) return false;
      cursor = at + run.text.length;
    }
    return (
      !sources.text.slice(cursor).trim() &&
      node.children.length === plan.children.length &&
      node.children.every((child, i) => !!plan.children[i] && matches(child, plan.children[i]))
    );
  };
  const visit = (node: MeasuredNode, plan: Plan | undefined, ancestor: Plan) => {
    const location = plan ?? ancestor;
    const x = node.transform[4],
      y = node.transform[5];
    result.boxes.push({
      offset: location.style.offset,
      box: { x, y, width: node.width, height: node.height },
    });
    const sources = runSources(plan?.texts ?? []);
    let cursor = 0;
    for (const run of node.runs) {
      const at = sources.text.indexOf(run.text, cursor);
      const box = { x: x + run.x, y: y + run.y, width: run.width, height: run.height };
      if (at < 0 || sources.text.slice(cursor, at).trim()) {
        // No positional guessing. Search within the last unambiguous ancestor.
        // If repeated text has different owners, retain every candidate's style
        // for lint, but locate it at that ancestor rather than naming a sibling.
        const candidates = descendants(location).flatMap((p) => {
          const s = runSources(p.texts);
          const styles: HtmlTextStyle[] = [];
          for (
            let start = s.text.indexOf(run.text);
            start >= 0;
            start = s.text.indexOf(run.text, start + 1)
          )
            styles.push(...s.owners.slice(start, start + run.text.length));
          return styles;
        });
        const styles = [
          ...new Set(
            candidates.length
              ? candidates
              : descendants(location).flatMap((p) => p.texts.map((t) => t.style)),
          ),
        ];
        for (const style of styles.length ? styles : [location.style])
          result.texts.push({ ...style, offset: location.style.offset, text: run.text, box });
        continue;
      }
      const start = at;
      let pos = 0;
      while (pos < run.text.length) {
        const style = sources.owners[start + pos];
        if (!style) throw new Error("HTML run exceeded its matched source text.");
        let end = pos + 1;
        while (end < run.text.length && sources.owners[start + end] === style) end++;
        result.texts.push({ ...style, text: run.text.slice(pos, end), box });
        pos = end;
      }
      cursor = start + run.text.length;
    }
    const exactChildren =
      plan &&
      node.children.length === plan.children.length &&
      node.children.every(
        (child, index) => !!plan.children[index] && matches(child, plan.children[index]),
      );
    for (const [index, child] of node.children.entries()) {
      if (exactChildren) visit(child, plan.children[index], location);
      else {
        const candidates = descendants(location).filter((p) => p !== location && matches(child, p));
        visit(child, candidates.length === 1 ? candidates[0] : undefined, location);
      }
    }
  };
  visit(measured, root, root);
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
