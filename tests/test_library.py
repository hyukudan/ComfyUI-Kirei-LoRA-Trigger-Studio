import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from library import LibraryConflict, TriggerLibrary, active_rows, lora_key, parse_config, trigger_text, validate_entry, validate_library
from metadata import metadata_suggestions


def entry():
    return {"triggers": [{"text": "exact_phrase", "label": "Efecto", "default_on": True},
                         {"text": "a whole phrase, intact", "label": "Variante", "default_on": False}],
            "presets": [{"name": "Normal", "words": ["exact_phrase"]}], "notes": "Documentación"}


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "data" / "lora_triggers.json"
        self.store = TriggerLibrary(self.path)

    def test_missing_library_is_read_only(self):
        self.assertEqual(self.store.read(), ({"version": 1, "loras": {}}, "missing"))
        self.assertFalse(self.path.exists())

    def test_validation_and_conflict_messages_are_english(self):
        with self.assertRaisesRegex(ValueError, "Invalid LoRA name"):
            lora_key(None)
        with self.assertRaisesRegex(ValueError, "Use a path relative to the LoRA folder"):
            lora_key("../outside.safetensors")
        with self.assertRaisesRegex(ValueError, "Each LoRA needs a 'triggers' list"):
            validate_entry({})
        with self.assertRaisesRegex(ValueError, "Label: invalid text"):
            validate_entry({"triggers": [{"text": "word", "label": None}]})
        self.store.save_entry("test.safetensors", entry(), "missing")
        with self.assertRaisesRegex(LibraryConflict, "The library has changed"):
            self.store.save_entry("test.safetensors", entry(), "missing")

    def test_roundtrip_unicode_and_backup(self):
        _, revision = self.store.save_entry("h3\\modelo.safetensors", entry(), "missing")
        first = self.path.read_bytes()
        self.store.save_entry("h3/modelo.safetensors", {"triggers": []}, revision)
        data, _ = self.store.read()
        self.assertEqual(data["loras"]["h3/modelo.safetensors"]["triggers"], [])
        self.assertEqual(self.path.with_suffix(".json.bak").read_bytes(), first)
        self.assertIn("Documentación", first.decode("utf-8"))

    def test_optimistic_concurrency(self):
        self.store.save_entry("a.safetensors", entry(), "missing")
        with self.assertRaises(LibraryConflict):
            self.store.save_entry("b.safetensors", entry(), "missing")
        self.assertNotIn("b.safetensors", self.store.read()[0]["loras"])

    def test_parallel_writers_do_not_lose_updates(self):
        def save(name):
            try:
                self.store.save_entry(name, entry(), "missing")
                return True
            except LibraryConflict:
                return False
        with ThreadPoolExecutor(2) as executor:
            results = list(executor.map(save, ["a.safetensors", "b.safetensors"]))
        self.assertEqual(sum(results), 1)

    def test_corrupt_library_not_overwritten(self):
        self.path.parent.mkdir()
        self.path.write_text("broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.store.save_entry("a.safetensors", entry(), "anything")
        self.assertEqual(self.path.read_text(), "broken")

    def test_merge_preserves_existing(self):
        _, rev = self.store.save_entry("a.safetensors", entry(), "missing")
        result = self.store.merge({"version": 1, "loras": {"a.safetensors": {"triggers": []}, "b.safetensors": {"triggers": []}}}, rev)
        self.assertEqual(result, (1, 1))
        self.assertEqual(self.store.read()[0]["loras"]["a.safetensors"], entry())

    def test_bad_import_is_all_or_nothing(self):
        with self.assertRaises(ValueError):
            self.store.merge({"version": 1, "loras": {"a.safetensors": entry(), "../bad": entry()}}, "missing")
        self.assertFalse(self.path.exists())

    def test_paths_are_relative_and_normalized(self):
        self.assertEqual(lora_key("h3\\a.safetensors"), "h3/a.safetensors")
        for value in ("/tmp/a", "../a", "h3/../a", "C:\\a", "h3//a", "", None, "a\x00b"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                lora_key(value)

    def test_duplicate_trigger_and_invalid_preset_rejected(self):
        data = entry()
        data["triggers"].append(data["triggers"][0])
        with self.assertRaises(ValueError): validate_entry(data)
        data = entry()
        data["presets"][0]["words"] = ["unknown"]
        with self.assertRaises(ValueError): validate_entry(data)

    def test_normalized_duplicate_paths_rejected(self):
        with self.assertRaises(ValueError):
            validate_library({"version": 1, "loras": {"h3/a": entry(), "h3\\a": entry()}})


class ConfigTests(unittest.TestCase):
    def row(self, **changes):
        return {"lora": "a.safetensors", "enabled": True, "strength_model": 1, "strength_clip": 1, "selected": ["one", "a phrase, intact"], **changes}

    def test_trigger_order_exact_phrases_and_dedup(self):
        rows = parse_config(json.dumps({"version": 1, "rows": [self.row(), self.row(selected=["one", "TWO"])]}))
        self.assertEqual(trigger_text(rows), "one, a phrase, intact, TWO")

    def test_disabled_and_zero_strength_rows_are_excluded(self):
        rows = [self.row(enabled=False), self.row(strength_model=0, strength_clip=0), self.row(strength_model=0)]
        self.assertEqual(active_rows(rows, False), [])
        self.assertEqual(active_rows(rows, True), [rows[2]])

    def test_negative_strength_is_active(self):
        self.assertEqual(len(active_rows([self.row(strength_model=-0.5)], False)), 1)

    def test_bad_types_versions_and_nan_rejected(self):
        for changes in ({"enabled": "false"}, {"strength_model": True}, {"strength_model": float("nan")}, {"strength_clip": 101}, {"selected": "one"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                parse_config(json.dumps({"version": 1, "rows": [self.row(**changes)]}))
        with self.assertRaises(ValueError): parse_config('{"version":2,"rows":[]}')

    def test_single_strength_mode_uses_model_value_for_clip(self):
        config = {"version": 1, "strength_mode": "single", "rows": [self.row(strength_model=0.4, strength_clip=0.9)]}
        self.assertEqual(parse_config(json.dumps(config))[0]["strength_clip"], 0.4)
        config["strength_mode"] = "unknown"
        with self.assertRaises(ValueError): parse_config(json.dumps(config))


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "sample.safetensors"

    def write_header(self, metadata):
        raw = json.dumps({"__metadata__": metadata}).encode()
        self.path.write_bytes(struct.pack("<Q", len(raw)) + raw)

    def test_explicit_fields_only(self):
        self.write_header({"ss_tag_frequency": '{"dataset":{"person":999}}', "ss_output_name": "not_a_trigger"})
        self.assertEqual(metadata_suggestions(self.path)["triggers"], [])

    def test_exact_phrase_and_json_list(self):
        self.write_header({"modelspec.trigger_phrase": "A phrase, with comma", "ss_trigger_words": '["one","two","one"]'})
        words = metadata_suggestions(self.path)["triggers"]
        self.assertEqual([w["text"] for w in words], ["A phrase, with comma", "one", "two"])
        self.assertEqual(words[0]["source"], "modelspec.trigger_phrase")

    def test_no_pickle_deserialization(self):
        self.assertEqual(metadata_suggestions("untrusted.ckpt")["triggers"], [])
        self.assertEqual(metadata_suggestions("untrusted.ckpt")["message"], "Metadata reading is only available for .safetensors.")

    def test_oversized_and_short_header_rejected(self):
        for content in (b"short", struct.pack("<Q", 10_000_001)):
            self.path.write_bytes(content)
            with self.assertRaises(ValueError): metadata_suggestions(self.path)


if __name__ == "__main__":
    unittest.main()
