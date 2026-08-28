import folder_paths
from nodes import LoraLoader

from .library import active_rows, lora_key, parse_config, trigger_text


class LoRATriggerStudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "config": ("STRING", {"default": '{"version":1,"strength_mode":"single","rows":[]}', "multiline": False}),
            },
            "optional": {"clip": ("CLIP",)},
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "trigger_words")
    FUNCTION = "load"
    CATEGORY = "Kirei/loaders"
    SEARCH_ALIASES = ["kirei", "lora", "trigger words", "multi lora", "lora loader", "trigger studio"]
    DESCRIPTION = "Load multiple LoRAs and output only the selected trigger words from active LoRAs. Local JSON library, no external services."

    def load(self, model, config, clip=None):
        rows = active_rows(parse_config(config), clip is not None)
        available = {lora_key(name): name for name in folder_paths.get_filename_list("loras")}
        # Resolve the whole stack before loading any weights.
        for row in rows:
            if row["lora"] not in available:
                raise ValueError(f"LoRA not found: {row['lora']}. Check the model folder or change the row.")
            folder_paths.get_full_path_or_raise("loras", available[row["lora"]])
        for row in rows:
            model, clip = LoraLoader().load_lora(
                model, clip, available[row["lora"]], row["strength_model"], row["strength_clip"] if clip is not None else 0,
            )
        return model, clip, trigger_text(rows)
