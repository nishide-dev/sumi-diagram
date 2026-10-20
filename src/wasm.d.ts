// `import path from "./x.wasm" with { type: "file" }` (Bun) gives the file path;
// `bun build --compile` embeds the file and gives its `/$bunfs/` path.
declare module "*.wasm" {
  const path: string;
  export default path;
}
