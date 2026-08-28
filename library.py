import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import threading


class LibraryConflict(ValueError):
    pass


def lora_key(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError("Invalid LoRA name.")
    value = value.replace("\\", "/")
    if any(part in ("", ".", "..") for part in value.split("/")) or ":" in value or "\x00" in value:
        raise ValueError("Use a path relative to the LoRA folder.")
    return value


def text(value, name, limit=4096, empty=False):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ValueError(f"{name}: invalid text (maximum {limit} characters).")
    return value.strip()


def validate_entry(entry):
    if not isinstance(entry, dict) or not isinstance(entry.get("triggers"), list):
        raise ValueError("Each LoRA needs a 'triggers' list (it may be empty).")
    triggers = []
    seen = set()
    for item in entry["triggers"]:
        if not isinstance(item, dict):
            raise ValueError("Each trigger must contain 'text', 'label', and 'default_on'.")
        word = text(item.get("text"), "Trigger")
        if word in seen:
            raise ValueError(f"Duplicate trigger: {word}")
        default_on = item.get("default_on", False)
        if type(default_on) is not bool:
            raise ValueError("default_on must be a boolean.")
        seen.add(word)
        triggers.append({"text": word, "label": text(item.get("label", ""), "Label", 512, True), "default_on": default_on})
    presets = entry.get("presets", [])
    if not isinstance(presets, list):
        raise ValueError("presets must be a list.")
    clean_presets = []
    names = set()
    for preset in presets:
        if not isinstance(preset, dict):
            raise ValueError("Invalid preset.")
        name = text(preset.get("name"), "Preset name", 128)
        words = preset.get("words")
        if name in names or not isinstance(words, list) or any(not isinstance(w, str) or w not in seen for w in words):
            raise ValueError("Presets must have unique names and use words present in 'triggers'.")
        if len(set(words)) != len(words):
            raise ValueError("A preset cannot contain duplicate words.")
        names.add(name)
        clean_presets.append({"name": name, "words": words})
    return {"triggers": triggers, "presets": clean_presets, "notes": text(entry.get("notes", ""), "Notes", 16384, True)}


def validate_library(data):
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1 or not isinstance(data.get("loras"), dict):
        raise ValueError("Expected a library with {version: 1, loras: {...}}.")
    loras = {}
    for name, entry in data["loras"].items():
        key = lora_key(name)
        if key in loras:
            raise ValueError(f"Duplicate LoRA path: {key}")
        loras[key] = validate_entry(entry)
    return {"version": 1, "loras": loras}


def parse_config(raw):
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 2_000_000:
        raise ValueError("Invalid or oversized configuration.")
    data = json.loads(raw)
    if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1 or not isinstance(data.get("rows"), list):
        raise ValueError("Unsupported workflow configuration.")
    if data.get("strength_mode", "separate") not in ("single", "separate"):
        raise ValueError("Invalid strength mode.")
    rows = []
    for row in data["rows"]:
        if not isinstance(row, dict) or type(row.get("enabled")) is not bool:
            raise ValueError("Invalid LoRA row.")
        name = lora_key(row.get("lora"))
        strengths = []
        for field in ("strength_model", "strength_clip"):
            strength = row.get(field)
            if type(strength) not in (int, float) or not math.isfinite(strength) or not -100 <= strength <= 100:
                raise ValueError(f"{name}: {field} must be between -100 and 100.")
            strengths.append(float(strength))
        if data.get("strength_mode") == "single":
            strengths[1] = strengths[0]
        selected = row.get("selected")
        if not isinstance(selected, list):
            raise ValueError(f"{name}: selected must be a list of trigger words.")
        words = list(dict.fromkeys(text(w, "Trigger") for w in selected))
        rows.append({"lora": name, "enabled": row["enabled"], "strength_model": strengths[0], "strength_clip": strengths[1], "selected": words})
    return rows


def active_rows(rows, has_clip):
    return [r for r in rows if r["enabled"] and (r["strength_model"] != 0 or (has_clip and r["strength_clip"] != 0))]


def trigger_text(rows):
    return ", ".join(dict.fromkeys(word for row in rows for word in row["selected"]))


class TriggerLibrary:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            if not self.path.exists():
                return {"version": 1, "loras": {}}, "missing"
            raw = self.path.read_bytes()
            data = validate_library(json.loads(raw.decode("utf-8-sig")))
            return data, hashlib.sha256(raw).hexdigest()

    def save_entry(self, name, entry, revision):
        name, entry = lora_key(name), validate_entry(entry)
        with self.lock:
            data, current = self.read()
            if revision != current:
                raise LibraryConflict("The library has changed. Close and reopen the editor before saving.")
            data["loras"][name] = entry
            self._write(data)
            return self.read()

    def merge(self, incoming, revision):
        incoming = validate_library(incoming)
        with self.lock:
            data, current = self.read()
            if revision != current:
                raise LibraryConflict("The library has changed. Reopen Import JSON.")
            added = 0
            for name, entry in incoming["loras"].items():
                if name not in data["loras"]:
                    data["loras"][name] = entry
                    added += 1
            if added:
                self._write(data)
            return added, len(incoming["loras"]) - added

    def _write(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if self.path.exists():
            self._atomic_write(self.path.with_suffix(".json.bak"), self.path.read_bytes())
        self._atomic_write(self.path, payload)

    @staticmethod
    def _atomic_write(path, payload):
        fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
