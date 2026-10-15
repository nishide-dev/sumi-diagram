import { describe, expect, test } from "bun:test";
import { mmToPt } from "../core/units";
import { toSize } from "./geometry";
import type { ProfileLimits } from "./inspect";
import { outputSize } from "./size";

const inspection = (widthUnits: number, heightUnits: number, profile: ProfileLimits) => ({
  canvas: {
    viewBox: { x: 0, y: 0, width: widthUnits, height: heightUnits },
    width: toSize(widthUnits),
    height: toSize(heightUnits),
  },
  profile,
});

const paperSingle: ProfileLimits = {
  id: "paper-single",
  maxWidthPt: mmToPt(88),
  maxHeightPt: mmToPt(220),
  minFontSizePt: 7,
};

describe("outputSize", () => {
  test("reports pt as written to the SVG, mm rounded, and the profile's limits", () => {
    expect(outputSize(inspection(277, 619, paperSingle))).toEqual({
      widthPt: 138.5,
      heightPt: 309.5,
      widthMm: 48.86,
      heightMm: 109.18,
      profile: { id: "paper-single", maxWidthMm: 88, maxHeightMm: 220, minFontSizePt: 7 },
      fits: true,
    });
  });

  test("fits compares width and height with the unrounded limits", () => {
    // 88mm = 249.448…pt; 498 units = 249pt fits, 499 units = 249.5pt does not.
    expect(outputSize(inspection(498, 10, paperSingle)).fits).toBe(true);
    expect(outputSize(inspection(499, 10, paperSingle)).fits).toBe(false);
    expect(outputSize(inspection(10, 1248, paperSingle)).fits).toBe(false);
  });

  test("missing limits are null and never exceeded", () => {
    const size = outputSize(inspection(100_000, 100_000, { id: "free", minFontSizePt: 4 }));
    expect(size.profile).toEqual({
      id: "free",
      maxWidthMm: null,
      maxHeightMm: null,
      minFontSizePt: 4,
    });
    expect(size.fits).toBe(true);
  });
});
