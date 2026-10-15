/**
 * Length props for component manifests: a number in pt, or a string with a
 * unit (`pt`, `mm`, `cm`, `in`; design doc §5.1). Normalized to pt.
 *
 * TODO(#7): replace the local parser with the shared unit parser once it lands.
 */

import { z } from "zod";

const PT_PER_UNIT = { pt: 1, mm: 72 / 25.4, cm: 720 / 25.4, in: 72 } as const;
const LENGTH_PATTERN = /^(\d+(?:\.\d+)?)(pt|mm|cm|in)$/;
const MESSAGE = 'expected a positive length such as 40, "40pt" or "15mm"';

function toPt(value: number | string): number {
  if (typeof value === "number") return value;
  const [, amount, unit] = LENGTH_PATTERN.exec(value) ?? [];
  return Number(amount) * PT_PER_UNIT[unit as keyof typeof PT_PER_UNIT];
}

/** A positive length; parses to pt. */
export const PositiveLength = z
  .union([z.number(), z.string().regex(LENGTH_PATTERN, { error: MESSAGE })], { error: MESSAGE })
  .transform(toPt)
  .pipe(z.number().positive({ error: MESSAGE }).finite({ error: MESSAGE }));
