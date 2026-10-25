/**
 * Registry facts for the candidate libraries (layout engines, constraint
 * solvers, math typesetting, icon and emoji sets). Versions are pinned in
 * PINNED below: the `latest` dist-tag on 2026-10-26 when this research ran.
 * `--discover` prints the current `latest` so a re-run can notice drift; the
 * recorded report keeps the pinned versions.
 */

export const PINNED: Record<string, string> = {
  // layout / constraint solving
  elkjs: "0.12.0",
  "@dagrejs/dagre": "3.1.3",
  webcola: "3.4.0",
  "@lume/kiwi": "0.4.4",
  // math typesetting
  "mathjax-full": "3.2.2",
  "@mathjax/src": "4.1.3",
  katex: "0.19.1",
  // icons / logos / emoji
  "lucide-static": "1.61.0",
  "@tabler/icons": "3.49.0",
  "@material-symbols/svg-400": "0.48.1",
  "@phosphor-icons/core": "2.1.1",
  "simple-icons": "16.35.0",
  "@twemoji/svg": "15.0.0",
  openmoji: "17.0.0",
  "@iconify/json": "2.2.547",
};

export interface PackageFacts {
  name: string;
  version: string;
  license: unknown;
  unpackedSize?: number;
  fileCount?: number;
  integrity?: string;
  tarball?: string;
  dependencies: string[];
}

export async function packageFacts(name: string, version: string): Promise<PackageFacts> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/${version || "latest"}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}@${version}: ${response.status}`);
  const doc = (await response.json()) as {
    version: string;
    license?: unknown;
    licenses?: unknown;
    dependencies?: Record<string, string>;
    dist?: { unpackedSize?: number; fileCount?: number; integrity?: string; tarball?: string };
  };
  return {
    name,
    version: doc.version,
    license: doc.license ?? doc.licenses ?? null,
    ...(doc.dist?.unpackedSize !== undefined && { unpackedSize: doc.dist.unpackedSize }),
    ...(doc.dist?.fileCount !== undefined && { fileCount: doc.dist.fileCount }),
    ...(doc.dist?.integrity !== undefined && { integrity: doc.dist.integrity }),
    ...(doc.dist?.tarball !== undefined && { tarball: doc.dist.tarball }),
    dependencies: Object.keys(doc.dependencies ?? {}),
  };
}

export async function allPackageFacts(): Promise<PackageFacts[]> {
  const out: PackageFacts[] = [];
  for (const [name, version] of Object.entries(PINNED)) out.push(await packageFacts(name, version));
  return out;
}

if (import.meta.main) console.log(JSON.stringify(await allPackageFacts(), null, 2));
