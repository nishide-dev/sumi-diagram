/**
 * Matrices (#180, design doc §6.56): a `sumi/matrix` node is a grid of cells
 * colored by class (an attention mask, a confusion pattern, …) with optional
 * row and column headers. Like a legend (#131) it is expanded into a frame
 * group with the matrix's ID (a `sumi/container` in the `plain` variant: no
 * border, no fill), so edges, `attach.to` and arrange trees name the matrix
 * as a whole, and the frame lays out ordinary nodes:
 *
 * - one box per cell, with the reserved ID `<matrix>-<row>-<column>`
 *   (1-based), the cell size, and its class's tone and variant (a hatched
 *   class's cells are marked in `doc.paints`, and the theme stage gives
 *   them a hatch color);
 * - one label per header: `<matrix>-row-<r>`, `<matrix>-col-<c>` and
 *   `<matrix>-corner` (a header's tone colors its text, also through
 *   `doc.paints`).
 *
 * The frame's arrange tree puts each row's cells in a row box (gap `gap`)
 * and the rows in a stack (gap `gap`), the row headers beside them
 * (`headerGap`) and the column headers above or below (`headerGap`). Row
 * headers are as high as a cell, so the cells are evenly spaced down and
 * across; column headers are as wide as a cell, so they are centered over
 * their columns. The stacks are aligned on the cells' side (`end` with the
 * row headers on the left), so headers of different widths stay beside the
 * cells.
 *
 * Since 0.20.0 (#612): `labelAt: above*` draws the title outside the frame,
 * which then has no padding (as `flush`), so edges reach the headers and
 * cells; `wrapHeaders` breaks header text to the column (or `headerWidth`)
 * in the IR, where the font is known (`MatrixPartExpansion.wrap`); `rules`
 * draws the cells without borders (`doc.paints` `borderless`) between three
 * `sumi/separator` rules, `<matrix>-rule-top`, `-rule-mid` (thin, under the
 * column headers) and `-rule-bottom`; and a cell whose variant is `muted` is
 * drawn pale (`doc.paints` `pale`).
 *
 * Since 0.20.1 (#644): cells written `{ value }` are colored by `scale`, a
 * ramp of one tone (`doc.paints` `ramp`, see `rampStyle()`), and a legend
 * explains it as `{ scale: <matrix> }`; a cell with `span` covers several
 * slots (the cells are then placed by a `place` box, see `matrixGrid()`); and
 * `headerRotate` turns the column headers (`labelRotation`).
 *
 * The expansion runs after the `component` stage (the props are validated
 * there: known classes, rows of one length, one header per row and column),
 * resolves the parts through the same stage and records each part's origin
 * (`doc.expanded`) and where its fields are written (`fields`, as for the
 * cells of tokens, #181), so diagnostics point at the written row, header or
 * class. Matrices need the structured engine (the manifest's `engines`) and
 * are placed in an arrange tree, never by `attach`.
 */

import {
  type CheckState,
  type ElementKey,
  type ExpandedOrigin,
  type ExpandedPaint,
  groupKey,
  invalidateDependents,
  nodeKey,
} from "../check-state";
import { type DocPath, didYouMean } from "../diagnostics";
import {
  type MATRIX_HEADER_ROTATIONS,
  MATRIX_ID,
  type MATRIX_LABEL_POSITIONS,
  type MatrixEntry,
  type MatrixSlot,
  matrixGrid,
  SEPARATOR_ID,
} from "../registry/builtins";
import type { Registry } from "../registry/registry";
import { isBlankForD2, resolveComponents } from "../registry/resolve";
import type { Tone } from "../theme/tones";
import { recordExpanded, reportReservedId, takenIds } from "./expand";
import { errorAt } from "./report";
import {
  type ArrangeBox,
  type ArrangeItem,
  type FigureGroup,
  type FigureNode,
  ID_PATTERN,
} from "./schema";
import type { CellFields } from "./tokens";
import type { Locator } from "./yaml";

/** A class of `props.classes`, as validated by the manifest. */
export interface MatrixClass {
  tone?: Tone;
  variant?: string;
  pattern?: "hatch";
  label?: string;
}

/** A header of `props.rows` / `props.columns`, as validated by the manifest. */
export type MatrixHeader = string | { label: string; tone?: Tone };

/** A matrix's color scale (#644), as validated by the manifest. */
export interface MatrixScale {
  from: number;
  to: number;
  tone?: Tone;
  steps?: number;
  decimals?: number;
  showValues?: boolean;
  label?: string;
}

/** The tone of a scale without one (#644). */
export const MATRIX_SCALE_TONE: Tone = "blue";

/** The variant of the cells a scale colors (#644): the theme's tone fill, recolored by `ramp`. */
export const MATRIX_SCALE_VARIANT = "filled";

/** The props of a matrix node, as validated by the manifest. */
export interface MatrixProps {
  cells: (string | (string | MatrixEntry)[])[];
  /** 1-based rows / columns drawn as ellipsis (#280). */
  ellipsisRows?: number[];
  ellipsisColumns?: number[];
  classes?: Record<string, MatrixClass>;
  /** Colors cells written `{ value }` (#644). */
  scale?: MatrixScale;
  /** Turns the column headers (#644). */
  headerRotate?: (typeof MATRIX_HEADER_ROTATIONS)[number];
  rows?: MatrixHeader[];
  columns?: MatrixHeader[];
  corner?: string;
  rowsAt: "left" | "right";
  columnsAt: "top" | "bottom";
  /** pt */
  cellWidth?: number;
  /** pt */
  cellHeight?: number;
  /** pt */
  gap?: number;
  /** pt */
  headerGap?: number;
  /** pt */
  headerWidth?: number;
  variant?: string;
  /** No group padding around the cells (#280). */
  flush?: boolean;
  /** Where the title sits (#612): `top` inside the frame, `above*` outside it. */
  labelAt?: (typeof MATRIX_LABEL_POSITIONS)[number];
  /** Break header text to fit (#612). */
  wrapHeaders?: boolean;
  /** pt: the width column headers wrap to (#612). */
  columnHeaderWidth?: number;
  /** A table with rules only (#612). */
  rules?: boolean;
}

/** The component of a matrix's cells. */
const CELL_COMPONENT = "sumi/box";

/** The variant a matrix draws pale (#612): its cells and their legend samples. */
export const MUTED_VARIANT = "muted";

/** The cell width when `cellWidth` is omitted, in pt. */
export const MATRIX_CELL_PT = 10;

/** The unit of the placement of a matrix with merged cells (#644), in pt: half a point. */
const PLACE_UNIT_PT = 0.5;

/** The text a scale's cell (or a legend's end) shows for a value (#644). */
export function formatScaleValue(value: number, scale: Pick<MatrixScale, "decimals">): string {
  return scale.decimals === undefined ? String(value) : value.toFixed(scale.decimals);
}

/**
 * Where a value falls on a scale (#644), 0 (at `from`) to 1 (at `to`),
 * clamped. A stepped scale splits the range into `steps` equal bins and gives
 * each the position of its step (0, 1/(steps-1), …, 1).
 */
export function scaleStep(
  value: number,
  scale: Pick<MatrixScale, "from" | "to" | "steps">,
): number {
  const t = Math.min(1, Math.max(0, (value - scale.from) / (scale.to - scale.from)));
  if (scale.steps === undefined) return t;
  const bin = Math.min(scale.steps - 1, Math.floor(t * scale.steps));
  return bin / (scale.steps - 1);
}

/** One expanded part of a matrix: a cell, a header or the corner. */
export interface MatrixPartExpansion extends CellFields {
  /** The ID of the node it was expanded into. */
  readonly id: string;
  readonly kind: "cell" | "row" | "column" | "corner" | "rule";
  /** A cell's class name (an ellipsis cell has one only when it was written). */
  readonly class?: string;
  /** The symbol of an ellipsis cell (#280). */
  readonly ellipsis?: string;
  /** pt: a header's text is broken to fit this width (`wrapHeaders`, #612). */
  readonly wrap?: number;
  /** A cell colored by the matrix's scale (#644): its written value. */
  readonly value?: number;
}

/** A matrix node and what it was expanded into (`doc.matrices`). */
export interface MatrixExpansion {
  /** The matrix's ID: also the ID of its frame group. */
  readonly id: string;
  /** Where the matrix node is written: `["nodes", i]`. */
  readonly path: DocPath;
  /** The matrix node's variant (the cells have their own). */
  readonly variant: string;
  /** The classes, as validated, by name in written order. */
  readonly classes: Readonly<Record<string, MatrixClass>>;
  /** The variant of the cells of a class without one: `props.variant`, or `default`. */
  readonly cellVariant: string;
  /** Where the cells' variant is written (`props.variant`), if it is. */
  readonly cellVariantPath?: DocPath;
  /** The frame has no padding (`props.flush`, #280, or a title above it, #612). */
  readonly flush?: true;
  /** The cells have no border (`props.rules`, #612): so have the legend's samples (#644). */
  readonly rules?: true;
  /** The color scale (#644), with where it is written. */
  readonly scale?: { readonly spec: MatrixScale; readonly path: DocPath };
  /** The parts: the cells row by row, then the row headers, column headers and corner. */
  readonly parts: readonly MatrixPartExpansion[];
}

/** The reserved IDs of the parts of matrix `id` (rows and columns 1-based). */
export const matrixPartIds = {
  cell: (id: string, row: number, column: number) => `${id}-${row}-${column}`,
  row: (id: string, row: number) => `${id}-row-${row}`,
  column: (id: string, column: number) => `${id}-col-${column}`,
  corner: (id: string) => `${id}-corner`,
  rule: (id: string, at: MatrixRule) => `${id}-rule-${at}`,
};

/** The rules of a matrix drawn with `rules` (#612), top to bottom. */
export type MatrixRule = "top" | "mid" | "bottom";

/** The path of a class's field, if the class writes it. */
function classField(
  propsPath: DocPath,
  name: string,
  cls: MatrixClass,
  field: keyof MatrixClass,
): DocPath | undefined {
  return cls[field] === undefined ? undefined : [...propsPath, "classes", name, field];
}

/**
 * Runs the expansion on `state.doc` (see the module comment). Errors:
 * `layout/attached-matrix` for a matrix placed by `attach`,
 * `asset/icon-unsupported`, `component/label-rotation-unsupported` and
 * `component/sublabel-unsupported` for those fields, `component/invalid-prop`
 * for a matrix whose parts' IDs would be too long, and `ref/reserved-id` for
 * an element using a part's ID. A matrix with an error is not expanded and
 * becomes invalid.
 */
export function expandMatrices(state: CheckState, registry: Registry, locate: Locator): void {
  const { doc, invalid } = state;
  const { groups, nodes, edges } = doc;
  const components = state.components;
  if (groups === undefined || nodes === undefined || edges === undefined) return;
  if (components === undefined || doc.figure?.layout.engine !== "structured") return;

  const taken = takenIds(doc);
  const added = new Set<ElementKey>();
  const origins: [ElementKey, ExpandedOrigin][] = [];
  const paints = new Map<ElementKey, ExpandedPaint>(doc.paints ?? []);
  const expansions: MatrixExpansion[] = [];

  for (const [index, node] of nodes.entries()) {
    if (node === undefined) continue;
    const key = nodeKey(node.id);
    const component = components.get(key);
    if (component?.id !== MATRIX_ID || invalid.has(key)) continue;
    const matrixPath: DocPath = ["nodes", index];
    const subject = { kind: "node", id: node.id } as const;
    const fail = (code: string, message: string, at: DocPath, hint: string) => {
      state.diagnostics.push(errorAt(locate, code, message, at, { subject, hint }));
      invalid.add(key);
    };
    if (node.attach !== undefined) {
      fail(
        "layout/attached-matrix",
        `Matrix "${node.id}" is drawn as a frame around its cells, so it cannot be attached.`,
        [...matrixPath, "attach"],
        "Remove attach and list the matrix in an arrange tree, e.g. in a row or stack next to what it explains.",
      );
      continue;
    }
    if (node.icon !== undefined) {
      fail(
        "asset/icon-unsupported",
        `${MATRIX_ID} cannot draw an icon; icons go on plain shapes such as box, circle or label.`,
        [...matrixPath, "icon"],
        "Remove the icon; a matrix's title is its label.",
      );
      continue;
    }
    if (node.labelRotation !== undefined) {
      fail(
        "component/label-rotation-unsupported",
        `Matrix "${node.id}" lays its title out above its cells, so its label cannot be turned.`,
        [...matrixPath, "labelRotation"],
        "Remove labelRotation.",
      );
      continue;
    }
    if (node.sublabel !== undefined) {
      fail(
        "component/sublabel-unsupported",
        `Matrix "${node.id}" draws its label as a title above its cells, so it takes no sublabel.`,
        [...matrixPath, "sublabel"],
        "Remove sublabel; put the text into the label (a newline breaks the line).",
      );
      continue;
    }

    const props = component.props as unknown as MatrixProps;
    const propsPath: DocPath = [...matrixPath, "props"];
    const titleOutside = props.labelAt?.startsWith("above") === true;
    if (props.flush === true && !titleOutside && !isBlankForD2(node.label)) {
      fail(
        "component/invalid-prop",
        `Invalid prop "flush" for ${MATRIX_ID}: a flush matrix has no padding, so it cannot draw its label as a title inside its frame.`,
        [...propsPath, "flush"],
        "Set labelAt: above to draw the title above the frame (a matrix with it has no padding anyway), or remove flush.",
      );
      continue;
    }
    const classes = props.classes ?? {};
    const names = Object.keys(classes);
    const grid = matrixGrid(props.cells, names).slots;
    const ids = matrixPartIds;

    // 1. The cells' variants must be box variants: checked once here, where
    // they are written, rather than once per cell.
    const box = registry.resolve(CELL_COMPONENT, "node");
    const boxVariants = box.ok ? box.value.variants : [];
    const variants: [string, DocPath][] = [];
    if (props.variant !== undefined) variants.push([props.variant, [...propsPath, "variant"]]);
    for (const [name, cls] of Object.entries(classes)) {
      if (cls.variant !== undefined) {
        variants.push([cls.variant, [...propsPath, "classes", name, "variant"]]);
      }
    }
    const unknown = variants.filter(([variant]) => !boxVariants.includes(variant));
    for (const [variant, at] of unknown) {
      state.diagnostics.push(
        errorAt(
          locate,
          "component/unknown-variant",
          `Unknown variant "${variant}" for the cells of ${MATRIX_ID} (${CELL_COMPONENT}).`,
          at,
          {
            subject,
            hint:
              didYouMean(variant, boxVariants) ??
              `Variants of ${CELL_COMPONENT}: ${boxVariants.join(", ")}.`,
          },
        ),
      );
    }
    if (unknown.length > 0) {
      invalid.add(key);
      continue;
    }

    // 2. The parts' IDs must be IDs, and free.
    const partIds: string[] = [];
    for (const slot of grid.flat()) partIds.push(ids.cell(node.id, slot.row + 1, slot.column + 1));
    for (const r of (props.rows ?? []).keys()) partIds.push(ids.row(node.id, r + 1));
    for (const c of (props.columns ?? []).keys()) partIds.push(ids.column(node.id, c + 1));
    if (props.corner !== undefined) partIds.push(ids.corner(node.id));
    const rules: MatrixRule[] =
      props.rules !== true
        ? []
        : props.columns === undefined
          ? ["top", "bottom"]
          : ["top", "mid", "bottom"];
    for (const at of rules) partIds.push(ids.rule(node.id, at));
    const longest = partIds.reduce((a, b) => (b.length > a.length ? b : a), "");
    if (!ID_PATTERN.test(longest)) {
      fail(
        "component/invalid-prop",
        `Invalid ID for ${MATRIX_ID}: matrix "${node.id}" draws its parts as nodes such as "${longest}", which is longer than an ID may be (64 characters).`,
        [...matrixPath, "id"],
        "Shorten the matrix's ID.",
      );
      continue;
    }
    let blocked = false;
    for (const id of partIds) {
      const owner = taken.get(id);
      if (owner !== undefined) {
        reportReservedId(state, locate, {
          id,
          owner,
          reservedFor: `a part of matrix "${node.id}"`,
          related: { path: matrixPath, message: "The matrix is written here." },
        });
        blocked = true;
      } else if (invalid.has(nodeKey(id)) || invalid.has(groupKey(id))) {
        // An unreadable element may hold the ID: its own error explains the figure.
        blocked = true;
      }
    }
    if (blocked) {
      invalid.add(key);
      continue;
    }

    // 3. Expand.
    const cellWidth = props.cellWidth ?? MATRIX_CELL_PT;
    const cellHeight = props.cellHeight ?? cellWidth;
    const gap = props.gap ?? 0;
    const widthPath: DocPath =
      props.cellWidth !== undefined ? [...propsPath, "cellWidth"] : propsPath;
    const heightPath: DocPath =
      props.cellHeight !== undefined ? [...propsPath, "cellHeight"] : widthPath;
    const variantPath: DocPath | undefined =
      props.variant !== undefined ? [...propsPath, "variant"] : undefined;
    const parts: MatrixPartExpansion[] = [];
    const addPart = (
      part: FigureNode,
      expansion: Omit<MatrixPartExpansion, "id">,
      name: string,
      paint?: ExpandedPaint,
    ) => {
      nodes.push(part);
      const partKey = nodeKey(part.id);
      added.add(partKey);
      origins.push([partKey, { from: "matrix", path: expansion.path, subject, name }]);
      taken.set(part.id, expansion.path);
      parts.push({ id: part.id, ...expansion });
      if (paint !== undefined) paints.set(partKey, paint);
    };
    const size = (width: number, height?: number): Record<string, unknown> => ({
      // Written as in a figure: the component stage validates them like any props.
      width: `${width}pt`,
      ...(height !== undefined && { height: `${height}pt` }),
    });
    const of = `of matrix "${node.id}"`;

    const scale = props.scale;
    const scalePath: DocPath = [...propsPath, "scale"];
    const cellRows: ArrangeItem[][] = [];
    const cellSlots: { id: string; slot: MatrixSlot }[] = [];
    for (const row of grid) {
      const items: ArrangeItem[] = [];
      for (const slot of row) {
        const { entry, row: r, column: c, index } = slot;
        const written = props.cells[r];
        const name = entry.class;
        // Validated: every name is an own class (never one of Object.prototype's).
        const cls = (name !== undefined && Object.hasOwn(classes, name) && classes[name]) || {};
        const path: DocPath =
          typeof written === "string"
            ? [...propsPath, "cells", r]
            : [...propsPath, "cells", r, index];
        const id = ids.cell(node.id, r + 1, c + 1);
        // A merged cell (#644) covers its columns and rows and the gaps between them.
        const width = slot.columns * cellWidth + (slot.columns - 1) * gap;
        const height = slot.rows * cellHeight + (slot.rows - 1) * gap;
        const spanPath: DocPath | undefined =
          entry.span === undefined ? undefined : [...path, "span"];
        const rowEllipsis = props.ellipsisRows?.includes(r + 1) === true;
        const columnEllipsis = props.ellipsisColumns?.includes(c + 1) === true;
        const selected = rowEllipsis || columnEllipsis;
        const symbol = selected
          ? rowEllipsis && columnEllipsis
            ? "⋱"
            : rowEllipsis
              ? "⋮"
              : "…"
          : entry.ellipsis;
        cellSlots.push({ id, slot });
        if (symbol !== undefined) {
          // An ellipsis slot keeps the cell's size and draws only the symbol:
          // a borderless label, so neighbors keep their own borders (#280).
          const at: DocPath = selected
            ? [...propsPath, rowEllipsis ? "ellipsisRows" : "ellipsisColumns"]
            : [...path, "ellipsis"];
          addPart(
            {
              id,
              component: "sumi/label",
              label: symbol,
              variant: "default",
              props: size(width, height),
              group: node.id,
            },
            {
              kind: "cell",
              ...(name !== undefined && { class: name }),
              ellipsis: symbol,
              path,
              fields: {
                label: at,
                component: at,
                tone: at,
                variant: at,
                "props.width": spanPath ?? widthPath,
                "props.height": spanPath ?? heightPath,
                props: spanPath ?? widthPath,
              },
            },
            `ellipsis cell ${r + 1}, ${c + 1} ${of}`,
          );
          items.push(id);
          continue;
        }
        if (entry.value !== undefined && scale !== undefined) {
          // A cell the scale colors (#644): the tone's fill at its step, its value as text.
          const valuePath: DocPath = [...path, "value"];
          const shown =
            entry.text ?? (scale.showValues === false ? "" : formatScaleValue(entry.value, scale));
          addPart(
            {
              id,
              component: CELL_COMPONENT,
              label: shown,
              variant: MATRIX_SCALE_VARIANT,
              tone: scale.tone ?? MATRIX_SCALE_TONE,
              props: size(width, height),
              group: node.id,
            },
            {
              kind: "cell",
              value: entry.value,
              path,
              fields: {
                label: entry.text !== undefined ? [...path, "text"] : valuePath,
                component: path,
                tone: scale.tone !== undefined ? [...scalePath, "tone"] : scalePath,
                variant: scalePath,
                "props.width": spanPath ?? widthPath,
                "props.height": spanPath ?? heightPath,
                props: spanPath ?? widthPath,
              },
            },
            `cell ${r + 1}, ${c + 1} (value ${entry.value}) ${of}`,
            {
              ramp: scaleStep(entry.value, scale),
              ...(props.rules === true && { borderless: true }),
            },
          );
          items.push(id);
          continue;
        }
        const variant = classField(propsPath, name ?? "", cls, "variant") ?? variantPath ?? path;
        const cellVariant = cls.variant ?? props.variant ?? "default";
        const paint: ExpandedPaint = {
          ...(cls.pattern === "hatch" && { hatch: true }),
          ...(cellVariant === MUTED_VARIANT && { pale: true }),
          ...(props.rules === true && { borderless: true }),
        };
        addPart(
          {
            id,
            component: CELL_COMPONENT,
            label: entry.text ?? "",
            variant: cellVariant,
            ...(cls.tone !== undefined && { tone: cls.tone }),
            props: size(width, height),
            group: node.id,
          },
          {
            kind: "cell",
            class: name as string,
            path,
            fields: {
              label: entry.text !== undefined ? [...path, "text"] : path,
              component: path,
              tone: classField(propsPath, name ?? "", cls, "tone") ?? path,
              variant,
              "props.width": spanPath ?? widthPath,
              "props.height": spanPath ?? heightPath,
              props: spanPath ?? widthPath,
            },
          },
          `cell ${r + 1}, ${c + 1} (class ${JSON.stringify(name)}) ${of}`,
          Object.keys(paint).length > 0 ? paint : undefined,
        );
        items.push(id);
      }
      cellRows.push(items);
    }
    const header = (
      id: string,
      written: MatrixHeader | string,
      path: DocPath,
      props: Record<string, unknown>,
      sizePaths: Record<string, DocPath>,
      name: string,
      kind: MatrixPartExpansion["kind"],
      wrap: number | undefined,
      rotation?: MatrixProps["headerRotate"],
    ) => {
      const label = typeof written === "string" ? written : written.label;
      const tone = typeof written === "string" ? undefined : written.tone;
      addPart(
        {
          id,
          component: "sumi/label",
          label,
          variant: "default",
          ...(tone !== undefined && { tone }),
          ...(rotation !== undefined && { labelRotation: rotation }),
          props,
          group: node.id,
        },
        {
          kind,
          path,
          ...(wrap !== undefined && { wrap }),
          fields: {
            label: typeof written === "string" ? path : [...path, "label"],
            component: path,
            variant: path,
            tone: tone === undefined ? path : [...path, "tone"],
            ...sizePaths,
            ...(rotation !== undefined && { labelRotation: [...propsPath, "headerRotate"] }),
          },
        },
        name,
        tone === undefined ? undefined : { toneText: true },
      );
      return id;
    };
    const headerWidthPath: DocPath = [...propsPath, "headerWidth"];
    const wrapHeaders = props.wrapHeaders === true;
    const rowHeaders = (props.rows ?? []).map((written, r) =>
      header(
        ids.row(node.id, r + 1),
        written,
        [...propsPath, "rows", r],
        // As high as a cell: the cells are spaced evenly down and across. As
        // wide as its text without headerWidth.
        props.headerWidth === undefined
          ? { height: `${cellHeight}pt` }
          : size(props.headerWidth, cellHeight),
        {
          "props.height": heightPath,
          ...(props.headerWidth !== undefined && { "props.width": headerWidthPath }),
          props: props.headerWidth !== undefined ? headerWidthPath : heightPath,
        },
        `the header of row ${r + 1} ${of}`,
        "row",
        wrapHeaders ? props.headerWidth : undefined,
      ),
    );
    const columnHeaders = (props.columns ?? []).map((written, c) =>
      header(
        ids.column(node.id, c + 1),
        written,
        [...propsPath, "columns", c],
        // As wide as a cell: centered over its column.
        size(cellWidth),
        { "props.width": widthPath, props: widthPath },
        `the header of column ${c + 1} ${of}`,
        "column",
        // A turned header (#644) is as tall as its text: it is never wrapped.
        wrapHeaders && props.headerRotate === undefined
          ? (props.columnHeaderWidth ?? cellWidth)
          : undefined,
        props.headerRotate,
      ),
    );
    const corner =
      props.corner === undefined
        ? undefined
        : header(
            ids.corner(node.id),
            props.corner,
            [...propsPath, "corner"],
            props.headerWidth === undefined ? {} : size(props.headerWidth),
            props.headerWidth === undefined
              ? {}
              : { "props.width": headerWidthPath, props: headerWidthPath },
            `the corner ${of}`,
            "corner",
            wrapHeaders ? props.headerWidth : undefined,
          );
    // The rules of a table drawn with rules only (#612): separators that span the frame.
    const ruleIds = new Map<MatrixRule, string>();
    for (const at of rules) {
      const id = ids.rule(node.id, at);
      const rulesPath: DocPath = [...propsPath, "rules"];
      addPart(
        {
          id,
          component: SEPARATOR_ID,
          label: "",
          variant: "solid",
          props: {},
          group: node.id,
        },
        {
          kind: "rule",
          path: rulesPath,
          fields: { label: rulesPath, component: rulesPath, variant: rulesPath, props: rulesPath },
        },
        `the ${at === "mid" ? "middle" : at} rule ${of}`,
        at === "mid" ? { thin: true } : undefined,
      );
      ruleIds.set(at, id);
    }

    // The frame takes the matrix node's place: its ID, parent and position.
    const frame: FigureGroup = {
      id: node.id,
      label: node.label,
      ...(titleOutside && { labelAt: props.labelAt }),
      component: "sumi/container",
      variant: "plain",
      ...(node.tone !== undefined && { tone: node.tone }),
      ...(node.group !== undefined && { group: node.group }),
      arrange: matrixArrange(
        props,
        cellRows,
        cellSlots,
        rowHeaders,
        columnHeaders,
        corner,
        ruleIds,
      ),
    };
    groups.push(frame);
    nodes[index] = undefined;
    components.delete(key);
    const frameKey = groupKey(node.id);
    if (node.mono !== undefined) paints.set(frameKey, { mono: node.mono });
    added.add(frameKey);
    origins.push([
      frameKey,
      { from: "matrix", path: matrixPath, subject, name: `matrix "${node.id}"` },
    ]);
    expansions.push({
      id: node.id,
      path: matrixPath,
      variant: component.variant,
      classes,
      ...((props.flush === true || titleOutside) && { flush: true as const }),
      ...(props.rules === true && { rules: true as const }),
      ...(scale !== undefined && { scale: { spec: scale, path: scalePath } }),
      cellVariant: props.variant ?? "default",
      ...(variantPath !== undefined && { cellVariantPath: variantPath }),
      parts,
    });
  }
  if (expansions.length === 0) {
    invalidateDependents(state);
    return;
  }
  doc.matrices = expansions;
  if (paints.size > 0) doc.paints = paints;
  recordExpanded(doc, origins);
  resolveComponents(state, registry, locate, { only: added });
  invalidateDependents(state);
}

/**
 * The frame's arrange tree (see the module comment). With `rules` (#612) the
 * rules go between its parts: a separator spans the stack it is in whatever
 * its alignment, so each rule runs under the row headers too, and `headerGap`
 * is the room on either side of a rule.
 */
function matrixArrange(
  props: MatrixProps,
  cellRows: readonly ArrangeItem[][],
  cellSlots: readonly { id: string; slot: MatrixSlot }[],
  rowHeaders: readonly string[],
  columnHeaders: readonly string[],
  corner: string | undefined,
  rules: ReadonlyMap<MatrixRule, string>,
): ArrangeBox {
  const gap = props.gap ?? 0;
  const headerGap = props.headerGap ?? gap;
  const left = props.rowsAt === "left";
  // On the cells' side, so that headers of different widths stay beside them.
  const align = left ? "end" : "start";
  const cells = (items: ArrangeItem[]): ArrangeBox => ({
    row: { direction: "right", gap, items },
  });
  const beside = (header: ArrangeItem, items: ArrangeItem): ArrangeBox => ({
    row: {
      direction: "right",
      gap: headerGap,
      align: "center",
      items: left ? [header, items] : [items, header],
    },
  });
  let body: ArrangeBox;
  if (cellSlots.every(({ slot }) => slot.rows === 1 && slot.columns === 1)) {
    const rows = cellRows.map((items, r) => {
      const header = rowHeaders[r];
      return header === undefined ? cells(items) : beside(header, cells(items));
    });
    body = { stack: { direction: "down", gap, align, items: rows } };
  } else {
    // Merged cells (#644): every cell at its slot's place, the row headers in a column beside
    // them (each as high as a cell, so they stay level with their rows).
    const cellWidth = props.cellWidth ?? MATRIX_CELL_PT;
    const cellHeight = props.cellHeight ?? cellWidth;
    const pitch = { x: cellWidth + gap, y: cellHeight + gap };
    const grid: ArrangeBox = {
      place: {
        unit: PLACE_UNIT_PT,
        items: cellSlots.map(({ id, slot }) => ({
          item: id,
          at: [
            (slot.column * pitch.x + (slot.columns * pitch.x - gap) / 2) / PLACE_UNIT_PT,
            (slot.row * pitch.y + (slot.rows * pitch.y - gap) / 2) / PLACE_UNIT_PT,
          ] as [number, number],
        })),
      },
    };
    body =
      rowHeaders.length === 0
        ? grid
        : beside({ stack: { direction: "down", gap, align, items: [...rowHeaders] } }, grid);
  }
  const rule = (at: MatrixRule): ArrangeItem[] => {
    const id = rules.get(at);
    return id === undefined ? [] : [id];
  };
  let parts: ArrangeItem[] = [body];
  if (columnHeaders.length > 0) {
    // Wrapped (#612) or turned (#644) headers of different heights sit on the cells' side.
    const heads: ArrangeBox =
      props.wrapHeaders === true || props.headerRotate !== undefined
        ? {
            row: {
              direction: "right",
              gap,
              align: props.columnsAt === "top" ? "end" : "start",
              items: [...columnHeaders],
            },
          }
        : cells([...columnHeaders]);
    const top = corner === undefined ? heads : beside(corner, heads);
    parts = props.columnsAt === "top" ? [top, ...rule("mid"), body] : [body, ...rule("mid"), top];
  }
  if (rules.size > 0) parts = [...rule("top"), ...parts, ...rule("bottom")];
  else if (parts.length === 1) return body;
  return { stack: { direction: "down", gap: headerGap, align, items: parts } };
}
