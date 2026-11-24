# Run 10 kafka-queues log

Start: 2026-11-22 03:03:28

## Plan (03:10)

- Source read: KIP-932 wiki page (sections "Concepts", "Share group membership", "In-flight records", "Record delivery and acknowledgement", "Persistence and fail-over", "Using the share coordinator from the group coordinator / from the share-partition leader", "Fetching and acknowledging records", configuration defaults).
- Target: slide, `presentation-16x9`, theme `sumi`, `textScale: 2` (catalog textScaleFor).
- Structure: two panels side by side. (a) roles and RPCs: share group of consumers on top, brokers below (group coordinator, share-partition leader, share coordinator, `__share_group_state`). (b) record state machine.
- Base layouts considered: `client-service-data` (columns did not fit the slide width once 14pt RPC labels were added), `nested-containers`, `state-machine`. Started from `state-machine` for panel (b) and the frame idea of `nested-containers` for (a); panel (a) planned from scratch.
- Mockup: yes (two panels + state machine with a loop: Skill says mock it up).
- Visual language: consumers = plain outlined boxes; broker roles = blue tinted; internal topic = orange tinted cylinder; states = plain boxes, Acquired = emphasis (focus, holds the lock), Archived = gray tinted (terminal). Colours from a probe render (blue #d9e4e6/#3d5d77, orange #efdfce/#814b2d, gray #e1dece/#4e566b, ink #30364f).

## Renders
- Render 1 (draft1): 334 x 198mm, 1 error (exceeds-page-height), 3 warnings (label-collision x3), 3 infos.
- Render 2: height fixed (stack gap 26 -> 18mm, panel (b) compressed), anchors on gc->sc (south/west) and sc->topic (south/east) to match the mockup, `labelSide: right` on the leader->coordinator label (it crossed the Brokers frame), heartbeat label moved up (`labelAt: 0.4`) so it no longer read as part of the "Brokers" title, "release" lane moved from east to west so it no longer shared a bus trunk with "reject". 0 errors, 0 warnings, 2 infos.
- Render 3: panel (b) states spread to use the panel height; `labelAt: middle` on the release lane. 0/0/2.
- Render 4: tried `row.align: stretch` to give both panels one bottom line: the figure grew from 190.2 to 200.9mm (exceeds-page-height) although panel (b) was already shorter than (a); reverted.
- Render 5 (final): same YAML as render 3.

Total renders: 5 (plus one colour probe render and one mockup screenshot).

## Final lint
`lint`: 0 errors, 0 warnings, 0 infos. `render`: 0 errors, 0 warnings, 2 infos, both `geometry/group-empty-area` (brokers 78%, panel-b 88%): kept. They come from the open space that the 14pt edge labels (RPC names) and the state-machine lanes need; the hint verified no remedy. Size 334.4 x 190.2mm (presentation-16x9 max 338.7 x 190.5).

## Layout and mockup
- Base layout: `state-machine` (panel b, adapted to a vertical chain with two lanes); panel (a) from scratch (closest were `client-service-data` / `nested-containers`, but a column layout did not fit the slide width with the RPC labels).
- Mockup: yes (two panels + a state machine with loops). Mockup -> YAML differences: Sumi routed gc->sc out of the east side until anchors were written; lane labels default to the lane's start (beside the source), detached; the mockup's two east lanes from Acquired would become one bus in Sumi, so release moved to the west.
- Step 7.4 (compare against references) skipped: it is mandatory for paper figures and this is a slide; self-critique done on the PNG instead.

## Source facts shown (KIP-932 wiki page)
- Share consumers join a share group; they send ShareGroupHeartbeat to the group coordinator ("Share group membership").
- Consumers fetch and acknowledge with ShareFetch / ShareAcknowledge to the share-partition leader ("Fetching and acknowledging records").
- Group coordinator -> share coordinator: InitializeShareGroupState ("Using the share coordinator from the group coordinator").
- Share-partition leader -> share coordinator: ReadShareGroupState / WriteShareGroupState ("Using the share coordinator from the share-partition leader").
- Share coordinator persists state in the internal topic `__share_group_state` ("Persistence and fail-over").
- Record states Available, Acquired, Acknowledged, Archived; transitions: fetch acquires (Available -> Acquired, delivery count +1); accept (-> Acknowledged); release or acquisition-lock timeout (-> Available, while below the delivery limit); reject or delivery limit reached (-> Archived); Acknowledged -> Archived when the SPSO moves past ("In-flight records", "Record delivery and acknowledgement").
- Not shown (kept the slide light): DeleteShareGroupState, ReadShareGroupStateSummary, FindCoordinator, defaults (lock 30 s, 5 delivery attempts), log-retention archiving, the three consumers are illustrative.

## What was hard / what Sumi could not express
- 14pt minimum edge labels on a slide make long RPC names (InitializeShareGroupState ~68mm) dominate the layout; RPC pairs had to be two-line labels.
- `row.align` accepts start/center/end/stretch, not top (first lint error); stretch grew the figure by 10mm instead of only extending the shorter panel.
- Two lanes on the same side from one source become a bus by rule; two independent loops from one node on one side are not expressible without anchor tricks (that give lane-bus-split warnings).
- Panel bottoms are not aligned (panel b ends a few mm above panel a) with align: start.
- Edge from a group (share-group) works, but the sides of the group frame it leaves from are chosen by Sumi.

End: 2026-11-22 03:08:49
