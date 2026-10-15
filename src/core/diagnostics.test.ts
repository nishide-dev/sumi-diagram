import { describe, expect, test } from "bun:test";
import { closestMatch, didYouMean, editDistance, formatDocPath, hasErrors } from "./diagnostics";
import { toResult } from "./result";

describe("editDistance", () => {
  test("counts edits, including adjacent transpositions", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("lable", "label")).toBe(1);
  });
});

describe("closestMatch / didYouMean", () => {
  test("suggests a close candidate", () => {
    expect(closestMatch("sever", ["client", "server"])).toBe("server");
    expect(didYouMean("rigth", ["right", "down"])).toBe('Did you mean "right"?');
  });

  test("ignores distant candidates", () => {
    expect(closestMatch("database", ["client", "server"])).toBeUndefined();
    expect(didYouMean("x", [])).toBeUndefined();
  });
});

describe("formatDocPath", () => {
  test("formats paths like property accessors", () => {
    expect(formatDocPath([])).toBe("(root)");
    expect(formatDocPath(["nodes", 2, "props", "width"])).toBe("nodes[2].props.width");
  });
});

describe("hasErrors / toResult", () => {
  const warning = { code: "lint/x", severity: "warning", message: "W." } as const;
  const error = { code: "ref/x", severity: "error", message: "E." } as const;

  test("only errors fail a result", () => {
    expect(hasErrors([warning])).toBe(false);
    expect(toResult([warning], () => 1)).toEqual({ ok: true, value: 1, diagnostics: [warning] });
    expect(toResult([warning, error], () => 1)).toEqual({
      ok: false,
      diagnostics: [warning, error],
    });
  });
});
