// `import path from "./x.wasm" with { type: "file" }` (Bun) gives the file path.
declare module "*.wasm" {
  const path: string;
  export default path;
}
