import json
from pathlib import Path
import struct


TRIGGER_FIELDS = ("modelspec.trigger_phrase", "trigger_phrase", "trigger_word", "trigger_words", "ss_trigger_words", "activation_text")


def metadata_suggestions(path):
    if Path(path).suffix.lower() != ".safetensors":
        return {"triggers": [], "message": "Metadata reading is only available for .safetensors."}
    with open(path, "rb") as stream:
        prefix = stream.read(8)
        if len(prefix) != 8:
            raise ValueError("Incomplete safetensors header.")
        length = struct.unpack("<Q", prefix)[0]
        if length > 10_000_000:
            raise ValueError("Metadata header is too large (maximum 10 MB).")
        raw = stream.read(length)
        if len(raw) != length:
            raise ValueError("Incomplete safetensors header.")
        header = json.loads(raw)
    if not isinstance(header, dict):
        raise ValueError("Invalid safetensors header.")
    meta = header.get("__metadata__", {})
    if not isinstance(meta, dict):
        raise ValueError("Invalid safetensors metadata.")
    result = []
    seen = set()
    for field in TRIGGER_FIELDS:
        value = meta.get(field)
        if isinstance(value, str) and value.strip().startswith("["):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                pass
        # Singular phrases remain intact; plural fields commonly use comma-separated lists.
        if isinstance(value, str):
            value = value.split(",") if field in ("trigger_words", "ss_trigger_words") else [value]
        if not isinstance(value, list):
            continue
        for word in value:
            if isinstance(word, str) and word.strip() and len(word) <= 4096 and word.strip() not in seen:
                seen.add(word.strip())
                result.append({"text": word.strip(), "source": field})
    return {"triggers": result, "message": "Review the suggestions: metadata does not always explain which combinations to use." if result else "No explicit trigger fields found. Enter trigger words or save this LoRA without triggers."}
