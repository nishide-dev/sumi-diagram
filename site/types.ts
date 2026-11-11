import type { componentData, exampleMetadata, optionData } from "../scripts/site/data";

export interface SiteData {
  version: string;
  themes: readonly string[];
  palettes: { id: string; colors: readonly string[] }[];
  components: ReturnType<typeof componentData>[];
  options: ReturnType<typeof optionData>[];
  examples: ReturnType<typeof exampleMetadata>[];
}

export async function loadData(): Promise<SiteData> {
  const response = await fetch("./data.json");
  if (!response.ok) throw new Error(`Could not load site data: ${response.status}`);
  return (await response.json()) as SiteData;
}
