/**
 * Minimal HTML -> Satori vdom converter (ultrahtml parser only).
 * satori-html 0.3.2 throws under Bun 1.3.14 and trims every text node, which destroys
 * code whitespace, so the prototype uses this instead. Throwaway, not a proposal.
 */
import { ELEMENT_NODE, parse, TEXT_NODE } from "ultrahtml";

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
type V = { type: string; props: Record<string, unknown> } | string;

export function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    out[camel(decl.slice(0, i).trim())] = decl.slice(i + 1).trim();
  }
  return out;
}

function convert(node: any): V[] {
  if (node.type === TEXT_NODE) return [decode(node.value)];
  if (node.type !== ELEMENT_NODE) return (node.children ?? []).flatMap(convert);
  const { style, ...attrs } = node.attributes as Record<string, string>;
  const kids: V[] = (node.children as any[]).flatMap(convert);
  const hasElement = kids.some((k) => typeof k !== "string");
  const cleaned = kids.filter((k) => !(hasElement && typeof k === "string" && k.trim() === ""));
  const props: Record<string, unknown> = { ...attrs };
  if (style) props.style = parseStyle(style);
  props.children = cleaned.length === 1 ? cleaned[0] : cleaned;
  return [{ type: node.name, props }];
}

export function htmlToVdom(source: string): V {
  const doc = parse(source.trim());
  const roots = (doc.children as any[])
    .flatMap(convert)
    .filter((v) => typeof v !== "string" || v.trim());
  return roots[0] as V;
}
