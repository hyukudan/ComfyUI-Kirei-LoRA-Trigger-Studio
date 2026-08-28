# Independent review — Claude Fable 5

Date: 2026-08-28. An early development snapshot was reviewed using Claude Code, model `claude-fable-5`, in read-only mode at the user's request. The reviewer made no changes.

## Findings and follow-up

| Finding | Implementation decision |
|---|---|
| Changing a LoRA reset strengths and enabled state | Preserve both; apply the new entry's default trigger selection. Covered by regression tests. |
| Fixed height and too many controls per row | Adaptive/resizable height, individual/global collapse controls, and expandable notes. |
| Missing files should be flagged before execution | Check on node creation/restoration and provide a refresh button; backend validation remains authoritative. |
| Global enable controls and shared/separate strengths | Included and tested. |
| JSON storage with atomic writes, backup, and revision checks | Retained for the current scope. |
| Identical relative paths across multiple model roots | Follow ComfyUI's normal resolution and document the limitation. |
| Inferring trigger words from training tags | Not included; only explicit fields with user review. |
| Local previews, dragging, and row duplication | Added after the review; duplicates start disabled. |

## Limits

This report describes a review of an early snapshot, not a second review or approval of the final implementation.

The reviewer read code but did not run ComfyUI or inspect screenshots. An inference that widget hiding had already been visually verified was not supported. DOM tests and real registration/API checks do not replace a full real-canvas check.

Widget hiding uses classic frontend conventions (`converted-widget` and a DOM widget). Compatibility with other frontends requires separate testing. See [verification notes](verification.md) for the actual checks and outstanding limits.
