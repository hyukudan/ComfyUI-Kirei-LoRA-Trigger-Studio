import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TriggerStudio } from "../web/studio.js";
import { emptyState, newRow } from "../web/state.js";

const entry = () => ({ triggers: [{ text: "base_token", label: "Base", default_on: true }, { text: "finish_token", label: "Finisher", default_on: false }],
    presets: [{ name: "Finisher", words: ["base_token", "finish_token"] }], notes: "Test fixture only" });
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(initial = emptyState(), loras = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='root'></div></body>");
    const { window } = dom;
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
    // Only local DOM objects; there is no browser or network connection in these tests.
    const previous = { document: global.document, Option: global.Option };
    global.document = window.document;
    global.Option = window.Option;
    const catalog = { version: 1, loras: structuredClone(loras) };
    let revision = 0, raw = JSON.stringify(initial), clip = false;
    const calls = [];
    const root = window.document.querySelector("#root");
    const studio = new TriggerStudio(root, {
        raw, write: value => raw = value, hasClip: () => clip, apiURL: p => `/lora-trigger-studio${p}`,
        request: async (path, body) => {
            calls.push({ path, body });
            if (path === "/loras") return { loras: ["h3/test.safetensors", "h3/new.safetensors"] };
            if (path === "/library") return { library: structuredClone(catalog), revision: String(revision) };
            if (path.startsWith("/suggestions")) return { triggers: [{ text: "suggested_token", source: "trigger_word" }], message: "Metadata suggestion" };
            if (path === "/entry") {
                assert.equal(body.revision, String(revision));
                catalog.loras[body.lora] = structuredClone(body.entry); revision++;
                return { entry: structuredClone(body.entry), revision: String(revision) };
            }
            if (path === "/import") {
                let added = 0, skipped = 0;
                for (const [name, value] of Object.entries(body.library.loras)) {
                    if (name in catalog.loras) skipped++; else { catalog.loras[name] = value; added++; }
                }
                revision++; return { added, skipped };
            }
            throw new Error(`Unexpected path: ${path}`);
        },
    });
    const click = (label, scope = window.document) => {
        const b = [...scope.querySelectorAll("button")].find(b => b.textContent === label);
        assert.ok(b, `Button '${label}' exists`); b.click(); return b;
    };
    const change = (control, value) => {
        if (control.type === "checkbox") control.checked = value; else control.value = value;
        control.dispatchEvent(new window.Event("change", { bubbles: true }));
    };
    return { studio, root, window, catalog, calls, click, change, raw: () => raw,
        setClip: value => { clip = value; studio.updatePreview(); },
        cleanup: () => { studio.destroy(); window.close(); global.document = previous.document; global.Option = previous.Option; } };
}

test("new LoRA prompts metadata review, persists defaults, and emits only selected text", async t => {
    const env = setup(); t.after(env.cleanup);
    env.click("+ Add LoRA"); await tick();
    const result = [...env.window.document.querySelectorAll(".lts-result")].find(b => b.textContent.startsWith("h3/new.safetensors"));
    result.click(); await tick();
    const editor = env.window.document.querySelector('dialog[aria-label="Trigger words"]');
    assert.ok(editor);
    assert.equal(editor.querySelector('[aria-label="Exact trigger text"]').value, "suggested_token");
    assert.equal(editor.querySelector('[aria-label="Default"]').checked, false);
    env.change(editor.querySelector('[aria-label="Default"]'), true);
    env.click("Save entry", editor); await tick();
    assert.equal(env.catalog.loras["h3/new.safetensors"].triggers[0].default_on, true);
    assert.equal(env.root.querySelector("output").textContent, "suggested_token");
    assert.equal(JSON.parse(env.raw()).rows.length, 1);
    assert.equal(env.window.document.querySelectorAll("dialog").length, 0);
});

test("canceling metadata editor neither adds a row nor saves a catalog entry", async t => {
    const env = setup(); t.after(env.cleanup);
    await env.studio.chooseLora();
    [...env.window.document.querySelectorAll(".lts-result")][1].click(); await tick();
    env.click("Cancel"); await tick();
    assert.equal(JSON.parse(env.raw()).rows.length, 0);
    assert.deepEqual(env.catalog.loras, {});
});

test("known LoRA skips metadata prompt and uses saved defaults", async t => {
    const env = setup(emptyState(), { "h3/test.safetensors": entry() }); t.after(env.cleanup);
    await env.studio.chooseLora();
    [...env.window.document.querySelectorAll(".lts-result")][0].click(); await tick();
    assert.equal(env.root.querySelector("output").textContent, "base_token");
    assert.ok(!env.calls.some(c => c.path.startsWith("/suggestions")));
});

test("trigger toggles, enable switches, strengths and presets update serialized config", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }); t.after(env.cleanup);
    env.change(env.root.querySelector('[aria-label="Finisher · finish_token"]'), true);
    assert.equal(env.root.querySelector("output").textContent, "base_token, finish_token");
    env.change(env.root.querySelector('[aria-label="Enabled"]'), false);
    assert.deepEqual(JSON.parse(env.raw()).rows[0].selected, ["base_token", "finish_token"]);
    assert.match(env.root.querySelector("output").textContent, /No trigger words selected/);
    env.change(env.root.querySelector('[aria-label="Enabled"]'), true);
    env.change(env.root.querySelector('[aria-label="MODEL strength LoRA 1"]'), "0");
    assert.match(env.root.querySelector("output").textContent, /No trigger words selected/);
    env.setClip(true);
    assert.equal(env.root.querySelector("output").textContent, "base_token, finish_token");
    env.change(env.root.querySelector('[aria-label="Preset LoRA 1"]'), "0");
    assert.deepEqual(JSON.parse(env.raw()).rows[0].selected, ["base_token", "finish_token"]);
});

test("no-trigger choice is saved explicitly and reused", async t => {
    const env = setup(); t.after(env.cleanup);
    const promise = env.studio.editEntry("h3/new.safetensors"); await tick();
    env.click("No triggers needed");
    const saved = await promise;
    assert.deepEqual(saved.triggers, []);
    assert.deepEqual(env.catalog.loras["h3/new.safetensors"].triggers, []);
});

test("save named preset persists the chosen combination", async t => {
    const row = newRow("h3/test.safetensors", entry()); row.selected = ["finish_token"];
    const env = setup({ version: 1, rows: [row] }, { "h3/test.safetensors": entry() }); t.after(env.cleanup);
    env.click("Save preset", env.root); await tick();
    const modal = env.window.document.querySelector("dialog");
    modal.querySelector('[aria-label="Preset name"]').value = "Solo remate";
    env.click("Save preset", modal); await tick();
    assert.deepEqual(env.catalog.loras[row.lora].presets.at(-1), { name: "Solo remate", words: ["finish_token"] });
    assert.equal(env.root.querySelector("output").textContent, "finish_token");
});

test("reorder and remove affect workflow only", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry()), newRow("h3/new.safetensors", entry())] }, { "h3/test.safetensors": entry() }); t.after(env.cleanup);
    env.root.querySelector('[aria-label="Move up LoRA 2"]').click();
    assert.equal(JSON.parse(env.raw()).rows[0].lora, "h3/new.safetensors");
    env.root.querySelector('[aria-label="Remove LoRA 1"]').click();
    assert.equal(JSON.parse(env.raw()).rows.length, 1);
    assert.ok(env.catalog.loras["h3/test.safetensors"]);
});

test("labels and notes are text, never HTML", t => {
    const value = entry(); value.notes = '<img src=x onerror="alert(1)">'; value.triggers[0].label = "<script>bad()</script>";
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", value)] }); t.after(env.cleanup);
    assert.equal(env.root.querySelectorAll("img[onerror],script").length, 0);
    assert.ok(env.root.querySelector("img").src.includes("/lora-trigger-studio/preview?"));
    assert.ok(env.root.textContent.includes("<script>bad()</script>"));
});

test("invalid stored config remains intact and displays actionable error", t => {
    const env = setup(); t.after(env.cleanup);
    const before = env.raw(); env.studio.load("invalid");
    assert.equal(env.raw(), before);
    assert.match(env.root.textContent, /The configuration has not been overwritten/);
});

test("JSON import is merge-only and export uses local API URL", async t => {
    const env = setup(emptyState(), { "h3/test.safetensors": entry() }); t.after(env.cleanup);
    await env.studio.openLibrary();
    assert.equal(env.window.document.querySelector("a").getAttribute("href"), "/lora-trigger-studio/export");
    env.click("Import JSON"); await tick();
    const area = env.window.document.querySelector("textarea");
    area.value = JSON.stringify({ version: 1, loras: { "h3/test.safetensors": { triggers: [] }, "other.safetensors": entry() } });
    env.click("Import new entries"); await tick();
    assert.equal(env.catalog.loras["h3/test.safetensors"].triggers.length, 2);
    assert.ok(env.catalog.loras["other.safetensors"]);
    assert.match(env.root.textContent, /Imported: 1\. Existing entries kept: 1/);
});

test("snapshot reload preserves selected words not currently in the catalog", t => {
    const row = newRow("h3/test.safetensors", entry()); row.selected = ["old_token"];
    const env = setup({ version: 1, rows: [row] }); t.after(env.cleanup);
    assert.ok(env.root.textContent.includes("old_token"));
    assert.ok(env.root.querySelector('[aria-label="From workflow · old_token"]').checked);
});

test("stack controls toggle every row and switch shared/separate strengths", t => {
    const state = emptyState(); state.rows = [newRow("one", entry()), newRow("two", entry())];
    const env = setup(state); t.after(env.cleanup);
    env.click("Disable all", env.root);
    assert.ok(JSON.parse(env.raw()).rows.every(r => !r.enabled));
    env.click("Enable all", env.root);
    assert.ok(JSON.parse(env.raw()).rows.every(r => r.enabled));
    const shared = env.root.querySelector('[aria-label="Strength LoRA 1"]');
    env.change(shared, "0.45");
    assert.deepEqual([JSON.parse(env.raw()).rows[0].strength_model, JSON.parse(env.raw()).rows[0].strength_clip], [0.45, 0.45]);
    env.change(env.root.querySelector('[aria-label="Separate MODEL / CLIP"]'), true);
    assert.ok(env.root.querySelector('[aria-label="MODEL strength LoRA 1"]'));
    assert.ok(env.root.querySelector('[aria-label="CLIP strength LoRA 1"]'));
});

test("changing a LoRA preserves row power controls and adopts new trigger defaults", async t => {
    const state = emptyState(), row = newRow("h3/test.safetensors", entry());
    row.enabled = false; row.strength_model = 0.35; row.strength_clip = 0.35; state.rows = [row];
    const incoming = entry(); incoming.triggers = [{ text: "new_default", label: "Nuevo", default_on: true }]; incoming.presets = [];
    const env = setup(state, { "h3/test.safetensors": entry(), "h3/new.safetensors": incoming }); t.after(env.cleanup);
    env.click("Change LoRA", env.root); await tick();
    const choice = [...env.window.document.querySelectorAll(".lts-result")].find(b => b.textContent.startsWith("h3/new.safetensors"));
    choice.click(); await tick();
    const replaced = JSON.parse(env.raw()).rows[0];
    assert.deepEqual({ enabled: replaced.enabled, model: replaced.strength_model, clip: replaced.strength_clip, selected: replaced.selected },
        { enabled: false, model: 0.35, clip: 0.35, selected: ["new_default"] });
});

test("compact rows preserve power controls and expand without losing selected words", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }); t.after(env.cleanup);
    env.click("Collapse", env.root);
    assert.equal(env.root.querySelectorAll(".lts-chip").length, 0);
    assert.ok(env.root.querySelector('[aria-label="MODEL strength LoRA 1"]'));
    assert.equal(env.root.querySelector("output").textContent, "base_token");
    env.click("Expand", env.root);
    assert.equal(env.root.querySelectorAll(".lts-chip").length, 2);
});

test("missing-file preflight warns without changing the workflow", async t => {
    const env = setup({ version: 1, rows: [newRow("gone.safetensors", entry())] }); t.after(env.cleanup);
    const before = env.raw();
    await env.studio.checkFiles();
    assert.match(env.root.textContent, /File not found/);
    assert.equal(env.raw(), before);
});

test("catalog checks do not hide an invalid-workflow error or update removed nodes", async t => {
    const env = setup(); t.after(env.cleanup);
    env.studio.load("invalid");
    await env.studio.checkFiles();
    assert.match(env.root.textContent, /The configuration has not been overwritten/);
    env.studio.load(JSON.stringify(emptyState()));
    const before = env.root.textContent;
    env.studio.destroy();
    await env.studio.checkFiles();
    assert.equal(env.root.textContent, before);
});

test("duplicated rows are independent and initially off", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }); t.after(env.cleanup);
    env.root.querySelector('[aria-label="Duplicate LoRA 1"]').click();
    const rows = env.studio.state.rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[1].enabled, false);
    rows[1].selected.push("extra"); rows[1].entry.notes = "edited";
    assert.deepEqual(rows[0].selected, ["base_token"]);
    assert.equal(rows[0].entry.notes, "Test fixture only");
});

test("drag handle moves a row below another without changing row data", t => {
    const env = setup({ version: 1, rows: [newRow("first", entry()), newRow("second", entry()), newRow("third", entry())] }); t.after(env.cleanup);
    const before = structuredClone(env.studio.state.rows);
    const handle = env.root.querySelector('[aria-label="Move LoRA 1"]');
    const target = env.root.querySelectorAll(".lts-row")[2];
    target.getBoundingClientRect = () => ({ top: 100, height: 100 });
    const drag = new env.window.Event("dragstart", { bubbles: true });
    Object.defineProperty(drag, "dataTransfer", { value: { setData() {} } }); handle.dispatchEvent(drag);
    const over = new env.window.MouseEvent("dragover", { bubbles: true, cancelable: true, clientY: 190 }); target.dispatchEvent(over);
    assert.ok(target.classList.contains("lts-drop-after"));
    target.dispatchEvent(new env.window.MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 190 }));
    assert.deepEqual(env.studio.state.rows, [before[1], before[2], before[0]]);
    assert.match(env.root.textContent, /position 3/);
});

test("external drops do not import or reorder anything; keyboard handles do", t => {
    const env = setup({ version: 1, rows: [newRow("first", entry()), newRow("second", entry())] }); t.after(env.cleanup);
    env.root.querySelectorAll(".lts-row")[1].dispatchEvent(new env.window.MouseEvent("drop", { bubbles: true, cancelable: true }));
    assert.equal(env.studio.state.rows[0].lora, "first");
    env.root.querySelector('[aria-label="Move LoRA 1"]').dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
    assert.equal(env.studio.state.rows[1].lora, "first");
    assert.equal(env.window.document.activeElement.getAttribute("aria-label"), "Move LoRA 2");
});

test("thumbnail controls use only local URLs, allow enlargement and persist hiding", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }); t.after(env.cleanup);
    const thumbnail = env.root.querySelector(".lts-thumb");
    assert.equal(thumbnail.disabled, true);
    thumbnail.querySelector("img").dispatchEvent(new env.window.Event("load"));
    assert.equal(thumbnail.disabled, false); thumbnail.click();
    const preview = env.window.document.querySelector(".lts-preview-image");
    assert.ok(preview.src.includes("size=640"));
    env.window.document.querySelector("dialog").close();
    env.change(env.root.querySelector('[aria-label="Thumbnails"]'), false);
    assert.equal(env.root.querySelectorAll(".lts-thumb").length, 0);
    assert.equal(JSON.parse(env.raw()).show_previews, false);
});

test("missing thumbnail remains a disabled placeholder", t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }); t.after(env.cleanup);
    const thumbnail = env.root.querySelector(".lts-thumb");
    thumbnail.querySelector("img").dispatchEvent(new env.window.Event("error"));
    assert.equal(thumbnail.disabled, true);
    assert.equal(thumbnail.querySelectorAll("img").length, 0);
});

test("library controls, placeholders and accessibility labels use English", async t => {
    const env = setup({ version: 1, rows: [newRow("h3/test.safetensors", entry())] }, { "h3/test.safetensors": entry() }); t.after(env.cleanup);
    assert.ok(env.root.querySelector('[aria-label="Check LoRA files"]'));
    assert.ok(env.root.querySelector('[aria-label="Thumbnails"]'));
    assert.equal(env.root.querySelector('[aria-label="Move LoRA 1"]').title, "Drag to reorder · Alt + ↑ / ↓ with keyboard");
    env.click("JSON library", env.root); await tick();
    const dialog = env.window.document.querySelector('dialog[aria-label="JSON library"]');
    assert.ok(dialog);
    assert.equal(dialog.querySelector("a").textContent, "Export JSON");
    assert.equal(dialog.querySelector('[aria-label="Search entries"]').placeholder, "Search saved entries…");
    env.click("Import JSON", dialog); await tick();
    const importer = env.window.document.querySelector('dialog[aria-label="Import JSON library"]');
    assert.ok(importer.querySelector('[aria-label="Library JSON"]'));
    assert.ok([...importer.querySelectorAll("button")].some(b => b.textContent === "Import new entries"));
});

test("metadata fallback, trigger editor and empty-entry validation use English", async t => {
    const env = setup(); t.after(env.cleanup);
    const request = env.studio.request;
    env.studio.request = async (path, body) => {
        if (path.startsWith("/suggestions")) throw new Error("Test metadata failure");
        return request(path, body);
    };
    const pending = env.studio.editEntry("h3/new.safetensors"); await tick();
    const editor = env.window.document.querySelector('dialog[aria-label="Trigger words"]');
    assert.match(editor.textContent, /Could not read metadata: Test metadata failure/);
    assert.equal(editor.querySelector('[aria-label="Exact trigger text"]').placeholder, "Exact trigger");
    assert.equal(editor.querySelector('[aria-label="Effect description"]').placeholder, "Effect (optional)");
    assert.equal(editor.querySelector('[aria-label="Default"]').checked, false);
    assert.equal(editor.querySelector('[aria-label="Remove trigger"]').title, "Remove this trigger");
    assert.ok(editor.querySelector('[aria-label="Usage notes"]'));
    env.click("Save entry", editor); await tick();
    assert.match(editor.textContent, /Add at least one trigger or use 'No triggers needed'/);
    env.click("Cancel", editor);
    assert.equal(await pending, null);
    assert.ok(!env.calls.some(c => c.path === "/entry"));
});

test("preset dialog and validation messages use English", async t => {
    const row = newRow("h3/test.safetensors", entry());
    const env = setup({ version: 1, rows: [row] }, { [row.lora]: entry() }); t.after(env.cleanup);
    await env.studio.savePreset(env.studio.state.rows[0]);
    const dialog = env.window.document.querySelector('dialog[aria-label="Save combination as preset"]');
    assert.equal(dialog.querySelector('[aria-label="Preset name"]').placeholder, "For example: Standard action");
    env.click("Save preset", dialog); await tick();
    assert.match(dialog.textContent, /Enter a name\./);
    dialog.querySelector('[aria-label="Preset name"]').value = "Finisher";
    env.click("Save preset", dialog); await tick();
    assert.match(dialog.textContent, /That name already exists/);
    assert.ok(!env.calls.some(c => c.path === "/entry"));
});

test("English UI preserves multilingual user triggers, labels, preset names and notes", async t => {
    const saved = { triggers: [{ text: "acción exacta, 日本語", label: "Efecto personal", default_on: true }],
        presets: [{ name: "Mi combinación", words: ["acción exacta, 日本語"] }], notes: "Notas del usuario — 日本語" };
    const row = newRow("h3/test.safetensors", saved);
    const env = setup({ version: 1, rows: [row] }, { [row.lora]: saved }); t.after(env.cleanup);
    assert.equal(env.root.querySelector("output").textContent, saved.triggers[0].text);
    env.click("Edit entry", env.root); await tick();
    const editor = env.window.document.querySelector('dialog[aria-label="Trigger words"]');
    assert.equal(editor.querySelector('[aria-label="Exact trigger text"]').value, saved.triggers[0].text);
    assert.equal(editor.querySelector('[aria-label="Effect description"]').value, saved.triggers[0].label);
    assert.equal(editor.querySelector('[aria-label="Usage notes"]').value, saved.notes);
    env.click("Save entry", editor); await tick();
    assert.deepEqual(env.catalog.loras[row.lora], saved);
    assert.deepEqual(JSON.parse(env.raw()).rows[0].entry, saved);
});
