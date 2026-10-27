/**
 * Group captions (#130, design doc §6.32): `groups[].caption` is expanded
 * into a `label` node with the reserved ID `<group>-caption`, so the later
 * stages (component, asset, theme, profile, lint, IR) check and draw it like
 * any other label. Each engine then places it under the group's border: the
 * IR puts it below the group in the arrange tree (structured), and D2 draws it
 * as the label of a transparent container around the group (auto).
 *
 * The expansion runs after the `layout` stage, so the arrange trees and the
 * placement checks only ever see what the author wrote. Diagnostics about the
 * expanded node point at the `caption` field (see {@link captionLocator} and
 * {@link clampCaptionPaths}).
 */

import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  groupKey,
  invalidateDependents,
  nodeKey,
  type PartialFigure,
} from "../check-state";
import type { Diagnostic, DocPath } from "../diagnostics";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import type { FigureNode } from "./schema";
import type { Locator } from "./yaml";

/** Suffix of the reserved ID of a group's caption node: `<group>-caption`. */
export const CAPTION_ID_SUFFIX = "-caption";

/** The reserved ID of the caption node of group `groupId`. */
export function captionId(groupId: string): string {
  return `${groupId}${CAPTION_ID_SUFFIX}`;
}

/** Where an expanded caption node comes from. */
export interface CaptionOrigin {
  /** The captioned group's ID. */
  group: string;
  /** `["groups", <index>, "caption"]`. */
  path: DocPath;
}

/**
 * Runs the expansion on `state.doc`: appends one `label` node per readable,
 * valid group with a caption, and records its origin in `doc.captions`. A
 * node or group that already uses the reserved ID is an error
 * (`ref/reserved-id`) and the caption is not expanded.
 */
export function expandCaptions(state: CheckState, locate: Locator): void {
  const { doc, invalid } = state;
  const { groups, nodes } = doc;
  if (groups === undefined || nodes === undefined) return;
  const taken = takenIds(doc);
  const captions = new Map<number, CaptionOrigin>();
  const origins: [ElementKey, ExpandedOrigin][] = [];
  for (const [index, group] of groups.entries()) {
    if (group?.caption === undefined || invalid.has(groupKey(group.id))) continue;
    const id = captionId(group.id);
    const captionPath: DocPath = ["groups", index, "caption"];
    const name = `the caption of group "${group.id}"`;
    const owner = taken.get(id);
    if (owner !== undefined) {
      reportReservedId(state, locate, {
        id,
        owner,
        reservedFor: name,
        related: { path: captionPath, message: "The caption is written here." },
      });
      continue;
    }
    // An unreadable element may hold the ID: its own error explains the figure.
    if (invalid.has(nodeKey(id)) || invalid.has(groupKey(id))) continue;
    const node: FigureNode = {
      id,
      component: "sumi/label",
      label: group.caption,
      variant: "default",
      props: {},
      ...(group.group !== undefined && { group: group.group }),
    };
    captions.set(nodes.length, { group: group.id, path: captionPath });
    origins.push([
      nodeKey(id),
      { from: "caption", path: captionPath, subject: { kind: "group", id: group.id }, name },
    ]);
    nodes.push(node);
  }
  if (captions.size > 0) doc.captions = captions;
  recordExpanded(doc, origins);
  invalidateDependents(state);
}

/**
 * The path a diagnostic about an expanded caption node should carry: the
 * `caption` field itself for the node or any of its fields (its `label` is
 * the caption's text), otherwise `path` unchanged.
 */
export function captionPath(doc: PartialFigure, path: DocPath): DocPath {
  if (doc.captions === undefined || path[0] !== "groups" || path[2] !== "caption") return path;
  return path.length > 3 ? path.slice(0, 3) : path;
}

/** A locator that resolves paths into an expanded caption node to the `caption` field. */
export function captionLocator(doc: PartialFigure, locate: Locator): Locator {
  return (path, options) => locate(captionPath(doc, path), options);
}

/** Rewrites the paths of diagnostics (and their related entries) into caption nodes, in place. */
export function clampCaptionPaths(doc: PartialFigure, diagnostics: Diagnostic[]): void {
  if (doc.captions === undefined) return;
  for (const diagnostic of diagnostics) {
    if (diagnostic.path !== undefined) diagnostic.path = captionPath(doc, diagnostic.path);
    for (const related of diagnostic.related ?? []) {
      if (related.path !== undefined) related.path = captionPath(doc, related.path);
    }
  }
}
