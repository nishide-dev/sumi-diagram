/**
 * Installs the pinned D2 CLI to `.sumi/bin/d2` (`bun run d2:install`).
 * With `--force`, reinstalls even if the pinned version is already present.
 */

import { resolve } from "node:path";
import { installD2 } from "../src/backends/d2/install";
import { D2_VERSION, MANAGED_D2_PATH } from "../src/backends/d2/version";

const destination = resolve(import.meta.dir, "..", MANAGED_D2_PATH);

try {
  const outcome = await installD2({
    destination,
    force: process.argv.includes("--force"),
    log: (message) => console.log(message),
  });
  console.log(
    outcome === "installed"
      ? `Installed D2 v${D2_VERSION} to ${MANAGED_D2_PATH}.`
      : `D2 v${D2_VERSION} is already installed at ${MANAGED_D2_PATH}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
