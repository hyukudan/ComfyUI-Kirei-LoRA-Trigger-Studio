# ComfyUI Kirei LoRA Trigger Studio

**Load multiple LoRAs, choose their trigger words, and save your combinations.**

A standalone custom node for ComfyUI, with MODEL/CLIP loading and a separate trigger-text output. It uses dependencies already included with ComfyUI, including Pillow for images. No additional node packs, accounts, or external services are required.

The interface, dialogs, tooltips, and built-in messages are in English. Your trigger words, preset names, labels, and notes retain their original language and spelling.

## Features

- Add any number of LoRA rows, with search by filename or folder.
- Enable or disable individual rows or the entire stack.
- Use a shared strength or independent **MODEL / CLIP** strengths.
- Store exact trigger words, effect labels, default selections, and usage notes for each LoRA.
- Select multiple triggers and save named presets for different effects.
- Review suggestions from explicit `.safetensors` metadata fields before saving.
- Preview the text emitted by `trigger_words` immediately.
- Collapse rows, reorder by dragging or keyboard, and duplicate rows independently.
- Show, hide, and enlarge local thumbnails.
- Get missing-file warnings before execution.
- Import and export a local JSON library, with atomic writes, a `.bak` backup, and conflicting-edit detection.
- Keep selections and entry snapshots inside each workflow, so later library changes do not silently alter it.
- No Internet requests, automatic downloads, telemetry, or external services.

## Installation

From your ComfyUI installation directory:

```bash
git clone https://github.com/hyukudan/ComfyUI-Kirei-LoRA-Trigger-Studio.git custom_nodes/ComfyUI-Kirei-LoRA-Trigger-Studio
```

Alternatively, place this entire repository in `ComfyUI/custom_nodes/ComfyUI-Kirei-LoRA-Trigger-Studio`.

Restart ComfyUI, reload the page, and search for **Kirei LoRA Trigger Studio** in `Kirei/loaders`. Searching for **Kirei** also works.

You do not need to run `pip install` or `npm install` to use the node. `package.json` contains development test tooling only. During development, you can use a symbolic link or Windows junction; do not install both a copy and a link to the same package.

## Quick start

1. Connect **MODEL**. Connect **CLIP** only if your workflow needs it; model-only use works without it.
2. Click **+ Add LoRA** and choose a file already available in your ComfyUI LoRA folders.
3. If a library entry exists, it is reused. Otherwise, the node checks metadata and opens the editor.
4. Review or enter the triggers, with one exact word or phrase per row. Optionally add an effect label, such as "Finisher." Check **Default** only for triggers you want selected when adding that LoRA.
5. Click **Save entry**, or **No triggers needed** to remember that choice explicitly. Canceling neither adds the row nor saves the entry.
6. Select the triggers you want. To save a combination, click **Save preset** and give it a name.
7. Connect **MODEL / CLIP** to their usual destinations and **trigger_words** to your prompt pipeline.

| Output | Contents |
|---|---|
| `MODEL` | Model with active LoRAs applied in row order |
| `CLIP` | CLIP with LoRAs applied, if connected to the input |
| `trigger_words` | Selected trigger text from active LoRAs |

Labels and notes are not included in the prompt. Phrases containing spaces or commas remain intact. Triggers are joined with `, `. Exact duplicates are removed while preserving case and selection order.

### Strengths and enabled states

By default, a single **Strength** controls both MODEL and CLIP. Enable **Separate MODEL / CLIP** to adjust them independently. Switching back to shared strength uses the MODEL value for both.

Changing a row's LoRA file preserves its strengths and enabled state, while replacing its trigger selection with the new entry's defaults.

Disabling a row preserves its selection but neither applies that LoRA nor emits its triggers. A row also emits no triggers when both effective strengths are zero. Without a CLIP input, CLIP strength does not count.

Removing a row only removes it from the workflow; it does not delete the model file or its library entry.

### Organizing rows

- Drag the **⠿** handle and drop before or after another row. A line marks the insertion point.
- Use each row's arrow buttons, or focus the handle and press **Alt + ↑ / ↓**. Keyboard focus follows the moved row. Use the buttons on devices without HTML5 dragging support.
- The **⧉** duplicate button creates an independent copy immediately below the original, preserving strengths, triggers, and the entry snapshot. The copy starts **disabled** to avoid accidentally applying the same LoRA twice.
- Collapse one or all rows for long stacks. Display preferences are saved in the workflow.

Reordering changes the order in which LoRAs are applied.

### Local thumbnails

**Thumbnails** shows or hides images in rows and the picker. Click a row's thumbnail to enlarge it. A missing or unreadable image produces a neutral placeholder and does not prevent loading the LoRA.

Place the image alongside the model. For `my_lora.safetensors`, these naming patterns are checked in order:

1. `my_lora.preview.png`
2. `my_lora.png`
3. `my_lora.safetensors.png`

Each pattern supports `.png`, `.jpg`, `.jpeg`, and `.webp`, in that order. The first matching file is used; replace or remove it if it is damaged. Images are not imported from URLs or downloaded. They identify the file and **do not predict generation results**.

Source images are limited to **20 MB and 16 megapixels**. The server returns WebP images with a maximum side length of 96 px or 640 px, without original metadata. Only images alongside LoRAs recognized by ComfyUI are considered; arbitrary image paths are not accepted. Browsers may cache images for up to five minutes. After replacing an image, wait or reload without cache.

## Connecting to prompts

With **ComfyUI-MiniMax-H3-Prompt-Enhancer**, connect `trigger_words` to its `lora_trigger_words` input. That input preserves the tokens after prompt rewriting, inside the appropriate description section.

For other workflows, use a text-joining node before the text encoder. For structured prompts, follow the model's required format rather than automatically appending text after the final section.

Triggers do not replace the action description. If an effect needs a combination of words or additional instructions, save it as a preset and explain it in the notes.

## JSON library

By default, the library is created when you save the first entry:

```text
ComfyUI-Kirei-LoRA-Trigger-Studio/data/lora_triggers.json
```

Paths are relative to ComfyUI's LoRA folders, include subfolders, and use `/`. Files with the same name in different subfolders have separate entries. Renaming or moving a model requires updating its library key or registering its new path.

If multiple ComfyUI root folders contain the exact same relative path, ComfyUI's normal resolution is used and those files share a library key. Use different relative filenames or subfolders to distinguish them.

This is a **fictional example**, not the real triggers for Combat or any specific model:

```json
{
  "version": 1,
  "loras": {
    "examples/my_action_lora.safetensors": {
      "triggers": [
        { "text": "example_action", "label": "Base action", "default_on": true },
        { "text": "example_finish", "label": "Finisher", "default_on": false }
      ],
      "presets": [
        { "name": "Normal", "words": ["example_action"] },
        { "name": "Finisher", "words": ["example_action", "example_finish"] },
        { "name": "No triggers", "words": [] }
      ],
      "notes": "Example: replace with the author's instructions for the exact model version."
    }
  }
}
```

You can also start from [examples/library.example.json](examples/library.example.json). A LoRA without trigger words is recorded with `"triggers": []`.

- **Edit entry** updates the library and that row's snapshot. It retains selected triggers that still exist and does not unexpectedly select new ones.
- Editing through **JSON library** does not automatically change rows in workflows that are already open.
- **Import JSON** adds unknown entries and keeps existing ones. Everything is validated before writing. It does not import model weights.
- **Export JSON** downloads the entire library.
- When editing the file manually, save valid UTF-8 JSON. Reopen the editor or picker; no ComfyUI restart is needed. A damaged file produces an error and is not replaced with an empty library.
- If two editors attempt to save against different revisions, the second receives a warning to reopen its entry.
- The library and its backups are excluded from Git. Back them up through export or your usual backup system.

To store data outside the repository, set `LORA_TRIGGER_STUDIO_LIBRARY` to the JSON file's full path **before starting ComfyUI**. The library is shared by that ComfyUI instance; it is not a multi-user database. Use different paths or coordinate writes across multiple instances. The write lock protects editors within one instance, not independent processes.

## Metadata: what is detected

Only the `.safetensors` header is read, not the tensors. These explicit fields are checked:

```text
modelspec.trigger_phrase
trigger_phrase
trigger_word
trigger_words
ss_trigger_words
activation_text
```

Suggested triggers are shown alongside their source field. **No suggestion is enabled by default** unless you choose to enable it in the editor.

JSON lists are interpreted as lists; plain-text plural fields are split on commas. Singular phrase fields are kept intact. Review suggestions if the author used an ambiguous format.

The node does not infer triggers from `ss_tag_frequency`, filenames, or generic tags. It does not deserialize `.pt`, `.ckpt`, or pickle files to read metadata. If explicit fields are missing or the format is unsupported, enter triggers manually. Civitai and Hugging Face are not queried.

## Workflows and API

The internal node name is `LoRATriggerStudio`. `config` is a JSON STRING containing a version and rows. Execution uses the workflow snapshot, not the global library.

Minimal example for API clients:

```json
{
  "version": 1,
  "rows": [
    {
      "lora": "examples/my_action_lora.safetensors",
      "enabled": true,
      "strength_model": 0.8,
      "strength_clip": 1.0,
      "selected": ["example_action"]
    }
  ]
}
```

The interface adds `entry` to each row to preserve labels, presets, and notes. Paths are validated against ComfyUI's catalog before loading weights. An active LoRA that does not exist produces a clear error; a disabled row does not require the file to be installed.

| Method | Route | Purpose |
|---|---|---|
| GET | `/lora-trigger-studio/loras` | Available files |
| GET | `/lora-trigger-studio/library` | Library and revision |
| GET | `/lora-trigger-studio/suggestions?lora=...` | Metadata suggestions |
| GET | `/lora-trigger-studio/preview?lora=...&size=96` | Local WebP image; size 96 or 640; 204 if no image exists |
| POST | `/lora-trigger-studio/entry` | Save `{lora, entry, revision}` |
| POST | `/lora-trigger-studio/import` | Import `{library, revision}` without overwriting |
| GET | `/lora-trigger-studio/export` | Download the library |

Writes require `Content-Type: application/json`; request bodies are limited to 2 MB. Do not expose ComfyUI directly to the Internet: the node uses the host server's access context.

## Development and tests

```bash
python -m unittest discover -s tests -v
npm ci --ignore-scripts
npm test
```

Tests do not require a GPU or a ComfyUI installation. Python needs Pillow, already included in ComfyUI's environment; install it with `python -m pip install Pillow` in a standalone environment. Tests cover persistence, concurrency, validation, metadata, images, presets, serialization, and delegation to the native loader using test doubles.

Interaction tests use jsdom, a development-only dependency, without opening a browser or connecting to external services. They cover row controls, dragging, keyboard navigation, duplication, and thumbnail controls.

For visual testing, use a separate ComfyUI instance and a test library configured through `LORA_TRIGGER_STUDIO_LIBRARY`. Do not mix test entries with your personal library.

## Compatibility and limitations

- Built for ComfyUI's classic web frontend using DOM widgets. Other frontends require separate verification.
- A standard `MODEL / CLIP` loader; it does not replace specialized loaders such as those in WanVideoWrapper.
- No automatic model downloads or inference of semantic dependencies between triggers.
- No unverified entries for real models: different authors and versions may use different triggers.
- Real-canvas visual checks and GPU generation remain pending; automated tests do not replace those checks.

Version: **0.1.0**. See the [changelog](CHANGELOG.md) and [verification notes](docs/verification.md).
