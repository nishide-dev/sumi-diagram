# Run 2-web-system / B

Start: 2026-11-13 15:38:36

## Setup notes

- Theme `sumi` is not compatible with `presentation-16x9` (7-9pt text vs the profile's 14pt minimum; `profile/font-too-small`). Checked: `figure.target.minFontSize: 8pt` overrides the profile minimum and lints clean. Decision: keep `presentation-16x9` + `sumi`, set `target.minFontSize: 8pt`, and design the figure at about 180 x 101mm (16:9) so that, placed full-width on a 338.7mm slide, 8pt text projects at about 15pt (7pt edge labels at about 13pt). The SVG's physical size is therefore smaller than the slide; it is meant to be scaled up when placed.

## Mockup (condition B)

- Round 1 (15:40): grid of five columns (Clients | CDN | API gateway | Services | Data) plus an async row below. CSS bug made edge labels huge; worker->PostgreSQL edge tangled through group titles.
- Round 2: dropped the worker->PostgreSQL edge (my own addition, not requested), put Payment API under the Data column in a dashed External group so the right column has no void. Order moved to the bottom of the services stack so Order->queue is a straight drop. Remaining: the order->queue arrow crossed the "Async processing" title.
- Round 3: async and external titles moved to the bottom. Accepted: void under CDN/gateway at the bottom-left holds the legend.
- Visual language: clients/CDN default boxes; API gateway emphasis hexagon (the single accent); services blue tinted; data stores green tinted cylinders; queue/worker orange tinted; external = dashed frame, muted node; solid arrow = synchronous request, dashed arrow = asynchronous message (legend).

## Sumi reproduction

- Approach: structured layout, root `grid` of 5 columns (Clients | CDN | API gateway | Services | Data), second row = legend (span 3) + a row of [Async processing, External] (span 2). Cross-tree `align` for auth/redis, clients/cdn/gateway/inventory and worker/payment.
- draft1 (render 1): rendered with 2 errors (`geometry/text-too-small`: the sumi theme draws edge labels at 7pt, below my 8pt target), `dash-hidden` on queue->worker, `label-collision` of "charge" on the External frame, and an uneven gap in the Services stack caused by the align struts. Column widths were driven by the wide async group under Services.
- Fixes: target lowered to 7pt (the theme's smallest text; projected about 10-13pt depending on how large the figure is placed); `groupLabelWeight: bold`; cylinders sized explicitly (`width: 73.5pt, height: 46pt` - mm values are rejected unless on the 0.5pt grid, and 37pt/42pt overflowed the label); async+external as one spanning row so the Services/Data columns keep their natural width; grid cells wrapped in single-item stacks so the y-align can move them (`layout/unsatisfied-align` until then); "charge" label at `labelAt: start`; data stack gap hand-tuned (21mm) so PostgreSQL lines up with Order without a strut.
- Tried `density: compact` (render 7): shorter, but four `geometry/edge-near-border` (fan-out trunks hugging the Services/Data frames) and a 2.3:1 aspect; reverted.
- Renders: 12 (including 3 quick height trials for the cylinders).

## Final

- Size 232.8mm x 116.2mm (2.0:1), profile presentation-16x9, theme sumi, `target.minFontSize: 7pt`.
- Final lint: `lint` 0/0/0; `render`: 0 errors, 0 warnings, 1 info (`geometry/placement-usage`, informational).

## Where Sumi did not match the mockup

- Theme/profile mismatch: `sumi` (7-9pt) cannot meet `presentation-16x9`'s 14pt; only the target override makes it lint. Text does not scale with the slide profile, and the profile's 8mm padding / 16mm gaps make the figure 233mm wide instead of the mockup's 180mm, so text is smaller relative to the figure (projected about 11pt / 9.5pt for edge labels at full slide width, vs about 15pt in the mockup).
- No dashed node variant: Payment API is `muted` inside a dashed group (mockup: dashed box).
- Cylinders are taller than the mockup's (minimum height for the label inside the body is about 46pt), so the Data column is taller than Services and has a void between the two stores.
- Group frames are wider (padding), and the Services column and async group are left-aligned via grid `align: start` rather than exact positions; External sits beside async rather than exactly under Data.
- `rsvg-convert` ignores the SVG's embedded fonts, so the PNGs show group titles and the gateway label in regular weight and a fallback face; the SVG renders Inter bold in Chrome.
- Dropped my own worker->PostgreSQL edge already at the mockup stage (not part of the request).

End: 2026-11-13 15:44:53
