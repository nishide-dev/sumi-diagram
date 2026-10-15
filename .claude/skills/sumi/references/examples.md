# Worked examples

Real runs of the workflow (outputs abbreviated). `sumi` is the skill's
`scripts/sumi` wrapper. Every complete figure on this page is checked by the
repository's tests (`src/cli/skill.test.ts`): a `# expect-error:` comment
lists the errors `sumi lint` must report, `# expect-render:` whether the
rendered width fits the profile.

## 1. Success: a decision flow

Request: "Draw a flowchart of a cache lookup for one column of a paper:
request, check the cache, check freshness, fetch from origin on a miss or
stale entry, update the cache, respond."

The content is fully given, the target is `paper-single`; nothing to ask.

```sh
$ sumi doctor
ok      d2             D2 v0.9.0 (env: …/.sumi/bin/d2)
ok      fonts          3 bundled font files present, sha256 verified
Ready to render.
$ sumi catalog --kind node      # → ellipse (terminals), diamond (decisions), box (steps)
```

```yaml
# expect-render: fits
version: 1
figure:
  id: cache-lookup
  title: Cache lookup
  theme: minimal
  profile: paper-single
  layout:
    direction: down

nodes:
  - id: request
    component: ellipse
    label: Request
  - id: cached
    component: diamond
    label: "In cache?"
  - id: fresh
    component: diamond
    label: "Fresh?"
  - id: fetch
    component: box
    label: "Fetch from\norigin"
  - id: update
    component: box
    label: Update cache
  - id: respond
    component: ellipse
    label: Response
    variant: emphasis

edges:
  - from: request
    to: cached
  - from: cached
    to: fresh
    label: "yes"
  - from: cached
    to: fetch
    label: "no"
  - from: fresh
    to: respond
    label: "yes"
  - from: fresh
    to: fetch
    label: "no"
    variant: dashed
  - from: fetch
    to: update
  - from: update
    to: respond
```

```sh
$ sumi fmt cache-lookup.sumi.yaml
$ sumi lint --json cache-lookup.sumi.yaml | jq -c .summary
{"errors":0,"warnings":0,"infos":0}
$ sumi render cache-lookup.sumi.yaml
Wrote cache-lookup.svg: 48.86mm × 154.87mm (paper-single, max width 88mm; theme minimal).
$ <skill-dir>/scripts/preview cache-lookup.svg   # then Read the PNG
```

Inspection: top-to-bottom flow, both decisions readable, edge labels sit on
their lines (known, see layout-tips). Report: files, 48.9 × 154.9mm within
paper-single, no diagnostics; note that the figure is tall (6 layers) and
that `emphasis` marks the end state and `dashed` the stale-entry path.

## 2. Failure: an unknown component

Request: "A small web service architecture: browser, web server and API in
an application tier; database, cache and job queue in a data tier; a worker
that consumes the queue." A first draft used a component name that sounded
right but is not in the catalog:

```yaml
# expect-error: component/unknown
version: 1
figure:
  id: web-service
  profile: paper-double
groups:
  - id: data
    label: Data
nodes:
  - id: api
    component: box
    label: API
  - id: db
    component: database
    label: Database
    group: data
edges:
  - from: api
    to: db
```

```sh
$ sumi lint --json web-service.sumi.yaml | jq -c '.results[0].diagnostics[] | {code,path,hint}'
{"code":"component/unknown","path":["nodes",1,"component"],"hint":"Known node components: box, square, circle, ellipse, diamond, hexagon, parallelogram, cylinder, document, label."}
$ sumi catalog --kind node | grep -i storage
sumi/cylinder       node  default,emphasis,muted  A cylinder, e.g. for storage.
```

Fix: `component: cylinder` at `nodes[1].component`, then `fmt` → `lint`
(0 errors). Do not invent a `database` component or ask for one to be
added; the catalog has a generic shape for the role.

## 3. Failure: too wide for the target

Request: "An ETL pipeline for one paper column: raw files → extract →
clean → load → warehouse → report, with rejected rows going from clean
straight to the report." Lint is clean, but the render reports the size:

```yaml
# expect-render: too-wide
version: 1
figure:
  id: etl-pipeline
  theme: academic
  profile: paper-single
  layout:
    direction: right
nodes:
  - id: sources
    component: parallelogram
    label: Raw files
  - id: extract
    component: box
    label: Extract
  - id: clean
    component: box
    label: Clean
  - id: load
    component: box
    label: Load
    variant: emphasis
  - id: warehouse
    component: cylinder
    label: Warehouse
  - id: report
    component: document
    label: Report
edges:
  - from: sources
    to: extract
  - from: extract
    to: clean
  - from: clean
    to: load
  - from: load
    to: warehouse
  - from: warehouse
    to: report
  - from: clean
    to: report
    label: rejects
    variant: dashed
```

```sh
$ sumi render etl-pipeline.sumi.yaml
Wrote etl-pipeline.svg: 182.56mm × 32.46mm (paper-single, max width 88mm, TOO WIDE; theme academic).
```

With geometry lint available, the same run reports
`geometry/exceeds-page-width` (error, exit 1) and still writes the SVG.

Fix: a six-step chain cannot fit 88mm side by side, so change the layout,
not the target: `direction: down`.

```yaml
# expect-render: fits
version: 1
figure:
  id: etl-pipeline
  theme: academic
  profile: paper-single
  layout:
    direction: down
nodes:
  - id: sources
    component: parallelogram
    label: Raw files
  - id: extract
    component: box
    label: Extract
  - id: clean
    component: box
    label: Clean
  - id: load
    component: box
    label: Load
    variant: emphasis
  - id: warehouse
    component: cylinder
    label: Warehouse
  - id: report
    component: document
    label: Report
edges:
  - from: sources
    to: extract
  - from: extract
    to: clean
  - from: clean
    to: load
  - from: load
    to: warehouse
  - from: warehouse
    to: report
  - from: clean
    to: report
    label: rejects
    variant: dashed
```

```sh
$ sumi render etl-pipeline.sumi.yaml
Wrote etl-pipeline.svg: 42.69mm × 130mm (paper-single, max width 88mm; theme academic).
```

Had `down` still been too wide (e.g. many parallel branches), the next
step is to ask the user whether `paper-double` is acceptable — not to
switch silently.
