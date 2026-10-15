// Lint: structural checks on checked figures (stage `lint`), geometry checks
// on the rendered SVG (stage `geometry`, #13), configuration and report formatters.
export * from "./cmap";
export * from "./config";
export * from "./format";
export * from "./geometry";
export * from "./lint";
export * from "./metrics";
export * from "./rule";
export * from "./rules";
export { Reader, readTables, type SfntTables } from "./sfnt";
export * from "./text";
