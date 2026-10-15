# Reading and fixing diagnostics

Every stage reports problems as the same diagnostic object. In
`sumi lint --json` they are under `results[i].diagnostics`; in
`sumi render --json` under `diagnostics`:

```json
{
  "code": "component/unknown-variant",
  "severity": "error",
  "message": "Unknown variant \"bold\" for sumi/box.",
  "path": ["nodes", 1, "variant"],
  "location": { "file": "f.sumi.yaml", "line": 13, "column": 14 },
  "subject": { "kind": "node", "id": "b" },
  "hint": "Variants of sumi/box: default, emphasis, muted.",
  "related": [{ "message": "…", "location": { "line": 5, "column": 5 } }]
}
```

- `code` is `<stage>/<rule>` and stable — branch on it, not on `message`.
- `path` is the place in the YAML to change (`["edges", 0, "to"]` = the `to`
  of the first edge). `location` is the same place as line/column.
- `hint`, when present, lists the valid values or a near match (edit
  distance). Prefer it over your own guess.
- `summary` has `errors` / `warnings` / `infos`; exit code 1 means errors
  (or more warnings than `--max-warnings`).

## Working through a report

1. Fix all errors of the earliest stages first: `yaml` → `schema` → `ref` →
   `component` → `theme` → `profile` → `lint`. A broken element is skipped by
   later stages, so its other problems show up only after the first fix.
2. Fix every diagnostic you can in one edit, then run `fmt` and `lint` again.
3. If a diagnostic's fix would change the content or needs a user decision,
   stop and ask (see "When to stop and ask" in SKILL.md).

## By stage

| Codes | Meaning | Fix |
| --- | --- | --- |
| `yaml/syntax` | not valid YAML (often an unquoted `:` or `#` in a label, or bad indentation) | quote the value / fix indentation at `location` |
| `yaml/duplicate-key`, `yaml/alias-not-allowed`, `yaml/tag-not-allowed`, `yaml/multiple-documents`, `yaml/non-string-key` | YAML features Sumi does not accept | remove the duplicate / anchor / tag / extra document |
| `schema/unknown-field` | a key the schema does not have (`color`, `style`, `children`, …) | delete it; express it with a component, variant or `group:` |
| `schema/missing-field` | a required field is missing (`version`, `figure.id`, node `component`, edge `from`/`to`) | add it |
| `schema/invalid-id` | ID does not match `^[a-z][a-z0-9_-]{0,63}$` | use the hint's lowercase form; update references to it |
| `schema/invalid-type`, `schema/invalid-value` | wrong type or value (e.g. number as label, unknown `direction`) | quote strings; use an allowed value |
| `schema/unsupported-version`, `schema/unsatisfied-requires` | `version` is not 1, or `requires` names a newer Sumi | use `version: 1`; drop `requires` or ask the user |
| `ref/unknown-endpoint` | edge `from`/`to` is not a node or group ID | use the ID from the hint, or add the missing element if the content calls for it |
| `ref/unknown-group` | `group:` names a group that does not exist | add the group under `groups:` or fix the ID |
| `ref/duplicate-id` | two nodes/groups (or two edges) share an ID | rename one; nodes and groups share an ID space |
| `ref/group-cycle` | groups contain each other | fix the `group:` chain |
| `component/unknown` | component name not in the registry | choose one from `sumi catalog` (the hint lists the right kind) |
| `component/wrong-kind` | a node component on an edge, etc. | use a component of the right kind |
| `component/unknown-variant` | variant not listed for that component | use one from the hint / catalog |
| `component/unknown-prop`, `component/invalid-prop` | prop not in the component's schema, or a bad value (e.g. `px`, not a multiple of 0.5pt) | remove it, or use the value the hint suggests |
| `component/missing-label` | a text-only component (`label`) has no text | give it a label or use another component |
| `component/deprecated` (warning) | still works but is being replaced | switch to the replacement in the message |
| `theme/unknown` | `figure.theme` is not built in | `minimal` or `academic` (see hint) |
| `theme/missing-variant` (warning) | the theme has no style for that variant | usually ignore; choose another variant if it matters |
| other `theme/*` | a problem in a theme definition | not fixable in the figure — report it |
| `profile/unknown` | `figure.profile` is not built in | `paper-single`, `paper-double` or `presentation-16x9` (see hint) |
| `profile/font-too-small` | text is smaller than the profile's minimum | a user decision: another profile or theme. Currently every built-in theme fails `presentation-16x9` (14pt minimum) |
| `lint/*` | structural warnings — see `docs/lint-rules.md` | below |

### Structural lint (`lint/*`)

| Code | Default | Fix |
| --- | --- | --- |
| `lint/empty-figure` | warning | add nodes |
| `lint/no-edges` | warning | connect the nodes, or keep it if unconnected nodes are intended (say so) |
| `lint/ancestor-edge` | warning | connect elements that are both inside or both outside the group |
| `lint/self-loop` | info | remove if unintended |
| `lint/duplicate-edge` | warning | remove the duplicate or give it a different label |
| `lint/empty-label` | warning | add a label, or keep it for a deliberate blank shape |
| `lint/long-label` | warning | shorten or break with `\n` (≤ 40 columns per line, CJK = 2, ≤ 4 lines) |
| `lint/missing-glyph` | warning | replace the character (emoji and rare CJK are not in the font) |

To silence a rule for one run: `sumi lint --rule lint/no-edges=off`. There
is no per-figure suppression; mention kept warnings in your report instead.

### Render (`sumi render`)

| Codes | Meaning | Fix |
| --- | --- | --- |
| `svg/empty-figure` | no nodes or groups to draw | add elements |
| `backend/d2-not-found`, `backend/d2-version-mismatch` | D2 missing or not v0.9.0 | user runs `bun run d2:install` (or sets `SUMI_D2_PATH`); stop |
| `backend/d2-failed`, `backend/d2-timeout`, `backend/empty-output`, `backend/io-error`, `backend/invalid-args` | D2 itself failed | not a figure problem; report with the message (use `--emit-d2 out.d2` to keep the generated source) |
| other `svg/*` (`svg/invalid`, `svg/missing-element`, `svg/missing-font-face`, …) | the SVG did not pass Sumi's own checks | a Sumi bug, not a figure problem; report it |

### Geometry lint (`geometry/*`, when available — #13)

Produced by `sumi lint --geometry` and by `sumi render` once geometry lint
has landed. The SVG is still written; errors make the exit code 1.

| Code | Default | Fix |
| --- | --- | --- |
| `geometry/exceeds-page-width` | error | `direction: down`, shorter labels, fewer nodes per layer; or ask whether a wider profile is acceptable |
| `geometry/exceeds-page-height` | error | `direction: right`, fewer layers, or split the figure |
| `geometry/text-too-small` | error | as `profile/font-too-small` |
| `geometry/label-overflow` | error | remove or enlarge explicit `width`/`height`, shorten the label |
| `geometry/out-of-canvas` | error | report (layout problem) |
| `geometry/node-overlap` | warning | change direction or grouping |
| `geometry/label-collision` | warning | shorten edge labels or drop non-essential ones |
| `geometry/edge-crosses-label` | warning | see layout-tips: edges entering a group from outside |
| `geometry/aspect-distorted` | warning | shorter label on `circle`/`square`, or use `ellipse`/`box` |
