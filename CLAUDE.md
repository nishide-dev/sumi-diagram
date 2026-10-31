# CLAUDE.md

Guidance for AI agents working in this repository. Conventions for branches, commits, PRs, and issues live in [CONTRIBUTING.md](CONTRIBUTING.md) — read it and follow it; this file does not repeat it. The current roadmap is issue #236; the completed MVP and architecture plan is archived in issue #1.

## Project

Sumi is a general-purpose Diagram-as-Code CLI: it builds diagrams from predefined components and a design system, and renders SVG.

- TypeScript (strict) + Bun, single package for the MVP
- Toolchain: Bun (runtime, package manager, test runner) + Biome (format/lint) + `tsc` (typecheck). Do not introduce Vite, Node-only tooling, or other formatters/linters
- Distributed as a single binary via `bun build --compile`; avoid dependencies that break this

## Commands

```sh
bun install         # install dependencies
bun run check       # Biome format + lint check
bun run check:fix   # apply Biome fixes
bun run typecheck   # tsc
bun run test        # tests (default timeout: 60 seconds)
```

Run `bun run check`, `bun run typecheck`, and `bun run test` before committing.

## Architecture principles

- The primary source is `*.sumi.yaml`. Generated `.d2` files are intermediate artifacts — never edit them by hand; change the YAML or the compiler instead
- Pipeline: Figure Schema → Component Registry → Theme/Profile resolution → Figure IR → D2 (ELK) → SVG → Lint
- Keep Primitives / Components / Recipes separate from Themes / Profiles
- D2 is the initial layout backend only; Sumi owns component contracts, validation, and output quality
- All stages report problems through the shared Diagnostic type (defined in #4). Do not invent per-module error formats
- Initial components are generic (rectangle, circle/ellipse, diamond, label, container, arrow). Do not make domain-specific components required
- The Claude Code Skill uses the same validation path as the CLI

## Working rules

- Work on a branch named `<type>/<issue>-<desc>`; never commit directly to `main`
- Commit messages and PR titles: English Conventional Commits. Issue/PR bodies: Japanese, following the templates in `.github/`
- In the PR body, use `Closes #<number>` only when the PR fully resolves the issue; use `Refs #<number>` for partial or related work. PRs are squash-merged
- Record design decisions and trade-offs in the related issue; update #236 when the plan changes
