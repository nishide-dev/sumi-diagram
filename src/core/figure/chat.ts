/** Expand only the supporting visuals; authored bubble IDs remain intact. */
import { type CheckState, type ElementKey, nodeKey } from "../check-state";
import type { DocPath } from "../diagnostics";
import { getProfile } from "../profile/builtin";
import { spacedProfile } from "../profile/schema";
import { recordExpanded, takenIds } from "./expand";
import { errorAt } from "./report";
import { type ArrangeBox, type Chat, type FigureNode, NodeSchema } from "./schema";
import type { Locator } from "./yaml";

export interface ChatRow {
  node: string;
  side?: "left" | "right";
  avatar?: string;
  meta?: string;
  runStart: boolean;
  /** Reserve the speaker's avatar slot even on subsequent messages. */
  indentAvatar?: string;
  path: DocPath;
}
export interface ChatExpansion {
  spec: Chat;
  widthPt: number;
  rows: ChatRow[];
}

export function expandChats(state: CheckState, locate: Locator, raw: unknown): void {
  const { doc } = state;
  if (!doc.nodes || !doc.figure || doc.figure.layout.engine !== "structured") return;
  const profile = getProfile(doc.figure.profile) ?? getProfile("paper-single");
  if (!profile) return;
  const spacing = spacedProfile(profile, doc.figure.layout.density);
  const nodes = doc.nodes;
  const taken = takenIds(doc);
  const expansions: ChatExpansion[] = [];
  const usedAvatars = new Set<string>();
  const writtenNodes = (raw as { nodes?: { variant?: string }[] })?.nodes;
  const generated = (node: FigureNode, path: DocPath): string => {
    if (taken.has(node.id)) {
      state.diagnostics.push(
        errorAt(locate, "ref/reserved-id", `ID "${node.id}" is reserved for chat visuals.`, path),
      );
      return node.id;
    }
    taken.set(node.id, path);
    nodes.push(node);
    recordExpanded(doc, [
      [
        nodeKey(node.id),
        {
          from: "chat",
          path,
          subject: { kind: "figure", id: doc.figure?.id ?? "" },
          name: "a chat visual",
        },
      ],
    ]);
    return node.id;
  };
  const walk = (box: ArrangeBox, path: DocPath) => {
    if (box.chat) {
      const spec = box.chat;
      const widthPt =
        spec.width ??
        (profile.page.maxWidth?.pt ?? 240) -
          profile.margin.pt * 2 -
          spacing.layout.groupPadding.pt * 2;
      const expansion: ChatExpansion = { spec, widthPt, rows: [] };
      expansions.push(expansion);
      let previous: string | undefined;
      const prefix = `chat-${expansions.length}`;
      for (const [name, speaker] of Object.entries(spec.speakers)) {
        if (
          speaker.avatar &&
          !nodes.some((n) => n?.id === speaker.avatar) &&
          !state.invalid.has(nodeKey(speaker.avatar))
        )
          state.diagnostics.push(
            errorAt(
              locate,
              "layout/chat-unknown-avatar",
              `Unknown chat avatar "${speaker.avatar}".`,
              [...path, "chat", "speakers", name, "avatar"],
            ),
          );
      }
      for (const [i, item] of spec.items.entries()) {
        const at = [...path, "chat", "items", i];
        if ("divider" in item) {
          const node = generated(
            NodeSchema.parse({
              id: `${prefix}-${i + 1}-divider`,
              component: "bubble",
              variant: "filled",
              tone: "gray",
              label: item.divider,
              props: { tail: "none" },
            }),
            [...at, "divider"],
          );
          expansion.rows.push({ node, runStart: true, path: at });
          previous = undefined;
          continue;
        }
        const speaker = Object.hasOwn(spec.speakers, item.from)
          ? spec.speakers[item.from]
          : undefined;
        const runStart = previous !== item.from;
        previous = item.from;
        if (!speaker)
          state.diagnostics.push(
            errorAt(locate, "layout/chat-unknown-speaker", `Unknown chat speaker "${item.from}".`, [
              ...at,
              "from",
            ]),
          );
        const index = nodes.findIndex((n) => n?.id === item.node);
        const n = nodes[index];
        if (!n && doc.groups?.some((g) => g?.id === item.node))
          state.diagnostics.push(
            errorAt(
              locate,
              "layout/chat-non-bubble",
              `Chat message "${item.node}" must be a bubble node, not a group.`,
              [...at, "node"],
            ),
          );
        if (n && !state.invalid.has(nodeKey(n.id))) {
          if (!["bubble", "sumi/bubble"].includes(n.component)) {
            state.diagnostics.push(
              errorAt(
                locate,
                "layout/chat-non-bubble",
                `Chat message "${n.id}" must use the bubble component.`,
                [...at, "node"],
              ),
            );
          } else if (speaker) {
            nodes[index] = {
              ...n,
              textAlign: "left",
              variant:
                writtenNodes?.[index]?.variant ??
                speaker.variant ??
                (speaker.side === "right" ? "filled" : "default"),
              tone: n.tone ?? speaker.tone ?? (speaker.side === "right" ? "gray" : undefined),
              props: { ...n.props, tail: runStart ? speaker.side : "none", tailAt: "start" },
            };
          }
        }
        let avatar: string | undefined;
        const template = nodes.find((n) => n?.id === speaker?.avatar);
        if (template && runStart) {
          avatar = usedAvatars.has(template.id)
            ? generated({ ...template, id: `${prefix}-${i + 1}-avatar`, group: undefined }, [
                ...path,
                "chat",
                "speakers",
                item.from,
                "avatar",
              ])
            : template.id;
          usedAvatars.add(template.id);
        }
        const meta =
          item.meta === undefined
            ? undefined
            : generated(
                NodeSchema.parse({
                  id: `${prefix}-${i + 1}-meta`,
                  component: "label",
                  variant: "muted",
                  label: Array.isArray(item.meta) ? item.meta.join("\n") : item.meta,
                  textAlign: speaker?.side === "right" ? "right" : "left",
                }),
                [...at, "meta"],
              );
        expansion.rows.push({
          node: item.node,
          side: speaker?.side ?? "left",
          runStart,
          ...(avatar && { avatar }),
          ...(meta && { meta }),
          ...(template && { indentAvatar: template.id }),
          path: at,
        });
      }
      return;
    }
    for (const kind of ["stack", "row", "grid", "place"] as const) {
      box[kind]?.items.forEach((cell, i) => {
        const wrapped = cell !== null && typeof cell === "object" && "item" in cell;
        const item = wrapped ? cell.item : cell;
        if (item !== null && typeof item === "object")
          walk(item, [...path, kind, "items", i, ...(wrapped ? ["item"] : [])]);
      });
    }
  };
  if (doc.figure.layout.arrange) walk(doc.figure.layout.arrange, ["figure", "layout", "arrange"]);
  doc.groups?.forEach((g, i) => {
    if (g?.arrange) walk(g.arrange, ["groups", i, "arrange"]);
  });
  if (expansions.length) doc.chats = expansions;
}

export function chatKeys(row: ChatRow): string[] {
  return [row.node, ...(row.avatar ? [row.avatar] : []), ...(row.meta ? [row.meta] : [])];
}

export function chatVisuals(state: CheckState): Map<ElementKey, "meta" | "divider"> {
  const result = new Map<ElementKey, "meta" | "divider">();
  for (const chat of state.doc.chats ?? [])
    for (const row of chat.rows) {
      if (!row.side) result.set(nodeKey(row.node), "divider");
      if (row.meta) result.set(nodeKey(row.meta), "meta");
    }
  return result;
}
