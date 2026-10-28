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
import { MATRIX_ID, matrixRowClasses } from "../registry/builtins";
import type { Registry } from "../registry/registry";
import { resolveComponents } from "../registry/resolve";
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

/** The props of a matrix node, as validated by the manifest. */
export interface MatrixProps {
  cells: (string | string[])[];
  classes: Record<string, MatrixClass>;
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
}

/** The component of a matrix's cells. */
const CELL_COMPONENT = "sumi/box";

/** The cell width when `cellWidth` is omitted, in pt. */
export const MATRIX_CELL_PT = 10;

/** One expanded part of a matrix: a cell, a header or the corner. */
export interface MatrixPartExpansion extends CellFields {
  /** The ID of the node it was expanded into. */
  readonly id: string;
  readonly kind: "cell" | "row" | "column" | "corner";
  /** A cell's class name. */
  readonly class?: string;
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
  /** The parts: the cells row by row, then the row headers, column headers and corner. */
  readonly parts: readonly MatrixPartExpansion[];
}

/** The reserved IDs of the parts of matrix `id` (rows and columns 1-based). */
export const matrixPartIds = {
  cell: (id: string, row: number, column: number) => `${id}-${row}-${column}`,
  row: (id: string, row: number) => `${id}-row-${row}`,
  column: (id: string, column: number) => `${id}-col-${column}`,
  corner: (id: string) => `${id}-corner`,
};

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
    const names = Object.keys(props.classes);
    const grid = props.cells.map((row) => matrixRowClasses(row, names));
    const ids = matrixPartIds;

    // 1. The cells' variants must be box variants: checked once here, where
    // they are written, rather than once per cell.
    const box = registry.resolve(CELL_COMPONENT, "node");
    const boxVariants = box.ok ? box.value.variants : [];
    const variants: [string, DocPath][] = [];
    if (props.variant !== undefined) variants.push([props.variant, [...propsPath, "variant"]]);
    for (const [name, cls] of Object.entries(props.classes)) {
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
    for (const [r, row] of grid.entries()) {
      for (const c of row.keys()) partIds.push(ids.cell(node.id, r + 1, c + 1));
    }
    for (const r of (props.rows ?? []).keys()) partIds.push(ids.row(node.id, r + 1));
    for (const c of (props.columns ?? []).keys()) partIds.push(ids.column(node.id, c + 1));
    if (props.corner !== undefined) partIds.push(ids.corner(node.id));
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

    const cellRows: ArrangeItem[][] = [];
    for (const [r, row] of grid.entries()) {
      const written = props.cells[r];
      const items: ArrangeItem[] = [];
      for (const [c, name] of row.entries()) {
        const cls = props.classes[name] ?? {};
        const path: DocPath =
          typeof written === "string" ? [...propsPath, "cells", r] : [...propsPath, "cells", r, c];
        const id = ids.cell(node.id, r + 1, c + 1);
        const variant = classField(propsPath, name, cls, "variant") ?? variantPath ?? path;
        addPart(
          {
            id,
            component: CELL_COMPONENT,
            label: "",
            variant: cls.variant ?? props.variant ?? "default",
            ...(cls.tone !== undefined && { tone: cls.tone }),
            props: size(cellWidth, cellHeight),
            group: node.id,
          },
          {
            kind: "cell",
            class: name,
            path,
            fields: {
              label: path,
              component: path,
              tone: classField(propsPath, name, cls, "tone") ?? path,
              variant,
              "props.width": widthPath,
              "props.height": heightPath,
              props: widthPath,
            },
          },
          `cell ${r + 1}, ${c + 1} (class ${JSON.stringify(name)}) ${of}`,
          cls.pattern === "hatch" ? { hatch: true } : undefined,
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
          props,
          group: node.id,
        },
        {
          kind,
          path,
          fields: {
            label: typeof written === "string" ? path : [...path, "label"],
            component: path,
            variant: path,
            tone: tone === undefined ? path : [...path, "tone"],
            ...sizePaths,
          },
        },
        name,
        tone === undefined ? undefined : { toneText: true },
      );
      return id;
    };
    const headerWidthPath: DocPath = [...propsPath, "headerWidth"];
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
          );

    // The frame takes the matrix node's place: its ID, parent and position.
    const frame: FigureGroup = {
      id: node.id,
      label: node.label,
      component: "sumi/container",
      variant: "plain",
      ...(node.tone !== undefined && { tone: node.tone }),
      ...(node.group !== undefined && { group: node.group }),
      arrange: matrixArrange(props, cellRows, rowHeaders, columnHeaders, corner),
    };
    groups.push(frame);
    nodes[index] = undefined;
    components.delete(key);
    const frameKey = groupKey(node.id);
    added.add(frameKey);
    origins.push([
      frameKey,
      { from: "matrix", path: matrixPath, subject, name: `matrix "${node.id}"` },
    ]);
    expansions.push({
      id: node.id,
      path: matrixPath,
      variant: component.variant,
      classes: props.classes,
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

/** The frame's arrange tree (see the module comment). */
function matrixArrange(
  props: MatrixProps,
  cellRows: readonly ArrangeItem[][],
  rowHeaders: readonly string[],
  columnHeaders: readonly string[],
  corner: string | undefined,
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
  const rows = cellRows.map((items, r) => {
    const header = rowHeaders[r];
    return header === undefined ? cells(items) : beside(header, cells(items));
  });
  const body: ArrangeBox = { stack: { direction: "down", gap, align, items: rows } };
  if (columnHeaders.length === 0) return body;
  const heads = cells([...columnHeaders]);
  const top = corner === undefined ? heads : beside(corner, heads);
  return {
    stack: {
      direction: "down",
      gap: headerGap,
      align,
      items: props.columnsAt === "top" ? [top, body] : [body, top],
    },
  };
}
