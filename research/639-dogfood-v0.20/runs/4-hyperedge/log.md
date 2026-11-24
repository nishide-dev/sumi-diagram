# Run 4 hyperedge log

Start: 2026-11-22 03:03:28

## Setup
- Source: NSDI 2026 paper PDF (usenix.org/system/files/nsdi26-wei.pdf), saved to scratch/src/, text via pdftotext.
- `sumi doctor --skill-version 0.20.0`: Ready to render, Skill matches CLI.
- Theme `sumi` (given), profile `paper-double` (given). No venue minimum given: profile default 7pt.

## Source facts to show (section refs)
- §3: system = client-side library on user devices, tracker cluster in data centers, set of Hdevices (under-utilised, dispersed), external CDN offering auxiliary support; CDN stores all videos.
- §2.2 / Abstract: Hdevices = set-top boxes, smart home gadgets, idle (dormant) servers; §1: ~100,000 edge devices; §2.2: most behind NAT.
- §3 / §4.2 tracker: frontend metadata store (map video ID → Hdevices, also tracks query statistics) and a component that keeps Hdevice state (DB); combines popularity and per-region resources into the caching distribution.
- §3 video download: (1) client fetches first segments from the CDN; (2) client sends request with video ID to tracker; (3) tracker returns list of Hdevices storing the video (§4.1.1: up to 20); (4) client connects to them, NAT punching when needed; (5) client downloads remaining segments concurrently from all connected Hdevices (multi-path; §4.1.1 active set = first 8 connections).
- §3 content distribution: (a) tracker records per-video download frequency (5-min intervals); (b) tallies Hdevice resources per region -> optimal caching distribution; (c) each Hdevice sends keepalive with status (§4.3: every 30 s); (d) tracker piggybacks new video IDs on the keepalive reply; (e) Hdevice fetches each new video (§1: CDN is "backend storage" for HyperEdge; §4.2.1 redistribution uses bandwidth of Hdevices and the CDN); (f) Hdevice confirms, tracker updates the video ID → Hdevice map.
- §4.1.3: CDN is also the fallback (client switches back to CDN on HyperEdge errors).

## Planning
- Layouts viewed: client-service-data, nested-containers, actors-and-tools. Started from **actors-and-tools** (icon + label actor cards, operations as edge labels); its row arrangement does not fit a 4-party network, so the arrangement is replaced by one `place` (diamond: tracker top, client left, Hdevice pool right, CDN bottom).
- Examples viewed: system-architecture (tiers), actors-and-tools YAML.
- Mockup: **yes** — four parties with two interleaved numbered workflows and a multi-path fan is not an obvious arrangement (SKILL step 4 rule).
- Visual language: actors/objects = icon + label (Tabler); Hdevices tinted green (the subject), Hdevice pool = group frame; tracker parts = plain boxes with sublabel; download workflow edges = blue, content-distribution edges = orange; step numbers in edge labels (1–5, a–f); one legend.
- Mockup round 1 (mockup.png): content complete; defects seen: (2)/(3) cross near the client (fix: (2) into upper half of Index map on the outer lane), pool title collides with (c)/(d) entries (fix: title at bottom). Carried into YAML rather than re-mocked.

## Rounds
- Render 1 (draft1): `geometry/exceeds-page-width` (183.09mm), `layout/lane-blocked` ((f) lane through the above-left tracker title), `geometry/label-collision` ((f) label on tracker border). By eye: (1) detoured around the legend (legend was in the L path), (4) nearly merged with the set-top-box line.
- Render 2: tracker title -> `labelAt: bottom-left` (lane then clear), legend to a column right of the (1) path, row gap 24->20mm, fan ends to one point. Still 183.09mm wide: in a root `place` the width is set by the outer coordinates (client and pool), so shrinking the tracker did nothing; the width hint said "no gap, padding or explicit width to reduce" and offered only removing the client width, never "move place coordinate x". New warnings: edges converging on one point flagged `geometry/edge-near-edge` and `edge-crosses-label`.
- Render 3 (final): pool x 158->154, fan ends spread east:0.45/0.6/0.75, (5) label `labelAt: 0.45`. 179.03mm x 94.02mm, clean.
- Renders: 3 (plus 1 theme-colour probe).

## Final lint
- `sumi lint`: 0 errors / 0 warnings / 0 infos. `sumi lint --geometry`: no diagnostics. `render`: 179.03mm x 94.02mm, paper-double, theme sumi, fits.

## Critique (self, against system-architecture + llada via scripts/compare; no subagent per study rules)
1 Density: medium, no block-sized void except the title band of the tracker frame (holds the title). 2 Sizes: boxes equal height, one stroke weight. 3 Vocabulary: one legend, blue = download, orange = distribution everywhere, green only on Hdevices. 4 Colour: white ground, 3 hues, no colour on colour. 5 Text: labels <= 4 words plus step code. 6 Flow: steps numbered 1–5 / a–f; download path reads bottom-left -> top -> right -> back; not a single direction, numbers carry the order. 7 Subject: green Hdevices stand out; the client is plain. Kept: (1) label sits ~2mm above the legend (moving the legend down would hit the CDN box).

## What was hard / not expressible
- Width fix in a root `place`: the width breakdown does not consider moving a place coordinate (the actual lever).
- Multi-path fan: straight edges converging on one point are reported as `edge-near-edge` (they intentionally share the end), so the fan had to end at three spread points.
- Step numbers: no numbered-badge on edges; written as "(1)" text in the label. A circled-number tag style would read better.
- Comma in a flow-map label must be quoted (schema error "Unknown field 'fallback'" is confusing for an unquoted comma).
- Mockup: icons and legend approximated with text glyphs; group title above-left in mockup became a lane conflict in Sumi (title outside the frame blocks a north lane).

End: 2026-11-22 03:08:41
