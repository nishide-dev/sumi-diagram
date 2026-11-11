import type { componentData, optionData } from "../scripts/site/data";

export interface ExampleData {
  slug: string;
  title: string;
  theme: string;
  profile: string;
  source: string;
  paperUrl?: string;
}

export interface SiteData {
  version: string;
  themes: readonly string[];
  palettes: { id: string; colors: readonly string[] }[];
  components: ReturnType<typeof componentData>[];
  options: ReturnType<typeof optionData>[];
  examples: ExampleData[];
}

export async function loadData(): Promise<SiteData> {
  const response = await fetch("./data.json");
  if (!response.ok) throw new Error(`Could not load site data: ${response.status}`);
  return (await response.json()) as SiteData;
}
