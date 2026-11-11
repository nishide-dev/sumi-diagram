import { parseDocument } from "yaml";
import type { ComponentSample, ToneSample } from "../gallery/samples";
import { componentStem } from "../gallery/samples";

export { sampleSource } from "../../site/source";

const PAPER_URLS: Record<string, string> = {
  transformer: "https://arxiv.org/abs/1706.03762",
  "dit-block": "https://arxiv.org/abs/2212.09748",
};

export function paperUrl(slug: string, source: string): string | undefined {
  const leading = source.match(/^(?:[ \t]*(?:#[^\r\n]*)?\r?\n)*/)?.[0] ?? "";
  return (
    leading
      .match(/https?:\/\/(?:arxiv\.org|ai\.meta\.com)\/[^\s)\]>"']+/)?.[0]
      ?.replace(/[.,;]+$/, "") ?? PAPER_URLS[slug]
  );
}

export function exampleMetadata(slug: string, source: string) {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error(`Invalid example ${slug}: ${doc.errors.join(", ")}`);
  const figure = doc.get("figure", true);
  if (!figure) throw new Error(`Missing figure in example ${slug}`);
  const title = doc.getIn(["figure", "title"]);
  const theme = doc.getIn(["figure", "theme"]);
  const profile = doc.getIn(["figure", "profile"]);
  const url = paperUrl(slug, source);
  return {
    slug,
    title: title ?? slug,
    theme: theme ?? "minimal",
    profile: profile ?? "paper-single",
    source,
    ...(url && { paperUrl: url }),
  };
}

const profiles = (sample: ToneSample) =>
  Object.fromEntries(sample.renderings.map((r) => [r.theme, r.profile]));

export function componentData(sample: ComponentSample) {
  const { id, kind, variants, description, props } = sample.entry;
  return {
    id,
    slug: componentStem(sample.entry),
    kind,
    variants,
    description,
    props,
    source: sample.source,
    profiles: profiles(sample),
  };
}

export function optionData(sample: ToneSample, title: string, description: string) {
  return {
    slug: sample.fileName.replace(/\.sumi\.yaml$/, ""),
    title,
    description,
    source: sample.source,
    profiles: profiles(sample),
  };
}
