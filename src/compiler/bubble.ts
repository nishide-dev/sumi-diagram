import type { FontSet } from "../core/theme/fonts";
import type { CommonStyle } from "../core/theme/style";
import { fontSetMeasurer, measureText } from "../layout/text";

/** Font-aware wrapping, with Japanese line-start/line-end punctuation kept together. */
export function wrapBubbleText(
  text: string,
  width: number,
  style: CommonStyle,
  fonts: FontSet,
): string {
  const measurer = fontSetMeasurer(fonts);
  const measure = (s: string) => measureText(s, style, measurer)?.width ?? 0;
  const forbiddenStart =
    /^[、。，．！？：；）］｝〉》」』】ーぁぃぅぇぉっゃゅょァィゥェォッャュョ]/u;
  const forbiddenEnd = /[（［｛〈《「『【]$/u;
  const words = new Intl.Segmenter("ja", { granularity: "word" });
  const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });
  return text
    .split("\n")
    .flatMap((paragraph) => {
      const lines: string[] = [];
      let line: string[] = [];
      const append = (tokens: string[]) => {
        let limit = line.length;
        line.push(...tokens);
        // Refit the suffix too: moving an opening bracket may make it wider
        // than the original word. Every split is between atomic label tokens.
        while (line.length > 1 && measure(line.join("")) > width) {
          if (limit === 0) limit = line.length - 1;
          let fallback = 0;
          let split = 0;
          for (let i = Math.min(limit, line.length - 1); i > 0; i--) {
            const prefix = line.slice(0, i).join("").trimEnd();
            const suffix = line.slice(i).join("").trimStart();
            if (!prefix || measure(prefix) > width) continue;
            if (!fallback) fallback = i;
            if (!forbiddenStart.test(suffix) && !forbiddenEnd.test(prefix)) {
              split = i;
              break;
            }
          }
          // If the preferred word boundary cannot work, split inside the
          // incoming word before relaxing punctuation constraints.
          if (!split) {
            for (let i = line.length - 1; i > limit; i--) {
              const prefix = line.slice(0, i).join("").trimEnd();
              const suffix = line.slice(i).join("").trimStart();
              if (
                prefix &&
                measure(prefix) <= width &&
                !forbiddenStart.test(suffix) &&
                !forbiddenEnd.test(prefix)
              ) {
                split = i;
                break;
              }
            }
          }
          // Width wins when punctuation rules cannot be satisfied. Only an
          // oversized single grapheme or formula may exceed the maximum.
          split ||= fallback || 1;
          const prefix = line.slice(0, split).join("").trimEnd();
          if (prefix) lines.push(prefix);
          line = line.slice(split);
          while (line[0]?.trim() === "") line.shift();
          limit = line.length - 1;
        }
      };
      // Outside math only \$ is escaped; inside math a backslash escapes
      // the next character, matching the label parser's closing-dollar rule.
      for (const part of paragraph.split(/(\\\$|\$(?:\\.|[^$\\])*\$)/u)) {
        if (part.startsWith("$") || part === "\\$") {
          append([part]);
          continue;
        }
        for (const { segment } of words.segment(part)) {
          const tokens = [...graphemes.segment(segment)].map((char) => char.segment);
          if (measure(segment) <= width) append(tokens);
          else for (const token of tokens) append([token]);
        }
      }
      lines.push(line.join("").trimEnd());
      return lines;
    })
    .join("\n");
}
