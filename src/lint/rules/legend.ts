/** Rules on legends (#131, design doc §6.34) and the classes of matrices (#180, §6.56). */

import { refOwner } from "../../core/figure/schema";
import type { ResolvedComponent } from "../../core/registry/manifest";
import { defineRule, type LintFinding, type ValidElement } from "../rule";

/** The fields an entry's sample shares with what it explains, for messages. */
function describeFields(component: ResolvedComponent, tone: string | undefined): string {
  const fields = [component.id, `variant "${component.variant}"`];
  if (tone !== undefined) fields.push(`tone "${tone}"`);
  return fields.join(", ");
}

/** What a glyph sample has to share with the glyphs it explains: kind, strength and tones. */
function glyphSignature(glyph: {
  kind: string;
  strength?: string | undefined;
  tone?: string | undefined;
  tones?: readonly string[] | undefined;
}): string {
  // The tones in order without repeats: a vector of three blue cells has tone blue.
  const tones = [...new Set(glyph.tones ?? [glyph.tone ?? "none"])];
  return [glyph.kind, glyph.strength ?? "soft", ...tones].join(" ");
}

export const unusedLegendEntry = defineRule({
  id: "lint/unused-legend-entry",
  description:
    "A legend entry explains a line or box style that no edge or node of the figure uses.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { legends } = context.state.doc;
    if (legends === undefined) return [];
    // What the author drew: the elements that are not parts of a legend or
    // captions (the cells of tokens nodes, #181, and of matrices, #180, are
    // the author's nodes).
    const written = context.elements.filter(
      (e) => e.origin === undefined || e.origin.from === "tokens" || e.origin.from === "matrix",
    );
    const toneOf = (e: ValidElement) => e.element.tone;
    const findings: LintFinding[] = [];
    // The sets the author wrote (the swatches of legends are not).
    const swatches = new Set(legends.flatMap((l) => l.entries.map((e) => e.set?.id)));
    const writtenSets = (context.state.doc.sets ?? []).filter(
      (set) => set !== undefined && !swatches.has(set.id),
    );
    const writtenNodes = written.flatMap((e) => (e.kind === "node" ? [e.element] : []));
    const report = (
      legend: (typeof legends)[number],
      j: number,
      entry: (typeof legends)[number]["entries"][number],
      message: string,
      hint: string,
    ) =>
      findings.push({
        message: `Entry ${j + 1} of legend "${legend.id}" ("${entry.label}") ${message}`,
        path: entry.path,
        subject: { kind: "node", id: legend.id },
        hint,
      });
    for (const legend of legends) {
      for (const [j, entry] of legend.entries.entries()) {
        // A matrix class (#180) explains its cells: lint/unused-matrix-class
        // reports a class without cells.
        if (entry.class !== undefined) continue;
        if (entry.kind === "icon") {
          // An icon (#409) is explained by a node that draws it, as its icon or a badge.
          const used = writtenNodes.some(
            (n) => n.icon === entry.icon || n.badge?.icon === entry.icon,
          );
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no icon: no node of the figure draws ${entry.icon}.`,
              "Remove the entry, or give it the icon of the nodes it explains.",
            );
          }
          continue;
        }
        if (entry.kind === "glyph" && entry.glyph !== undefined) {
          // A glyph (#409): a node with a glyph of the same kind, strength and tones.
          const wanted = glyphSignature(entry.glyph);
          const used = writtenNodes.some((n) =>
            (n.glyphs ?? []).some((g) => glyphSignature(g) === wanted),
          );
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no glyph: no node of the figure has a ${entry.glyph.kind} glyph with the same ${entry.glyph.strength ?? "soft"} strength and tones.`,
              "Remove the entry, or give its glyph the kind, strength and tone (or tones) of the glyphs it explains.",
            );
          }
          continue;
        }
        if (entry.kind === "set" && entry.set !== undefined) {
          // A set swatch (#409): a set of the same variant and tone.
          const { variant, tone } = entry.set;
          const used = writtenSets.some((set) => set?.variant === variant && set.tone === tone);
          if (!used) {
            report(
              legend,
              j,
              entry,
              `explains no set: no set of the figure has variant "${variant}"${tone === undefined ? " and no tone" : ` and tone "${tone}"`}.`,
              "Remove the entry, or give its set fields the variant and tone of the sets it explains.",
            );
          }
          continue;
        }
        const sample = context.elements.find((e) => e.key === entry.sample);
        const component = sample?.component;
        if (sample === undefined || component === undefined) continue;
        const tone = toneOf(sample);
        const used = written.some(
          (e) =>
            e.kind === entry.kind &&
            e.component?.id === component.id &&
            e.component.variant === component.variant &&
            toneOf(e) === tone,
        );
        if (used) continue;
        const what = entry.kind === "edge" ? "edge" : "node";
        findings.push({
          message: `Entry ${j + 1} of legend "${legend.id}" ("${entry.label}") explains no ${what}: no ${what} of the figure has ${describeFields(component, tone)}.`,
          path: entry.path,
          subject: { kind: "node", id: legend.id },
          hint: `Remove the entry, or give its ${what} fields the component, variant and tone of the ${what}s it explains.`,
        });
      }
    }
    return findings;
  },
});

export const unusedMatrixClass = defineRule({
  id: "lint/unused-matrix-class",
  description: "A class of a matrix is used by none of its cells.",
  defaultSeverity: "warning",
  fixable: false,
  run(context) {
    const { matrices } = context.state.doc;
    if (matrices === undefined) return [];
    const findings: LintFinding[] = [];
    for (const matrix of matrices) {
      const used = new Set(matrix.parts.map((p) => p.class));
      for (const name of Object.keys(matrix.classes)) {
        if (used.has(name)) continue;
        findings.push({
          message: `Class "${name}" of matrix "${matrix.id}" is used by none of its cells.`,
          path: [...matrix.path, "props", "classes", name],
          subject: { kind: "node", id: matrix.id },
          hint: "Remove the class, or write its name in the cells it stands for.",
        });
      }
    }
    return findings;
  },
});

/**
 * The words that name each tone's colour (#643), so a label or caption with one can be
 * explaining that colour. Japanese words are whole colour words (青色, 青い, ブルー), never a
 * single character, which occurs inside unrelated words (特色, 青木, 赤字).
 */
const TONE_WORDS: Readonly<Record<string, RegExp>> = {
  red: /\bred\b|赤色|赤い|レッド/i,
  orange: /\borange\b|橙色|オレンジ/i,
  yellow: /\byellow\b|黄色|イエロー/i,
  green: /\bgreen\b|緑色|グリーン/i,
  blue: /\bblue\b|青色|青い|ブルー/i,
  purple: /\b(?:purple|violet)\b|紫色|パープル/i,
  pink: /\bpink\b|桃色|ピンク/i,
};

/** The words of a label that can name a category: 3 letters or more, without a plural s. */
function labelWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((w) => w.length >= 3).map((w) => w.replace(/s$/, "")));
}

/** Above this share of labelled nodes with a tone, the tones are a fill scheme by block type. */
const FILL_SCHEME_SHARE = 2 / 3;

export const unexplainedColors = defineRule({
  id: "lint/unexplained-colors",
  description:
    "Three or more colors are used and at least two of them mark a kind of element (edges, or nodes in different groups whose labels share no word), but the figure has no legend and some of those colors are named by no text.",
  defaultSeverity: "info",
  fixable: false,
  run(context) {
    const { doc } = context.state;
    if ((doc.legends?.length ?? 0) > 0) return [];
    // What the author drew (not the parts of captions, legends, tokens, matrices or sequences).
    const written = context.elements.filter((e) => e.origin === undefined && e.kind !== "group");
    const nodeTone = new Map<string, string | undefined>();
    let labelled = 0;
    let painted = 0;
    for (const e of written) {
      if (e.kind !== "node") continue;
      nodeTone.set(e.element.id, e.element.tone);
      if ((e.element.label ?? "").trim() === "") continue;
      labelled++;
      if (e.element.tone !== undefined) painted++;
    }
    const scheme = labelled > 0 && painted / labelled > FILL_SCHEME_SHARE;
    // Every chromatic tone, with the nodes and edges that paint it.
    const uses = new Map<string, ValidElement[]>();
    for (const e of written) {
      const tone = e.element.tone;
      if (tone === undefined || tone === "gray") continue;
      // An edge in the tone of one of its ends repeats that node's color (a vertex's edges).
      if (
        e.kind === "edge" &&
        [e.element.from, e.element.to].some((end) => nodeTone.get(refOwner(end)) === tone)
      )
        continue;
      uses.set(tone, [...(uses.get(tone) ?? []), e]);
    }
    if (uses.size < 3) return [];
    // A tone is a code when it marks a kind: two or more edges (an edge has no name to say
    // it), or labelled nodes in different groups whose labels share no word ("Attention").
    const coded = [...uses].filter(([, elements]) => {
      const edges = elements.filter((e) => e.kind === "edge");
      if (edges.length >= 2) return true;
      if (scheme) return false;
      const nodes = elements.flatMap((e) =>
        e.kind === "node" && (e.element.label ?? "").trim() !== "" ? [e.element] : [],
      );
      if (nodes.length < 2 || new Set(nodes.map((n) => n.group)).size < 2) return false;
      const [first, ...rest] = nodes.map((n) => labelWords(n.label ?? ""));
      return ![...(first ?? [])].some((word) => rest.every((words) => words.has(word)));
    });
    if (coded.length < 2) return [];
    // Text that names a tone's color may explain that tone (a caption, a note, a label); the
    // tones no text names stay unexplained.
    const texts = context.elements.flatMap((e) => {
      const element = e.element as { label?: string; sublabel?: string };
      return [element.label ?? "", element.sublabel ?? ""];
    });
    const named = (tone: string) => {
      const words = TONE_WORDS[tone];
      return words !== undefined && texts.some((text) => words.test(text));
    };
    const unexplained = coded.filter(([tone]) => !named(tone));
    if (unexplained.length === 0) return [];
    const describe = ([tone, elements]: [string, ValidElement[]]) => {
      const edges = elements.filter((e) => e.kind === "edge").length;
      const nodes = elements.length - edges;
      const parts = [
        ...(nodes > 0 ? [`${nodes} node${nodes === 1 ? "" : "s"}`] : []),
        ...(edges > 0 ? [`${edges} edge${edges === 1 ? "" : "s"}`] : []),
      ];
      return `${tone} (${parts.join(", ")})`;
    };
    const first = unexplained[0]?.[1][0] as ValidElement;
    const explained = coded.length - unexplained.length;
    return [
      {
        message: `${uses.size} colors are used and ${coded.length} of them mark a kind of element; ${unexplained.map(describe).join(", ")} ${unexplained.length === 1 ? "is" : "are"} explained by no legend and no text that names ${unexplained.length === 1 ? "its color" : "their colors"}${explained > 0 ? ` (${explained} other${explained === 1 ? " is" : "s are"} named in a label)` : ""}, so a reader cannot tell what ${unexplained.length === 1 ? "it means" : "they mean"}.`,
        path: [...first.path, "tone"],
        subject: first.subject,
        hint: "Add a legend (component: legend) with one entry per meaning; props.float: bottom-left (or another corner) floats it into free space without growing the figure. Or say what the colors mean in a label or caption. If the text around the figure explains them, ignore this info or turn the rule off in the lint configuration.",
        related: unexplained.flatMap(([tone, elements]) =>
          elements.slice(0, 1).map((e) => ({
            path: [...e.path, "tone"],
            message: `Tone ${tone} is used here.`,
          })),
        ),
      },
    ];
  },
});
