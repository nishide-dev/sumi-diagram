/**
 * Length props for component manifests, parsed with the shared unit parser
 * (design doc §5.1). Sizes are passed to D2 as integer D2 units (0.5pt). A size
 * is a layout value, so it is rounded to the nearest 0.5pt (error at most
 * 0.25pt, #515) rather than rejected; visual values (stroke widths, corner
 * radii) stay exact in the theme module.
 */

import { z } from "zod";
import { d2UnitsToPt, parseLength, roundToD2Units } from "../units";

/** A non-negative length string, for the catalog's JSON Schema. */
const SIZE_PATTERN = /^\d+(\.\d+)?(mm|cm|in|pt)$/;

/**
 * A positive length with a unit (`"40pt"`, `"15mm"`), rounded to the nearest
 * 0.5pt (at least 0.5pt) so it is a whole number of D2 units. Parses to pt (an
 * exact multiple of 0.5). The rounding is silent: the error is at most 0.25pt.
 * Validation issues carry `params.hint`.
 *
 * The input is `unknown` so that every wrong input (including bare numbers)
 * gets the unit parser's message; the JSON Schema still says "string".
 */
export const SizeLength = z
  .unknown()
  .meta({ type: "string", pattern: SIZE_PATTERN.source })
  .transform((input, ctx): number => {
    const issue = (message: string, hint?: string) => {
      ctx.addIssue({ code: "custom", message, ...(hint !== undefined && { params: { hint } }) });
      return z.NEVER;
    };
    const parsed = parseLength(input);
    if (!parsed.ok) return issue(parsed.message, parsed.hint);
    const { length } = parsed;
    if (length.exactPt.num <= 0n) {
      return issue(`Size ${JSON.stringify(input)} must be positive.`);
    }
    return d2UnitsToPt(Math.max(1, roundToD2Units(length)));
  });
