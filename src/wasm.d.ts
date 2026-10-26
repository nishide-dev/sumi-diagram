// `import path from "./x.wasm" with { type: "file" }` (Bun) gives the file path;
// `bun build --compile` embeds the file and gives its `/$bunfs/` path.
declare module "*.wasm" {
  const path: string;
  export default path;
}

// Other assets embedded the same way (#94: the icon archive and its license).
declare module "*.gz" {
  const path: string;
  export default path;
}
declare module "*.txt" {
  const path: string;
  export default path;
}
