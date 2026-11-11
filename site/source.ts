import { parseDocument } from "yaml";

/** Apply exactly the values used for the selected rendering, retaining YAML comments. */
export function sampleSource(
  source: string,
  theme: string,
  profile: string,
  palette?: string,
): string {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error(`Invalid sample YAML: ${doc.errors.join(", ")}`);
  doc.setIn(["figure", "theme"], theme);
  doc.setIn(["figure", "profile"], profile);
  if (palette !== undefined) doc.setIn(["figure", "themeOverrides", "palette"], palette);
  return doc.toString();
}
