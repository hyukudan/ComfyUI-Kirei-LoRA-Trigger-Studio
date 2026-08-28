import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        calls = self.calls
        class NativeLoader:
            def load_lora(self, model, clip, name, sm, sc):
                calls.append((name, sm, sc))
                return model + [name], clip
        paths = types.ModuleType("folder_paths")
        paths.get_filename_list = lambda kind: ["h3\\one.safetensors", "two.safetensors"]
        paths.get_full_path_or_raise = lambda kind, name: "models/" + name
        native = types.ModuleType("nodes")
        native.LoraLoader = NativeLoader
        package = types.ModuleType("lts_test_package")
        package.__path__ = [str(ROOT)]
        mocks = patch.dict(sys.modules, {"folder_paths": paths, "nodes": native, "lts_test_package": package})
        mocks.start()
        self.addCleanup(mocks.stop)
        spec = importlib.util.spec_from_file_location("lts_test_package.nodes", ROOT / "nodes.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.loader = module.LoRATriggerStudio()

    def row(self, lora="h3/one.safetensors", **kw):
        return {"lora": lora, "enabled": True, "strength_model": 0.8, "strength_clip": 0.7, "selected": ["trigger"], **kw}

    def load(self, rows, clip=None):
        return self.loader.load([], json.dumps({"version": 1, "rows": rows}), clip)

    def test_model_only_uses_native_loader_and_clip_zero(self):
        result = self.load([self.row()])
        self.assertEqual(self.calls, [("h3\\one.safetensors", 0.8, 0)])
        self.assertEqual(result, (["h3\\one.safetensors"], None, "trigger"))

    def test_stack_order_and_clip_strength(self):
        clip = object()
        result = self.load([self.row(), self.row("two.safetensors", selected=["second"])], clip)
        self.assertEqual(result[0], ["h3\\one.safetensors", "two.safetensors"])
        self.assertIs(result[1], clip)
        self.assertEqual(self.calls[0][2], 0.7)
        self.assertEqual(result[2], "trigger, second")

    def test_missing_file_fails_before_any_load(self):
        with self.assertRaises(ValueError): self.load([self.row(), self.row("missing.safetensors")])
        self.assertEqual(self.calls, [])

    def test_disabled_missing_file_does_not_break_workflow(self):
        self.assertEqual(self.load([self.row("missing.safetensors", enabled=False)]), ([], None, ""))

    def test_clip_only_strength_without_clip_does_not_emit_words(self):
        self.assertEqual(self.load([self.row(strength_model=0)]), ([], None, ""))

    def test_no_library_access_needed_for_workflow_execution(self):
        self.assertEqual(self.load([self.row(selected=["workflow_snapshot"])])[2], "workflow_snapshot")


if __name__ == "__main__":
    unittest.main()
