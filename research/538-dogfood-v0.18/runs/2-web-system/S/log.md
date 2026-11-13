# Run 2 web-system (S)

Start: 2026-11-14 03:00:54

## Plan

- Placement: slide, `presentation-16x9` (338.7 × 190.5mm, 14pt min), theme `sumi`, `textScale: 2` (catalog `textScaleFor`).
- Base layout: **none** fits (layouts are encoder-block, train-infer-panels, compare-rows, set-taxonomy; none is a tiered system). Closest example used for idioms: `examples/system-architecture` (tiers as groups, cylinders, double-arrow reads/writes, dashed path).
- Engine: structured (grid of tiers) rather than auto, so the slide keeps aligned columns and edge labels scale with textScale (layout-tips: auto edge-label gaps do not follow the scale).
- Mockup: **yes** — not a one-directional flow: four tiers plus a branching async path below and an external system; arrangement is not obvious (SKILL step 4 rule).
- Content checklist: Browser, Mobile app (Clients); CDN; API gateway; Auth / Order / Inventory services; PostgreSQL; Redis cache; Message queue; Async worker; external Payment API.
- Connections (the request lists components only; I chose the usual wiring and report it as an assumption): Browser→CDN, Mobile→CDN, CDN→Gateway, Gateway→Auth/Order/Inventory, Services↔PostgreSQL and Services↔Redis (read/write, shared by all three), Order→Queue (publish, async), Queue→Worker (async), Worker→Payment API (charge), Worker→PostgreSQL (update).
- Visual language: clients plain boxes; gateway `emphasis` (focus, the single entry); CDN outlined; services blue tinted; data stores green tinted cylinders; async parts orange tinted; external Payment API dashed box. Solid arrow = synchronous call, dashed = asynchronous message; one legend at the bottom.
- Probe render of theme colours: ink #30364f, canvas #f8f8ee, group #efeddd, blue #d9e4e6/#3d5d77, green #dce7d3/#426344, orange #efdfce/#814b2d; text 16/18/14pt, lines 2pt.

## Rounds

- Mockup: 2 rounds (round 1: the publish arrow crossed the "Async processing" title and the bottom-left was empty → title moved to the bottom, legend moved bottom-left).
- Render 1 (draft1): structured grid of 6 columns, async tier as a group spanning 2 grid columns, align x order/queue and postgres/worker. 1 error (374.8mm > 338.7mm: the async group's row was wider than the two columns it spans), 7 warnings: `unsatisfied-align` (order/queue in the same grid track chain), 4× `edge-on-border` (gateway fan-out and service→store trunks ran on the Services/Data frames), legend dash-hidden, charge label on the group border.
- Render 2: async group replaced by a `rect` set around queue + worker (sets take no space, so queue/worker sit in the services/data grid columns and line up for free); gateway→Services and Services↔Data drawn as single group-level edges; clients group → CDN. Fits (326mm). Warnings: "read / write" label collided with Auth (10mm gap), set outline crossed publish/charge labels, orange set fill over orange nodes looked muddy.
- Render 3: dropped the read/write edge label (moved to legend), publish label at start, set padding 3mm dashed. Clean except legend dash-hidden. Visual check: dashed set frame next to the dashed external box read as the same thing; queue→worker arrow cramped.
- Render 4 (final): set `outlined` orange, columnGap 12mm (336.2mm wide), legend reduced to the two line styles.

## Final

- Size 336.2 × 134.2mm on `presentation-16x9` (99.3% width use), text 16/18/14pt (target min 14pt met).
- Lint: `lint` 0/0/0; render 0 errors, 1 warning, 1 info. Kept: `geometry/dash-hidden` on the legend's dashed sample — the legend sample length is fixed and even `arrowheadScale: 0.5` on the sample does not leave room for the dash at textScale 2; the info is `placement-usage`.
- Renders: 4 (plus 1 theme-colour probe).
- Layout: none (no base layout matches a tiered system); example `system-architecture` used for idioms. Mockup: yes.
- Content check: all 12 components present; arrows: Clients→CDN→API gateway→Services, Services↔Data, Order⇢Message queue (publish), queue⇢Async worker, worker→PostgreSQL (update), worker→Payment API (charge). Assumed wiring (request gave only components): both clients go through the CDN; all services read/write both stores (one group-level double arrow).

## What was hard / what Sumi could not express

- A tier that spans two grid columns cannot have its members aligned with the columns above it (`layout/unsatisfied-align`); the workaround was a `rect` set as the tier frame — but a set is not a group, so its label style differs from the group titles (tone-coloured, outside the frame).
- Fan-out from one node into three nodes in a framed group draws the trunk on the group border (`edge-on-border`); I had to fall back to group-level edges, losing per-service and per-store links (e.g. which service uses Redis).
- Legend samples have a fixed length, so a dashed arrow at textScale 2 cannot show its dash (warning kept).
- No control over edge label placement offset: "charge" sits above the arrowhead's segment end, a bit detached from its short edge.
- Ended: 2026-11-14 03:04:35
