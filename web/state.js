export function emptyState() { return { version: 1, strength_mode: "single", rows: [] }; }
export function blankEntry() { return { triggers: [], presets: [], notes: "" }; }
export function newRow(lora, entry) {
    return { lora, enabled: true, strength_model: 1, strength_clip: 1,
        selected: entry.triggers.filter(t => t.default_on).map(t => t.text), entry: structuredClone(entry) };
}
export function readState(raw) {
    const state = JSON.parse(raw);
    if (state?.version !== 1 || !Array.isArray(state.rows)) throw new Error("Unsupported workflow configuration.");
    if (state.strength_mode !== undefined && !["single", "separate"].includes(state.strength_mode)) throw new Error("Invalid strength mode.");
    for (const row of state.rows) {
        if (typeof row.lora !== "string" || typeof row.enabled !== "boolean" || !Array.isArray(row.selected)
            || !row.selected.every(w => typeof w === "string" && w.trim())
            || ![row.strength_model, row.strength_clip].every(w => Number.isFinite(w) && Math.abs(w) <= 100)) {
            throw new Error("Invalid LoRA row. Check the workflow JSON.");
        }
        if (state.strength_mode === "single") row.strength_clip = row.strength_model;
        // API-authored workflows may contain selected text without a library snapshot.
        row.entry ??= { triggers: row.selected.map(text => ({ text, label: "", default_on: false })), presets: [], notes: "" };
        if (!Array.isArray(row.entry.triggers) || !Array.isArray(row.entry.presets)) throw new Error("Invalid workflow library.");
        if (!row.entry.triggers.every(t => typeof t?.text === "string" && t.text.trim() && typeof t.label === "string")
            || !row.entry.presets.every(p => typeof p?.name === "string" && Array.isArray(p.words) && p.words.every(w => typeof w === "string"))) {
            throw new Error("Invalid LoRA entry in the workflow.");
        }
        for (const word of row.selected) {
            if (!row.entry.triggers.some(t => t.text === word)) row.entry.triggers.push({ text: word, label: "From workflow", default_on: false });
        }
    }
    return state;
}
export function active(row, hasClip) {
    return row.enabled && (row.strength_model !== 0 || (hasClip && row.strength_clip !== 0));
}
export function previewText(state, hasClip) {
    return [...new Set(state.rows.filter(r => active(r, hasClip)).flatMap(r => r.selected))].join(", ");
}
export function selectWord(row, word, enabled) {
    const selected = new Set(row.selected);
    if (enabled) selected.add(word); else selected.delete(word);
    row.selected = [...selected];
}
export function refreshEntry(row, entry) {
    row.entry = structuredClone(entry);
    row.selected = row.selected.filter(w => entry.triggers.some(t => t.text === w));
}

export function moveRowTo(state, from, boundary) {
    if (!Number.isInteger(from) || !Number.isInteger(boundary) || from < 0 || from >= state.rows.length || boundary < 0 || boundary > state.rows.length) return -1;
    const to = boundary > from ? boundary - 1 : boundary;
    if (to === from) return from;
    const [row] = state.rows.splice(from, 1);
    state.rows.splice(to, 0, row);
    return to;
}

export function duplicateRow(state, index) {
    const source = state.rows[index];
    if (!source) return;
    const row = structuredClone(source);
    row.enabled = false;
    state.rows.splice(index + 1, 0, row);
}
