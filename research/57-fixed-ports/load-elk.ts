/** Research-only adapter; does not replace Bun's global self or patch the package. */
import type { ElkConstructor } from "./probe";

export function elkFromText(source: string): ElkConstructor {
  const module: { exports: unknown } = { exports: {} };
  // elkjs's GWT worker detects Bun's main-thread `self` as a Web Worker.
  // Shadow it lexically so the unmodified CommonJS bundle exports FakeWorker.
  const evaluate = new Function("self", "module", "exports", "require", source);
  evaluate(undefined, module, module.exports, (name: string) => {
    throw new Error(`Unexpected external require: ${name}`);
  });
  if (typeof module.exports !== "function")
    throw new Error("elkjs bundle did not export a constructor");
  return module.exports as ElkConstructor;
}
