/** Prints sha256 of every generated SVG; compare Bun vs Node and run-to-run. */
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { base, satoriSvg, sourceHtml, takumi } from "./gen";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const out: Record<string, string> = {};
for (const dir of ["html", "html-safe"])
  for (const f of readdirSync(join(base, dir))
    .filter((x) => x.endsWith(".html"))
    .sort()) {
    const name = f.replace(".html", "");
    const src = sourceHtml(dir, name);
    out[`${dir}/${name}.takumi`] = sha(await takumi(src));
    out[`${dir}/${name}.satori`] = sha(await satoriSvg(src));
    out[`${dir}/${name}.satori-text`] = sha(await satoriSvg(src, false));
  }
console.log(JSON.stringify(out, null, 1));
