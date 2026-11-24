# Run 9 a2a-task
Start: 2026-11-22 03:03:28

## Setup
- Sumi v0.20.0 binary, `doctor --skill-version 0.20.0`: Ready to render, versions match.
- Request: row 9, state transition of an A2A Task (README profile `screen-doc`, theme `sumi`, textScale 1.5 per `textScaleFor`).

## Source facts (A2A spec + "Life of a Task" topic page)
- Spec §4.1.3 TaskState: SUBMITTED ("successfully submitted and acknowledged"), WORKING ("actively being processed"), INPUT_REQUIRED and AUTH_REQUIRED ("interrupted state"), COMPLETED ("finished successfully"), FAILED ("finished with an error"), CANCELED ("canceled before completion"), REJECTED ("agent has decided to not perform the task") — the last four "terminal state".
- Spec §3.4.3: agent requests input by moving the task to input-required; "The client continues the interaction by sending a new message with the same taskId and contextId".
- Spec §7.6.1: agent MUST move to AUTH_REQUIRED; agents SHOULD accept messages to the task while in it and MAY continue processing after receiving the credential.
- Spec §3.1.5 / §3.3.2: CancelTask "Requests the cancellation of an ongoing task"; TaskNotCancelableError once terminal.
- Spec §3.1.1: tasks in a terminal state cannot accept further messages.
- Life of a Task, "Task Immutability": "Once a task reaches a terminal state (completed, canceled, rejected, or failed), it cannot restart"; follow-ups "must initiate a new task within the same contextId". "Task Refinements": refinements reuse contextId and point at earlier work with referenceTaskIds.
- Not stated in the source: an explicit transition table. Interpretation (presentation, logged): completed/failed drawn from working; canceled and rejected drawn from the non-terminal group as a whole (cancel applies to any ongoing task; the source does not say from which state an agent rejects).

## Layout choice
- Base layout: `state-machine` (start dot, states, labelled transitions). Adapted to a vertical arrangement: submitted above working, the two interrupted states left/right of working with a pair of edges each, terminal states in a framed row below, a dashed "new task" below that.
- Mockup: yes (SKILL step 4: state machines are non-trivial layouts).
renders: 1 (draft1)
- Mockup rounds: 2. Round 1 had the start label crossing the group frame and "success"/"error" over the terminal group title; round 2 moved the start dot inside the group (horizontal into submitted) and turned the terminal title into a caption below the frame.
- Render 2 (final): start dot moved left (draft1 had `geometry/edge-label-detached` info on "SendMessage", the 14mm span could not hold the label), new task moved under the terminal frame with `fromAnchor: straight, toAnchor: north` (draft1 entered it from the east with a hook).

## Final
- Renders: 2 (+1 colour probe in scratch). final.svg 174.1 x 121.2mm, screen-doc, theme sumi, textScale 1.5.
- Final `lint --geometry`: 0 errors, 0 warnings, 1 info (`geometry/group-empty-area` on the Non-terminal group, 83.8%: the group is wide because the two interrupted states sit left/right of working; the empty top-left holds the title. Kept).
- Content check (PNG): 8 states + start + new task present; all 11 edges point the right way, labels readable at 10.5pt.
- Where Sumi differed from the mockup: nested `place` boxes are normalised, so aligning the two groups (failed under working) needed group centres computed by hand from content extents with `origin: body`; otherwise matched.

## What was hard / not expressible
- The source has no transition table; deciding which states reach canceled/rejected was the hardest call. Drawn from the Non-terminal group frame, which Sumi allows (edge from a group), but the follow-up edge from the Terminal frame leaves at the left end (`straight` to the new task under it), so it can be read as coming from `completed` only.
- Nested `place` per group with page-level alignment: no way to say "same coordinate system" across groups; had to compute centres.
- A short initial→first-state span cannot hold an edge label; the info said no placement was clear; the only fix was a longer span.
- Big void in the Non-terminal group (info) is inherent in the left/working/right arrangement.
End: 2026-11-22 03:08:00
