/**
 * Length props for component manifests, parsed with the shared unit parser
 * (design doc §5.1). Sizes are passed to D2 as integer D2 units (0.5pt), so a
 * size must be an exact multiple of 0.5pt; it is never rounded silently.
 */

import { z } from "zod";
import { d2UnitsToPt, exactD2Units, formatPt, parseLength, roundToD2Units } from "../units";

/** A non-negative length string, for the catalog's JSON Schema. */
const SIZE_PATTERN = /^\d+(\.\d+)?(mm|cm|in|pt)$/;

/**
 * A positive length with a unit (`"40pt"`, `"15mm"`) that is a whole number of
 * D2 units. Parses to pt (an exact multiple of 0.5). Validation issues carry
 * `params.hint`.
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
    const units = exactD2Units(length);
    if (units === undefined) {
      const nearest = d2UnitsToPt(Math.max(1, roundToD2Units(length)));
      return issue(
        `Size ${JSON.stringify(input)} (${formatPt(length.pt)}) is not a multiple of 0.5pt, the D2 unit.`,
        `The nearest valid size is "${nearest}pt".`,
      );
    }
    return d2UnitsToPt(units);
  });
