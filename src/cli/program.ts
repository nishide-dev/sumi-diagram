import { Command } from "commander";
import pkg from "../../package.json";

export function createProgram(): Command {
  return new Command()
    .name("sumi")
    .description("Diagram-as-Code CLI: build diagrams from predefined components and themes")
    .version(pkg.version, "-v, --version", "output the version number");
}
