import test from "node:test";
import assert from "node:assert/strict";
import { active, blankEntry, emptyState, moveRowTo, newRow, previewText, readState, refreshEntry, selectWord } from "../web/state.js";

const entry = { triggers: [{ text: "one", label: "Normal", default_on: true }, { text: "a phrase, intact", label: "Variant", default_on: false }],
    presets: [{ name: "Normal", words: ["one"] }], notes: "Example" };
test("defaults select only explicit default words", () => {
    assert.deepEqual(newRow("one.safetensors", entry).selected, ["one"]);
});
test("rows clone catalog instead of mutating it", () => {
    const row = newRow("one.safetensors", entry);
    row.entry.triggers[0].label = "Edited";
    assert.equal(entry.triggers[0].label, "Normal");
});
test("preview matches enabled and nonzero effective strengths", () => {
    const state = emptyState(); state.rows.push(newRow("one", entry));
    state.rows[0].strength_model = 0;
    assert.equal(previewText(state, false), "");
    assert.equal(previewText(state, true), "one");
    state.rows[0].enabled = false;
    assert.equal(previewText(state, true), "");
});
test("toggle preserves exact phrases and order", () => {
    const row = newRow("one", entry);
    selectWord(row, "a phrase, intact", true); selectWord(row, "one", false);
    assert.equal(previewText({ rows: [row] }, false), "a phrase, intact");
});
test("workflow roundtrip retains independent selection and presets", () => {
    const state = { version: 1, rows: [newRow("one", entry)] };
    state.rows[0].selected = [];
    assert.deepEqual(readState(JSON.stringify(state)), state);
});
test("refresh retains selection, removes unavailable words, does not enable new defaults", () => {
    const row = newRow("one", entry);
    refreshEntry(row, { triggers: [{ text: "other", default_on: true }], presets: [], notes: "" });
    assert.deepEqual(row.selected, []);
});
test("invalid serialized config is not silently reset", () => {
    for (const raw of ["oops", '{"version":2,"rows":[]}', '{"version":1,"rows":[{}]}']) assert.throws(() => readState(raw));
});
test("deduplicates across LoRAs without changing case", () => {
    const one = newRow("one", entry), two = newRow("two", entry);
    two.selected.push("ONE");
    assert.equal(previewText({ rows: [one, two] }, false), "one, ONE");
});
test("no-trigger entry is a remembered valid choice", () => {
    assert.deepEqual(newRow("one", blankEntry()).selected, []);
});
test("new nodes default to a shared strength while legacy nodes remain separate", () => {
    assert.equal(emptyState().strength_mode, "single");
    const row = newRow("one", entry); row.strength_model = 0.4; row.strength_clip = 0.9;
    assert.equal(readState(JSON.stringify({ version: 1, strength_mode: "single", rows: [row] })).rows[0].strength_clip, 0.4);
    assert.equal(readState(JSON.stringify({ version: 1, rows: [row] })).rows[0].strength_clip, 0.9);
});
test("drop insertion boundaries work both ways and invalid indices are no-ops", () => {
    const state = { rows: ["a", "b", "c"] };
    assert.equal(moveRowTo(state, 2, 0), 0);
    assert.deepEqual(state.rows, ["c", "a", "b"]);
    assert.equal(moveRowTo(state, 0, 1), 0);
    assert.deepEqual(state.rows, ["c", "a", "b"]);
    assert.equal(moveRowTo(state, -1, 0), -1);
});
