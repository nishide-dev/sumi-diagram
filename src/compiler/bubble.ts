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
      let line = "";
      const append = (token: string) => {
        if (line.trim() && measure(line + token) > width) {
          let prefix = line.trimEnd();
          let suffix = token.trimStart();
          // Backtrack instead of overflowing the current line with closing
          // punctuation, or leaving an opening bracket at the end of a line.
          while (prefix && (forbiddenStart.test(suffix) || forbiddenEnd.test(prefix))) {
            const last = [...graphemes.segment(prefix)].at(-1)?.segment ?? "";
            prefix = prefix.slice(0, -last.length);
            suffix = last + suffix;
          }
          if (prefix.trim()) {
            lines.push(prefix.trimEnd());
            line = suffix;
          } else line += token;
        } else line += token;
      };
      // Math spans remain atomic so wrapping cannot change their meaning.
      for (const part of paragraph.split(/(\$[^$]*\$)/u)) {
        if (part.startsWith("$")) {
          append(part);
          continue;
        }
        for (const { segment } of words.segment(part)) {
          if (measure(segment) <= width) append(segment);
          else for (const char of graphemes.segment(segment)) append(char.segment);
        }
      }
      lines.push(line.trimEnd());
      return lines;
    })
    .join("\n");
}
