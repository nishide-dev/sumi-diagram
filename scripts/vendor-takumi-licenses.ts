/** The npm tarballs omit licenses. Vendor unmodified texts from the exact release commit. */

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const commit = "d482d86c081156760d72842fe28c31f8a0e8f64f"; // takumi@2.19.0
const root = join(import.meta.dir, "../assets/licenses/takumi");
await mkdir(root, { recursive: true });
for (const [source, name] of [
  ["LICENSE-MIT", "LICENSE-MIT"],
  ["LICENSE-APACHE", "LICENSE-APACHE"],
  ["THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.md"],
  ["takumi-core/LICENSE-CHROMIUM", "LICENSE-CHROMIUM"],
  ["takumi-core/LICENSE-EMOJI-SEGMENTER", "LICENSE-EMOJI-SEGMENTER"],
  ["takumi-core/LICENSE-ICU", "LICENSE-ICU"],
]) {
  const response = await fetch(
    `https://raw.githubusercontent.com/kane50613/takumi/${commit}/${source}`,
  );
  if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
  await Bun.write(join(root, name ?? ""), await response.text());
}
// Takumi's assets/fonts/OFL.txt belongs to Scheherazade, not its embedded Geist.
const geistCommit = "c40c1aec7e72b9ebdce65a4fccd03cb3950a359b";
const geist = await fetch(
  `https://raw.githubusercontent.com/vercel/geist-font/${geistCommit}/OFL.txt`,
);
if (!geist.ok) throw new Error(`Geist OFL: HTTP ${geist.status}`);
await Bun.write(join(root, "Geist-OFL.txt"), await geist.text());
// The source projection uses a character-reference decoder, not helpers/html's
// bundled ultrahtml parser. Copy the decoder's BSD-2-Clause notice verbatim.
const entitiesLicense = await Bun.file(
  new URL("../LICENSE", import.meta.resolve("entities")),
).text();
if (
  createHash("sha256").update(entitiesLicense).digest("hex") !==
  "cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164"
)
  throw new Error("Review the entities license before updating its pinned notice.");
await Bun.write(join(root, "entities-LICENSE.txt"), entitiesLicense);
await Bun.write(
  join(root, "README.md"),
  `# Takumi 2.19.0 notices\n\nUnmodified upstream license texts from https://github.com/kane50613/takumi/tree/${commit}.\nGeist-OFL.txt is from https://github.com/vercel/geist-font/blob/${geistCommit}/OFL.txt (Takumi's assets/fonts/OFL.txt is for Scheherazade, not Geist).\n\nBoth @takumi-rs/wasm and its transitive @takumi-rs/helpers dependency are MIT OR Apache-2.0. Sumi does not import helpers/html; its bundled ultrahtml parser is not reachable in the executable.\nThe WASM includes Geist (OFL), IJG JPEG algorithms, Chromium/Skia algorithms, emoji-segmenter and ICU. The upstream notice also includes native-only libwebp for completeness.\n\nHTML source projection uses Sumi's validated parse and entities 9.0.0 solely for character-reference decoding (no HTML parser). entities-LICENSE.txt is its unmodified BSD-2-Clause notice, copied from the pinned npm package and SHA-256 checked by the generation script.\n\nRegenerate with \`bun scripts/vendor-takumi-licenses.ts\`. Distributed in licenses/takumi/.\n`,
);
