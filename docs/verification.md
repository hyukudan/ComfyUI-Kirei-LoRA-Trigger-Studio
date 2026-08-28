# Verification — 0.1.0

Date: 2026-08-28.

## Automated checks

- **36 Python tests: 35 passed, 1 skipped.** Library persistence, backups, conflicting edits, conservative import, path/type validation, metadata, strengths, native-loader delegation, and thumbnails. Image checks cover filename precedence, formats, pixel/byte limits, fixed output sizes, and missing images. Validation, conflict, and metadata messages are checked in English. The escaping-symlink test is skipped because this Windows environment does not permit creating symlinks.
- **36 JavaScript/DOM tests passed.** Trigger selection, presets, serialization, entry creation/cancellation, metadata review, import, enable-all, shared/separate strengths, preserving strengths when changing a file, compact rows, and missing-file warnings. Also covers independent disabled duplicates, local dragging, ignoring external drops, keyboard focus, and thumbnail controls. English controls, dialog titles, accessibility labels, placeholders, tooltips, and validation messages are checked explicitly; multilingual user triggers, labels, preset names, and notes survive editing unchanged.
- JavaScript syntax and Git whitespace checks.

## Real ComfyUI API checks

An isolated CPU-only ComfyUI instance was used with a temporary library, separate from the user's main instance:

- **10 library/registration checks:** node registration and ports, library reads, local metadata reads, entry save, revision conflict, invalid path rejection, content type, import, and export.
- **6 thumbnail checks:** 96 px and 640 px WebP responses, missing image (204), two invalid sizes (400), and directory traversal rejection (400). Images and header-only model fixtures were confined to a temporary test folder; no fixture model weights were loaded.
- Frontend modules served from `/extensions/ComfyUI-Kirei-LoRA-Trigger-Studio/`.

Node registration: `LoRATriggerStudio` → **Kirei LoRA Trigger Studio**, category `Kirei/loaders`. MODEL is required, CLIP is optional; outputs are MODEL, CLIP, and trigger_words.

## Not yet manually verified

- Real-canvas appearance, final widget dimensions, zoom behavior, and native dragging. Browser navigation was blocked by policy during testing; no alternative route was used to bypass that restriction.
- Actual GPU generation with LoRA weights. Loader tests verify delegation and parameters, not generated-image quality.
- Compatibility with frontends other than the classic web frontend.

## Local development installation

The repository is linked through a Windows junction at `ComfyUI/custom_nodes/ComfyUI-Kirei-LoRA-Trigger-Studio`, without a duplicate installation. Restart ComfyUI and reload its page after installation or updates. The main ComfyUI instance was not restarted or interrupted during testing.

Personal library data and test artifacts are not included in the repository.
