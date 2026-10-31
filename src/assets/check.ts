/**
 * Stage `asset` (#94, design doc §6.25): the checks of icons and images that
 * need no file system. It runs after the `component` stage (it needs each
 * node's manifest) and before `theme`.
 *
 * - `icon` (`<set>/<name>`): the set must be bundled (`asset/unknown-icon-set`)
 *   and have the icon (`asset/unknown-icon`, with the closest names as a
 *   hint). An icon is drawn in place of the label, so a node with an icon
 *   takes no label (`asset/icon-with-label`), and only plain shapes take one:
 *   not marks, outline components or images (`asset/icon-unsupported`).
 * - `sumi/image`: `props.src` must be a relative path that stays in the
 *   figure's directory (`asset/invalid-path`). Whether the file exists, its
 *   format, size and sha256 are checked when the figure is rendered
 *   (`loadFigureAssets()`).
 * - Inline `props.svg` uses the same allow-list importer, with the byte,
 *   element and depth budgets and diagnostics mapped into the YAML scalar.
 *
 * Nodes with an error are marked invalid (and so are their dependents).
 */

import { type CheckState, invalidateDependents, nodeKey } from "../core/check-state";
import { closestMatch } from "../core/diagnostics";
import { errorAt } from "../core/figure/report";
import type { Locator } from "../core/figure/yaml";
import { componentId } from "../core/registry/manifest";
import { isBlankForD2 } from "../core/registry/resolve";
import { parseIconRef } from "./icon-ref";
import { IconArchiveError, iconExclusion, iconNames, iconSet, iconSets, iconSvg } from "./icons";
import { ASSET_LIMITS } from "./load";
import { srcProblem } from "./paths";
import { importSvg } from "./svg-import";

/** Runs the `asset` stage. */
export function checkAssets(state: CheckState, locate: Locator): void {
  const components = state.components;
  if (components === undefined) return;
  let failed = false;
  for (const [index, node] of (state.doc.nodes ?? []).entries()) {
    if (node === undefined) continue;
    const key = nodeKey(node.id);
    const component = components.get(key);
    if (component === undefined || state.invalid.has(key)) continue;
    const manifest = component.manifest;
    if (manifest.kind !== "node") continue;
    const subject = { kind: "node", id: node.id } as const;
    const fail = (code: string, message: string, path: (string | number)[], hint?: string) => {
      state.diagnostics.push(
        errorAt(locate, code, message, ["nodes", index, ...path], { subject, hint }),
      );
      state.invalid.add(key);
      failed = true;
    };

    for (const [field, value] of [
      ["badge", node.badge?.icon],
      ["icon", node.icon],
    ] as const) {
      if (value === undefined) continue;
      const path = field === "badge" ? ["badge", "icon"] : ["icon"];
      const ref = parseIconRef(value);
      if (ref === undefined) throw new Error(`internal error: malformed icon "${value}"`);
      if (
        field === "icon" &&
        (manifest.mark !== undefined || manifest.render !== undefined || manifest.embed)
      ) {
        fail(
          "asset/icon-unsupported",
          `${componentId(manifest)} cannot draw an icon; icons go on plain shapes such as box, circle or label.`,
          ["icon"],
          "Remove the icon, or use a box, circle or label node for it.",
        );
        continue;
      }
      if (field === "icon" && !isBlankForD2(node.label)) {
        fail(
          "asset/icon-with-label",
          `Node "${node.id}" has both an icon and a label; the icon is drawn in place of the label.`,
          ["icon"],
          "Remove the label, or put the text in a label node attached beside the icon.",
        );
        continue;
      }
      let known: boolean;
      try {
        known = iconSvg(ref.set, ref.name) !== undefined;
      } catch (error) {
        if (!(error instanceof IconArchiveError)) throw error;
        fail(
          "asset/icons-unavailable",
          `The bundled icons cannot be used: ${error.message}.`,
          path,
        );
        continue;
      }
      if (!known) {
        const exclusion = iconExclusion(ref.set, ref.name);
        if (exclusion !== undefined) {
          fail(
            "asset/unsupported-icon",
            `The icon "${ref.set}/${ref.name}" exists upstream but is excluded from Sumi: ${exclusion}`,
            path,
            "Choose a supported name with `sumi catalog --icons <word>`; clipping, references, gradients and filters are not supported.",
          );
          continue;
        }
        if (iconSet(ref.set) === undefined) {
          fail(
            "asset/unknown-icon-set",
            `Unknown icon set "${ref.set}".`,
            path,
            `Bundled sets: ${iconSets()
              .map((s) => s.id)
              .join(", ")}.`,
          );
        } else {
          const near = closestMatch(ref.name, iconNames(ref.set));
          fail(
            "asset/unknown-icon",
            `The icon set "${ref.set}" has no icon "${ref.name}".`,
            path,
            near === undefined
              ? "List the icons with `sumi catalog --icons <word>`."
              : `Did you mean "${ref.set}/${near}"?`,
          );
        }
      }
    }

    if (manifest.embed === "image") {
      const svg = component.props.svg;
      if (typeof svg === "string") {
        const path = ["nodes", index, "props", "svg"];
        if (Buffer.byteLength(svg, "utf8") > ASSET_LIMITS.maxFileBytes) {
          fail("asset/too-large", "Inline SVG exceeds the 16 MiB asset limit.", ["props", "svg"]);
          continue;
        }
        const imported = importSvg(svg);
        if (!imported.ok) {
          const lines = svg.split("\n");
          for (const issue of imported.issues.slice(0, 20)) {
            const offset =
              lines.slice(0, issue.line - 1).reduce((n, s) => n + s.length + 1, 0) +
              issue.column -
              1;
            const location = locate(path, { span: [offset, offset], literalBlock: true });
            state.diagnostics.push({
              code:
                issue.kind === "unsafe"
                  ? "asset/unsafe-svg"
                  : issue.kind === "unsupported"
                    ? "asset/unsupported-svg"
                    : "asset/invalid-image",
              severity: "error",
              message: issue.message,
              path,
              ...(location !== undefined && { location }),
              subject,
              hint: "Use plain shapes only; text must be outlined as paths. HTML, references, scripts, events, defs, gradients and filters are not supported.",
            });
          }
          state.invalid.add(key);
          failed = true;
        }
        continue;
      }
      const src = component.props.src;
      if (typeof src !== "string") throw new Error("internal error: image without props.src");
      const problem = srcProblem(src);
      if (problem !== undefined) {
        fail(
          "asset/invalid-path",
          `props.src "${src}" cannot be used: ${problem}.`,
          ["props", "src"],
          "Put the file in the figure's directory (or below it) and give its relative path.",
        );
      }
    }
  }
  if (!failed) return;
  invalidateDependents(state);
  for (const key of components.keys()) if (state.invalid.has(key)) components.delete(key);
}
