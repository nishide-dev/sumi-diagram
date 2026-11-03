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
 * - `figure.assets` (#310, design doc §6.91): each entry is checked like an
 *   image source (`asset/invalid-path`, the inline SVG importer); an image's
 *   `props.asset` must name one (`asset/unknown-asset`), takes no `sha256`,
 *   and `props.crop` needs an asset (`asset/invalid-crop`; the crop's bounds
 *   are checked against the SVG's viewBox when the asset is loaded).
 * - Inline `props.svg` uses the same allow-list importer, with the byte,
 *   element and depth budgets and diagnostics mapped into the YAML scalar.
 *
 * Nodes with an error are marked invalid (and so are their dependents).
 */

import { type CheckState, invalidateDependents, nodeKey } from "../core/check-state";
import { closestMatch, type Diagnostic } from "../core/diagnostics";
import { errorAt } from "../core/figure/report";
import type { Locator } from "../core/figure/yaml";
import { componentId } from "../core/registry/manifest";
import { isBlankForD2 } from "../core/registry/resolve";
import { htmlViewport, validateHtml } from "./html";
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
  for (const [name, def] of Object.entries(state.doc.figure?.assets ?? {})) {
    const base = ["figure", "assets", name];
    if (def.svg !== undefined) {
      checkSvgSource(state, locate, def.svg, [...base, "svg"], undefined);
    } else if (def.src !== undefined) {
      const problem = srcProblem(def.src);
      if (problem !== undefined) {
        state.diagnostics.push(
          errorAt(
            locate,
            "asset/invalid-path",
            `figure.assets.${name}.src "${def.src}" cannot be used: ${problem}.`,
            [...base, "src"],
            {
              hint: "Put the file in the figure's directory (or below it) and give its relative path.",
            },
          ),
        );
      }
    }
  }
  for (const [index, node] of (state.doc.nodes ?? []).entries()) {
    if (node === undefined) continue;
    const key = nodeKey(node.id);
    const component = components.get(key);
    if (component === undefined || state.invalid.has(key)) continue;
    const manifest = component.manifest;
    if (manifest.kind !== "node") continue;
    const subject = { kind: "node", id: node.id } as const;
    // A cell of a tokens node (#310) is located by the cell it was expanded from.
    const origin = state.doc.expanded?.get(key);
    const at: (string | number)[] = origin?.from === "tokens" ? [...origin.path] : ["nodes", index];
    const fail = (code: string, message: string, path: (string | number)[], hint?: string) => {
      state.diagnostics.push(errorAt(locate, code, message, [...at, ...path], { subject, hint }));
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
      if (typeof component.props.html === "string") {
        const path = ["nodes", index, "props", "html"];
        const issues = validateHtml(component.props.html);
        for (const issue of issues) {
          const location = locate(path, { span: [issue.offset, issue.offset], literalBlock: true });
          state.diagnostics.push({
            code: issue.code,
            severity: "error",
            message: issue.message,
            path,
            subject,
            ...(location && { location }),
          });
        }
        if (issues.length) {
          state.invalid.add(key);
          failed = true;
        }
        if (typeof component.props.viewport !== "string" || !htmlViewport(component.props.viewport))
          fail(
            "asset/invalid-image",
            "viewport must be WxH CSS pixels, at most 2048 per side and 2097152 pixels in total.",
            ["props", "viewport"],
          );
        continue;
      }
      const src = component.props.src;
      const svg = component.props.svg;
      const asset = component.props.asset;
      // Custom manifests need not enforce source exclusivity in their props schema.
      if ([src, svg, asset].filter((source) => typeof source === "string").length !== 1) {
        fail(
          "asset/invalid-image",
          "An image needs exactly one of props.src, props.svg or props.asset.",
          ["props"],
          "Provide a relative image path in src, inline SVG in svg, or the name of a figure.assets entry in asset.",
        );
        continue;
      }
      if (component.props.crop !== undefined && typeof asset !== "string") {
        fail(
          "asset/invalid-crop",
          "props.crop cuts a part out of a figure asset, so it needs props.asset.",
          ["props", "crop"],
          "Define the picture under figure.assets and name it in props.asset, or remove the crop.",
        );
        continue;
      }
      if (typeof svg === "string") {
        if (!checkSvgSource(state, locate, svg, [...at, "props", "svg"], subject)) {
          state.invalid.add(key);
          failed = true;
        }
        continue;
      }
      if (typeof asset === "string") {
        const names = state.doc.assetNames ?? Object.keys(state.doc.figure?.assets ?? {});
        if (!names.includes(asset)) {
          const near = closestMatch(asset, names);
          fail(
            "asset/unknown-asset",
            `props.asset "${asset}" is not defined in figure.assets.`,
            ["props", "asset"],
            near !== undefined
              ? `Did you mean "${near}"?`
              : names.length > 0
                ? `Defined assets: ${names.join(", ")}.`
                : "Define it under figure.assets first.",
          );
        }
        if (component.props.sha256 !== undefined) {
          fail(
            "asset/invalid-image",
            "props.sha256 cannot be used with props.asset; the asset is pinned by its own figure.assets entry.",
            ["props", "sha256"],
            "Write sha256 on the figure.assets entry.",
          );
        }
        continue;
      }
      if (typeof src !== "string") continue;
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

/**
 * Imports an inline SVG source once to check it, reporting each issue at its
 * position inside the YAML scalar at `path`. Returns whether it is accepted.
 */
function checkSvgSource(
  state: CheckState,
  locate: Locator,
  svg: string,
  path: (string | number)[],
  subject: Diagnostic["subject"],
): boolean {
  if (Buffer.byteLength(svg, "utf8") > ASSET_LIMITS.maxFileBytes) {
    state.diagnostics.push(
      errorAt(locate, "asset/too-large", "Inline SVG exceeds the 16 MiB asset limit.", path, {
        subject,
      }),
    );
    return false;
  }
  const imported = importSvg(svg);
  if (imported.ok) return true;
  const lines = svg.split("\n");
  for (const issue of imported.issues.slice(0, 20)) {
    const offset =
      lines.slice(0, issue.line - 1).reduce((n, s) => n + s.length + 1, 0) + issue.column - 1;
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
      ...(subject !== undefined && { subject }),
      hint: "Use plain shapes only; text must be outlined as paths. HTML, references, scripts, events, defs, gradients and filters are not supported.",
    });
  }
  return false;
}
