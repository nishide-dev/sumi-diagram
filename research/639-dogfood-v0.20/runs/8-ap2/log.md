# Run 8 ap2
Start: 2026-11-22 03:03:28
End: 2026-11-22 03:09:11

## Summary
- Request: row 8 (ap2), AP2 spec v0.2, Human-Present purchase as a sequence diagram; theme `sumi`, profile `screen-doc` (`textScale: 1.5` per `textScaleFor`).
- Layout used: base layout `sequence-diagram` (one `sequence` arrange box), adapted to 6 participants, two fragments (phases), self-messages, one band row.
- Mockup: **no**. SKILL.md asks for a mockup unless the arrangement is obvious; here the `sequence` box decides every coordinate (participant order and row order are the only choices), and the base layout matches the structure exactly, so a hand-placed HTML sketch would not inform anything Sumi lets me set. Judgement call; the Skill's rule does not say whether a `sequence` box counts as "obvious".
- Renders: 8 (`sumi render`), plus 2 lint-only rejections (iconSize unit, unquoted comma in a flow mapping).
- Final: 200mm × 149.3mm (screen-doc max 200 × 150), `fit: scale` at 79.4%; smallest printed text 8.34pt (min 8pt scaled).
- Final lint (`lint --geometry`): 0 errors, 0 warnings, 1 info (`geometry/heavy-scaling`: only 0.34pt headroom over the scaled 8pt minimum; kept, because without scaling the figure is 252mm wide and no label shortening without losing meaning closes 52mm).

## Source facts shown (https://ap2-protocol.org/ap2/specification/ and the linked Flows page https://ap2-protocol.org/ap2/flows/)
- Roles (Spec "Roles"): Shopping Agent, Credential Provider, Merchant, Merchant Payment Processor, Trusted Surface; plus the User. Shopping Agent is the one role expected to be agentic (Spec "Agentic vs Non-Agentic") -> the only tinted participant.
- Two mandate types: Checkout Mandate, Payment Mandate (Spec "Mandates"). Note: v0.2 has no Intent/Cart Mandate.
- Phase 1 Shopping (Flows "Human Present", Phase 1): user initiates shopping with SA; SA assembles a cart with the Merchant; Merchant creates a signed Checkout (merchant-signed Checkout JWT, Spec "Checkout Mandate"); SA retrieves Instrument Options from the CP.
- Phase 2 Payment (Flows Phase 2; Spec "Modes > Direct (Human Present)"): SA constructs Checkout + Payment Mandate content and asks the Trusted Surface; TS renders it and obtains user authentication (e.g. biometric) and consent; TS signs both with user_sk (linked by the checkout_jwt hash); TS passes the Mandates back to SA; SA passes the Payment Mandate to CP, which verifies it and creates a payment token; SA sends token + Checkout Mandate to the Merchant; Merchant verifies the Checkout Mandate against the cart, then initiates the payment (with token and checkout_jwt hash); MPP verifies the Payment Mandate included in the token (and the hash binding); MPP-signed Payment Receipt returns to SA and CP (and Network); Merchant-signed Checkout Receipt returns to SA.
- Colour: orange = message carrying a user-signed Mandate; green dashed = signed receipt; dashed = reply. No legend (dropped for height; labels name the Mandates and Receipts).

## Left out / shortened (presentation, for the 150mm height)
- The Network (CP "may share the Payment Mandate with the payment network"; receipts also go to the Network) is not drawn: a 7th lifeline did not fit.
- "linked by checkout_jwt hash", "e.g. biometric", "with token and checkout_jwt hash", "and the binding with the checkout_jwt hash" were dropped from labels; "show" = TS renders Mandate content; "check Mandate" = MPP verifies the Payment Mandate in the token.
- The push-funds variant (Spec "Direct") is not shown.
- The SA's request for instrument options is folded into one dashed reply (CP -> SA "Instrument Options").

## What was hard
- Fitting a 6-party, ~19-message protocol into screen-doc (200 × 150mm) at textScale 1.5: draft1 was 348 × 264mm. Width and height pull against each other: wrapping labels narrows lifeline gaps but each extra line costs a row of height; `fit: scale` then helps height *because* the figure is wide. Final fit came from: one-line labels, rowGap 0.5mm, participantGap 2mm, icons `left` instead of `top` (saved ~7mm of header), one band row (Checkout Receipt beside the CP's Payment Receipt, after reordering participants to User, TS, SA, Merchant, CP, MPP so the two do not share lifelines), and `fit: scale` (79.4%).
- Each message across several lifelines puts its label in the gap next to its source, so one long label ("token + Checkout Mandate", 53mm) sets one whole gap; had to wrap it.
- The `exceeds-page-height` hint ("turn the tallest stack into a row") does not apply to a `sequence` box; nothing suggested `rowGap`, bands or icon placement.

## What Sumi could not express / workarounds
- A legend placed as a note in a band beside a message worked but made that row as tall as the legend; no way to float a legend in the empty lower-left area (User/TS lifelines are idle after consent). Dropped the legend.
- No way to send one message to two recipients (Payment Receipt to SA and CP): drew two messages.
- Fragment frames are drawn dark and as heavy as nodes in `sumi` (group frames are pale hairlines); the Phase 1 frame's right edge lands ~1mm beside the Credential Provider lifeline, so they nearly merge (Sumi places the frame; not adjustable per fragment except via tone/variant).
- SKILL/assets doc says icons default to "1.2 em", but `iconSize: 1.2em` is a schema error (mm/cm/in/pt only).
- Inline flow mapping with a comma in a label (`label: verify, create token`) is a YAML split; the error "Unknown field 'create token'" is correct but the hint could suggest quoting.

## Self-critique (in place of a subagent; step 7)
- Content: every participant and message checked against the list above in YAML and PNG; arrows point the right way; nothing added beyond the source.
- Readability: top-to-bottom order; no label overlaps a line; fragment heading "1 Shopping" sits close to "start shopping" but does not touch. The right edge of the Phase 1 frame and the CP lifeline nearly coincide (Sumi's placement). Text at 8.3pt printed is at the low end for a README.
