import { active, blankEntry, duplicateRow, moveRowTo, newRow, previewText, readState, refreshEntry, selectWord } from "./state.js";

export function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
export function button(label, action, className = "") {
    const b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", action);
    return b;
}
function field(label, control) {
    const wrapper = el("label", "lts-field");
    wrapper.append(el("span", "", label), control);
    return wrapper;
}
function input(label, value = "", type = "text") {
    const node = el("input");
    node.type = type;
    node.setAttribute("aria-label", label);
    node.value = value;
    return node;
}
export function checkbox(label, checked, onChange, className = "lts-check") {
    const wrapper = el("label", className);
    const check = input(label, "", "checkbox");
    check.checked = checked;
    check.addEventListener("change", () => onChange(check.checked));
    wrapper.append(check, el("span", "", label));
    return wrapper;
}

export class TriggerStudio {
    constructor(root, { raw, write, hasClip, request, apiURL, layout = () => {} }) {
        this.root = root;
        this.write = write;
        this.hasClip = hasClip;
        this.request = request;
        this.apiURL = apiURL;
        this.layout = layout;
        this.available = null;
        this.valid = false;
        this.destroyed = false;
        this.dragRow = null;
        this.dialogs = new Set();
        root.className = "lts";
        root.setAttribute("aria-label", "ComfyUI Kirei LoRA Trigger Studio");
        for (const event of ["pointerdown", "mousedown", "dblclick", "keydown", "wheel"]) {
            root.addEventListener(event, e => e.stopPropagation());
        }
        this.load(raw);
    }
    load(raw) {
        try {
            this.state = readState(raw);
            this.valid = true;
            this.render();
        } catch (error) {
            this.valid = false;
            this.status = el("p", "lts-status", `${error.message} The configuration has not been overwritten.`);
            this.root.replaceChildren(this.status);
        }
    }
    commit() {
        this.write(JSON.stringify(this.state));
        this.updatePreview();
    }
    updatePreview() {
        if (!this.preview) return;
        const clip = this.hasClip();
        this.preview.textContent = previewText(this.state, clip) || "No trigger words selected";
        this.summary.textContent = `${this.state.rows.filter(r => active(r, clip)).length} / ${this.state.rows.length} active`;
    }
    async run(action) {
        this.status.textContent = "";
        try { await action(); } catch (error) { this.status.textContent = error.message; }
    }
    async checkFiles() {
        if (!this.valid || this.destroyed) return;
        try {
            const { loras } = await this.request("/loras");
            if (!this.valid || this.destroyed) return;
            this.available = new Set(loras);
            this.render();
        } catch (error) { if (!this.destroyed) this.status.textContent = `Could not check the catalog: ${error.message}`; }
    }
    render() {
        this.dragRow = null;
        this.root.replaceChildren();
        const head = el("div", "lts-topline");
        const title = el("div");
        title.append(el("div", "lts-eyebrow", "KIREI / COMFYUI"), el("h2", "", "LoRA Trigger Studio"));
        this.summary = el("span", "lts-muted");
        head.append(title, this.summary);
        const toolbar = el("div", "lts-toolbar");
        toolbar.append(button("+ Add LoRA", () => this.run(() => this.chooseLora()), "lts-primary"),
            button("JSON library", () => this.run(() => this.openLibrary())));
        const controls = el("div", "lts-toolbar");
        const allEnabled = this.state.rows.length > 0 && this.state.rows.every(row => row.enabled);
        const toggleAll = button(allEnabled ? "Disable all" : "Enable all", () => {
            for (const row of this.state.rows) row.enabled = !allEnabled;
            this.commit(); this.render();
        }, "lts-small");
        toggleAll.disabled = !this.state.rows.length;
        controls.append(toggleAll, checkbox("Separate MODEL / CLIP", this.state.strength_mode !== "single", separate => {
            this.state.strength_mode = separate ? "separate" : "single";
            if (!separate) for (const row of this.state.rows) row.strength_clip = row.strength_model;
            this.commit(); this.render();
        }));
        controls.title = "With shared strength, the MODEL value is also used for CLIP.";
        const allCollapsed = this.state.rows.length > 0 && this.state.rows.every(row => row.collapsed);
        const compact = button(allCollapsed ? "Expand" : "Collapse", () => {
            for (const row of this.state.rows) row.collapsed = !allCollapsed;
            this.commit(); this.render();
        }, "lts-small");
        compact.disabled = !this.state.rows.length;
        const refresh = button("↻", () => this.checkFiles(), "lts-small");
        refresh.setAttribute("aria-label", "Check LoRA files"); refresh.title = "Check whether the files are still available";
        controls.append(compact, refresh);
        controls.append(checkbox("Thumbnails", this.state.show_previews !== false, checked => {
            this.state.show_previews = checked; this.commit(); this.render();
        }));
        this.status = el("p", "lts-status");
        this.status.setAttribute("role", "status");
        this.root.append(head, toolbar, controls, this.status);
        const rows = el("div", "lts-rows");
        if (!this.state.rows.length) rows.append(el("div", "lts-empty", "Add a LoRA to save its trigger words and choose which ones to send to the prompt."));
        this.state.rows.forEach((row, index) => rows.append(this.renderRow(row, index)));
        const preview = el("div", "lts-preview");
        this.preview = el("output");
        this.preview.setAttribute("aria-label", "trigger_words output");
        preview.append(el("span", "lts-muted", "OUTPUT · trigger_words"), this.preview);
        this.root.append(rows, preview);
        this.updatePreview();
        this.layout(Math.min(800, Math.max(300, 210 + this.state.rows.reduce((height, row) => height + (row.collapsed ? 110 : 250), 0))));
    }
    renderRow(row, index) {
        const card = el("section", "lts-row");
        card.setAttribute("aria-label", `LoRA ${index + 1}: ${row.lora}`);
        card.dataset.disabled = String(!row.enabled);
        this.addDropTarget(card, row);
        const header = el("div", "lts-topline");
        const toggle = checkbox("Enabled", row.enabled, enabled => { row.enabled = enabled; card.dataset.disabled = String(!enabled); this.commit(); this.render(); });
        const name = el("span", "lts-name", row.lora.split("/").pop());
        name.title = row.lora;
        const remove = button("×", () => { this.state.rows.splice(index, 1); this.commit(); this.render(); }, "lts-icon");
        remove.title = "Remove from workflow (keep library entry)";
        remove.setAttribute("aria-label", `Remove LoRA ${index + 1}`);
        const collapse = button(row.collapsed ? "▸" : "▾", () => { row.collapsed = !row.collapsed; this.commit(); this.render(); }, "lts-icon");
        collapse.setAttribute("aria-label", `${row.collapsed ? "Expand" : "Collapse"} LoRA ${index + 1}`);
        collapse.setAttribute("aria-expanded", String(!row.collapsed));
        const handle = button("⠿", () => {}, "lts-icon lts-drag-handle");
        handle.draggable = true;
        handle.setAttribute("aria-label", `Move LoRA ${index + 1}`);
        handle.title = "Drag to reorder · Alt + ↑ / ↓ with keyboard";
        handle.addEventListener("dragstart", event => {
            this.dragRow = row;
            event.dataTransfer?.setData("text/plain", row.lora);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            card.classList.add("lts-dragging"); event.stopPropagation();
        });
        handle.addEventListener("dragend", () => this.clearDrag());
        handle.addEventListener("keydown", event => {
            if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault(); event.stopPropagation(); this.moveRow(index, event.key === "ArrowUp" ? -1 : 1);
            }
        });
        header.append(handle);
        if (this.state.show_previews !== false) header.append(this.thumbnail(row.lora, true));
        header.append(toggle, name, collapse, remove);
        card.append(header);
        if (this.available && !this.available.has(row.lora)) {
            const missing = el("p", "lts-status", row.enabled ? "File not found · change the LoRA or disable this row before running." : "File not found · this row is disabled.");
            missing.setAttribute("role", "status"); card.append(missing);
        }
        if (!row.collapsed && row.lora.includes("/")) card.append(el("div", "lts-muted", row.lora.substring(0, row.lora.lastIndexOf("/"))));
        const weights = el("div", "lts-toolbar");
        const strengths = this.state.strength_mode === "single" ? [["strength_model", "Strength"]] : [["strength_model", "MODEL"], ["strength_clip", "CLIP"]];
        for (const [key, label] of strengths) {
            const weight = input(label === "Strength" ? `Strength LoRA ${index + 1}` : `${label} strength LoRA ${index + 1}`, row[key], "number");
            weight.min = "-100"; weight.max = "100"; weight.step = "0.01";
            weight.title = label === "CLIP" ? "Only applies when the CLIP input is connected." : "0 disables the model modification.";
            weight.addEventListener("change", () => {
                if (!weight.value.trim() || !weight.checkValidity()) { weight.value = row[key]; return; }
                row[key] = Number(weight.value);
                if (this.state.strength_mode === "single") row.strength_clip = row.strength_model;
                this.commit();
            });
            const wrap = el("label", "lts-weight"); wrap.append(el("span", "", label), weight); weights.append(wrap);
        }
        const moveUp = button("↑", () => this.moveRow(index, -1), "lts-icon");
        moveUp.disabled = index === 0; moveUp.setAttribute("aria-label", `Move up LoRA ${index + 1}`);
        const moveDown = button("↓", () => this.moveRow(index, 1), "lts-icon");
        moveDown.disabled = index === this.state.rows.length - 1; moveDown.setAttribute("aria-label", `Move down LoRA ${index + 1}`);
        weights.append(moveUp, moveDown); card.append(weights);
        const duplicate = button("⧉", () => {
            duplicateRow(this.state, index); this.commit(); this.render();
            this.status.textContent = "Disabled copy added. Adjust its strength or trigger words before enabling it.";
        }, "lts-icon");
        duplicate.setAttribute("aria-label", `Duplicate LoRA ${index + 1}`);
        duplicate.title = "Duplicate row (copy starts disabled to avoid applying the LoRA twice)";
        weights.append(duplicate);
        if (row.collapsed) {
            weights.append(el("span", "lts-muted", `${row.selected.length} triggers`));
            return card;
        }
        const words = el("div", "lts-words");
        for (const trigger of row.entry.triggers) {
            const label = trigger.label ? `${trigger.label} · ${trigger.text}` : trigger.text;
            const chip = checkbox(label, row.selected.includes(trigger.text), checked => { selectWord(row, trigger.text, checked); this.commit(); }, "lts-chip");
            chip.title = trigger.text;
            words.append(chip);
        }
        if (!row.entry.triggers.length) words.append(el("span", "lts-muted", "Saved without trigger words"));
        card.append(words);
        const actions = el("div", "lts-toolbar");
        if (row.entry.presets.length) {
            const presets = el("select"); presets.setAttribute("aria-label", `Preset LoRA ${index + 1}`);
            presets.append(new Option("Apply preset…", ""));
            row.entry.presets.forEach((p, i) => presets.append(new Option(p.name, String(i))));
            presets.addEventListener("change", () => {
                if (presets.value !== "") { row.selected = [...row.entry.presets[Number(presets.value)].words]; this.commit(); this.render(); }
            });
            actions.append(presets);
        }
        actions.append(button("Edit entry", () => this.run(async () => {
            const entry = await this.editEntry(row.lora);
            if (entry) { refreshEntry(row, entry); this.commit(); this.render(); }
        }), "lts-small"), button("Save preset", () => this.run(() => this.savePreset(row)), "lts-small"),
        button("Change LoRA", () => this.run(() => this.chooseLora(index)), "lts-small"));
        if (row.entry.notes) {
            const note = el("details", "lts-notes");
            note.append(el("summary", "lts-muted", "Usage notes"), el("p", "lts-muted", row.entry.notes)); card.append(note);
        }
        card.append(actions);
        return card;
    }
    moveRow(index, delta) {
        if (index + delta < 0 || index + delta >= this.state.rows.length) return;
        const position = moveRowTo(this.state, index, index + (delta > 0 ? 2 : -1));
        this.commit(); this.render();
        this.status.textContent = `LoRA moved to position ${position + 1}.`;
        this.root.querySelector(`[aria-label="Move LoRA ${position + 1}"]`)?.focus();
    }
    clearDrag() {
        this.dragRow = null;
        for (const card of this.root.querySelectorAll(".lts-row")) card.classList.remove("lts-dragging", "lts-drop-before", "lts-drop-after");
    }
    addDropTarget(card, row) {
        const isLocalDrag = () => this.dragRow && this.state.rows.includes(this.dragRow) && this.dragRow !== row;
        const after = event => event.clientY >= card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
        card.addEventListener("dragover", event => {
            if (!isLocalDrag()) return;
            event.preventDefault(); event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            card.classList.toggle("lts-drop-after", after(event)); card.classList.toggle("lts-drop-before", !after(event));
        });
        card.addEventListener("dragleave", event => {
            if (!card.contains(event.relatedTarget)) card.classList.remove("lts-drop-before", "lts-drop-after");
        });
        card.addEventListener("drop", event => {
            if (!isLocalDrag()) return;
            event.preventDefault(); event.stopPropagation();
            const from = this.state.rows.indexOf(this.dragRow);
            const boundary = this.state.rows.indexOf(row) + (after(event) ? 1 : 0);
            const position = moveRowTo(this.state, from, boundary);
            this.clearDrag(); this.commit(); this.render();
            this.status.textContent = `LoRA moved to position ${position + 1}.`;
        });
    }
    thumbnail(name, expandable = false) {
        const tile = expandable ? button("", () => this.openPreview(name), "lts-thumb") : el("span", "lts-thumb");
        if (expandable) { tile.disabled = true; tile.setAttribute("aria-label", `View thumbnail for ${name}`); }
        tile.title = "No local preview";
        const image = el("img"); image.alt = ""; image.loading = "lazy"; image.decoding = "async";
        image.draggable = false; image.width = 44; image.height = 52;
        image.src = this.apiURL(`/preview?lora=${encodeURIComponent(name)}&size=96`);
        image.addEventListener("load", () => { tile.classList.add("lts-has-image"); tile.title = expandable ? "Enlarge local preview" : "Local preview"; if (expandable) tile.disabled = false; });
        image.addEventListener("error", () => { image.remove(); tile.title = "No compatible preview. See the README for supported filenames."; });
        tile.append(image); return tile;
    }
    openPreview(name) {
        const { form } = this.modal("Local preview");
        form.append(el("p", "lts-subtitle", name));
        const image = el("img", "lts-preview-image"); image.alt = `Preview of ${name}`;
        image.src = this.apiURL(`/preview?lora=${encodeURIComponent(name)}&size=640`);
        image.addEventListener("error", () => { image.replaceWith(el("p", "lts-status", "The image is no longer available or is unsupported.")); });
        form.append(image, el("p", "lts-muted", "Local image associated with the file. A visual reference, not a prediction of the result."));
    }
    modal(title) {
        const dialog = el("dialog", "lts-dialog");
        dialog.setAttribute("aria-label", title);
        const form = el("div", "lts-form");
        const header = el("div", "lts-topline");
        header.append(el("h2", "", title), button("Close", () => dialog.close()));
        form.append(header);
        dialog.append(form);
        document.body.append(dialog);
        this.dialogs.add(dialog);
        dialog.addEventListener("close", () => { this.dialogs.delete(dialog); dialog.remove(); }, { once: true });
        dialog.showModal();
        return { dialog, form };
    }
    async chooseLora(replaceIndex) {
        const [{ loras }, catalog] = await Promise.all([this.request("/loras"), this.request("/library")]);
        const { dialog, form } = this.modal("Add LoRA");
        form.append(el("p", "lts-muted", "Choose a file from your LoRA folders. If it has no entry, we will check its metadata and ask you to review the trigger words."));
        const search = input("Search LoRAs"); search.placeholder = "Search by filename or folder…";
        const results = el("div", "lts-results");
        const status = el("p", "lts-status");
        let picking = false;
        const show = () => {
            results.replaceChildren();
            const filtered = loras.filter(name => name.toLowerCase().includes(search.value.toLowerCase()));
            if (!filtered.length) results.append(el("p", "lts-muted", "No LoRAs found. Place files in models/loras and reopen this picker."));
            for (const name of filtered.slice(0, 150)) {
                const b = button(name, async () => {
                    if (picking) return;
                    picking = true; b.disabled = true;
                    try {
                        let entry = catalog.library.loras[name];
                        if (!entry) entry = await this.editEntry(name);
                        if (!entry) return;
                        const row = newRow(name, entry);
                        if (replaceIndex === undefined) this.state.rows.push(row);
                        else {
                            const old = this.state.rows[replaceIndex];
                            this.state.rows[replaceIndex] = { ...row, enabled: old.enabled, strength_model: old.strength_model, strength_clip: old.strength_clip };
                        }
                        this.commit(); this.render(); dialog.close();
                    } catch (error) { status.textContent = error.message; }
                    finally { picking = false; b.disabled = false; }
                }, "lts-result");
                if (this.state.show_previews !== false) b.prepend(this.thumbnail(name));
                b.append(el("small", "", catalog.library.loras[name] ? "Saved entry" : "New · review trigger words"));
                results.append(b);
            }
            if (filtered.length > 150) results.append(el("p", "lts-muted", `${filtered.length} results. Refine your search to see more.`));
        };
        search.addEventListener("input", show);
        form.append(search, results, status); show(); search.focus();
    }
    async editEntry(name) {
        const catalog = await this.request("/library");
        let entry = structuredClone(catalog.library.loras[name] || blankEntry());
        let hint = "Changes are saved to your library. Other workflows keep their selections until you edit their entries.";
        let sources = [];
        if (!catalog.library.loras[name]) {
            try {
                const suggestions = await this.request(`/suggestions?lora=${encodeURIComponent(name)}`);
                entry.triggers = suggestions.triggers.map(t => ({ text: t.text, label: "", default_on: false }));
                sources = suggestions.triggers.map(t => `${t.text} ← ${t.source}`);
                hint = suggestions.message;
            } catch (error) { hint = `Could not read metadata: ${error.message} You can fill in the entry manually.`; }
        }
        const { dialog, form } = this.modal("Trigger words");
        form.append(el("p", "lts-subtitle", name), el("p", "lts-muted", hint));
        if (sources.length) form.append(el("p", "lts-muted", sources.join(" · ")));
        form.append(el("p", "lts-muted", "One exact word or phrase per row. The label explains its effect; only the trigger text goes into the prompt. Check 'Default' only for triggers you want selected when adding this LoRA."));
        const editors = el("div", "lts-editor-rows");
        const editorRows = [];
        const addTrigger = (trigger = { text: "", label: "", default_on: false }) => {
            const row = el("div", "lts-trigger-edit");
            const word = input("Exact trigger text", trigger.text); word.placeholder = "Exact trigger";
            const label = input("Effect description", trigger.label); label.placeholder = "Effect (optional)";
            const item = { word, label, default_on: trigger.default_on, row };
            const remove = button("×", () => { editorRows.splice(editorRows.indexOf(item), 1); row.remove(); });
            remove.setAttribute("aria-label", "Remove trigger"); remove.title = "Remove this trigger";
            row.append(word, label, checkbox("Default", item.default_on, v => item.default_on = v), remove);
            editorRows.push(item); editors.append(row);
        };
        if (entry.triggers.length) entry.triggers.forEach(addTrigger);
        else addTrigger();
        form.append(editors, button("+ Add trigger", () => addTrigger()));
        const notes = el("textarea"); notes.value = entry.notes; notes.setAttribute("aria-label", "Usage notes");
        notes.placeholder = "Required combinations, LoRA version, documentation link…";
        form.append(field("Usage notes", notes));
        const presets = el("div", "lts-presets");
        const renderPresets = () => {
            presets.replaceChildren();
            for (const preset of entry.presets) {
                const line = el("div", "lts-topline");
                line.append(el("span", "lts-muted", `${preset.name}: ${preset.words.join(", ") || "no triggers"}`),
                    button("Remove preset", () => { entry.presets = entry.presets.filter(p => p !== preset); renderPresets(); }));
                presets.append(line);
            }
        };
        renderPresets(); form.append(presets);
        const status = el("p", "lts-status"); status.setAttribute("role", "status");
        const footer = el("div", "lts-footer");
        let saved = null;
        let saving = false;
        const save = async (withoutTriggers) => {
            if (saving) return;
            saving = true;
            const triggers = withoutTriggers ? [] : editorRows.filter(r => r.word.value.trim()).map(r => ({ text: r.word.value.trim(), label: r.label.value.trim(), default_on: r.default_on }));
            if (!withoutTriggers && !triggers.length) {
                status.textContent = "Add at least one trigger or use 'No triggers needed' to save an empty entry.";
                saving = false; return;
            }
            const existing = new Set(triggers.map(t => t.text));
            const invalidPresets = entry.presets.filter(p => p.words.some(w => !existing.has(w)));
            if (!withoutTriggers && invalidPresets.length) {
                status.textContent = `Remove these presets or keep the triggers they use before saving: ${invalidPresets.map(p => p.name).join(", ")}`;
                saving = false; return;
            }
            try {
                const result = await this.request("/entry", { lora: name, entry: { triggers, presets: withoutTriggers ? [] : entry.presets, notes: notes.value }, revision: catalog.revision });
                saved = result.entry; dialog.close();
            } catch (error) { status.textContent = error.message; }
            finally { saving = false; }
        };
        footer.append(button("Cancel", () => dialog.close()), button("No triggers needed", () => save(true)),
            button("Save entry", () => save(false), "lts-primary"));
        form.append(status, footer);
        return new Promise(resolve => dialog.addEventListener("close", () => resolve(saved), { once: true }));
    }
    async savePreset(row) {
        const catalog = await this.request("/library");
        const entry = structuredClone(catalog.library.loras[row.lora] || row.entry);
        if (row.selected.some(w => !entry.triggers.some(t => t.text === w))) throw new Error("The entry has changed. Edit this row's entry before saving a preset.");
        const { dialog, form } = this.modal("Save combination as preset");
        form.append(el("p", "lts-subtitle", row.lora), el("p", "lts-muted", row.selected.join(", ") || "No triggers: useful for a neutral preset."));
        const name = input("Preset name"); name.placeholder = "For example: Standard action";
        const status = el("p", "lts-status");
        const save = button("Save preset", async () => {
            if (!name.value.trim()) { status.textContent = "Enter a name."; return; }
            if (entry.presets.some(p => p.name === name.value.trim())) { status.textContent = "That name already exists. Use another name or remove the existing preset in Edit entry."; return; }
            save.disabled = true;
            try {
                const candidate = structuredClone(entry);
                candidate.presets.push({ name: name.value.trim(), words: [...row.selected] });
                const result = await this.request("/entry", { lora: row.lora, entry: candidate, revision: catalog.revision });
                refreshEntry(row, result.entry); this.commit(); this.render(); dialog.close();
            } catch (error) { status.textContent = error.message; }
            finally { save.disabled = false; }
        }, "lts-primary");
        form.append(field("Name", name), status, save); name.focus();
    }
    async openLibrary() {
        const catalog = await this.request("/library");
        const { dialog, form } = this.modal("JSON library");
        form.append(el("p", "lts-muted", `Saved entries: ${Object.keys(catalog.library.loras).length}. Each save keeps a .bak backup. No external services are queried.`));
        const toolbar = el("div", "lts-toolbar");
        const download = el("a", "lts-link", "Export JSON"); download.href = this.apiURL("/export"); download.download = "lora_triggers.json";
        toolbar.append(download, button("Import JSON", () => { dialog.close(); this.run(() => this.importLibrary()); }));
        const search = input("Search entries"); search.placeholder = "Search saved entries…";
        const results = el("div", "lts-results");
        const show = () => {
            results.replaceChildren();
            for (const [name, entry] of Object.entries(catalog.library.loras).filter(([n]) => n.toLowerCase().includes(search.value.toLowerCase()))) {
                const b = button(`${name} · ${entry.triggers.length} triggers`, () => this.run(async () => {
                    dialog.close(); await this.editEntry(name);
                }), "lts-result"); results.append(b);
            }
        };
        search.addEventListener("input", show);
        form.append(toolbar, search, results); show();
    }
    async importLibrary() {
        const catalog = await this.request("/library");
        const { dialog, form } = this.modal("Import JSON library");
        form.append(el("p", "lts-muted", "Paste an exported library. New entries are added; existing entries are not overwritten. Model files are not imported or downloaded."));
        const area = el("textarea", "lts-json"); area.setAttribute("aria-label", "Library JSON"); area.placeholder = '{"version":1,"loras":{…}}';
        const status = el("p", "lts-status"); status.setAttribute("role", "status");
        const save = button("Import new entries", async () => {
            save.disabled = true;
            try {
                const result = await this.request("/import", { library: JSON.parse(area.value), revision: catalog.revision });
                dialog.close(); this.status.textContent = `Imported: ${result.added}. Existing entries kept: ${result.skipped}.`;
            } catch (error) { status.textContent = error.message; }
            finally { save.disabled = false; }
        }, "lts-primary");
        form.append(area, status, save);
    }
    destroy() { this.destroyed = true; for (const dialog of [...this.dialogs]) dialog.close(); }
}
