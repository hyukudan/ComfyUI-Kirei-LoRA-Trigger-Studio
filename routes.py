import asyncio
from functools import wraps
import json
import os
from pathlib import Path

from aiohttp import web
import folder_paths
from server import PromptServer

from .library import LibraryConflict, TriggerLibrary, lora_key
from .metadata import metadata_suggestions
from .previews import preview_bytes


library = TriggerLibrary(os.environ.get("LORA_TRIGGER_STUDIO_LIBRARY", str(Path(__file__).parent / "data" / "lora_triggers.json")))
routes = PromptServer.instance.routes
preview_slots = asyncio.Semaphore(2)


def json_errors(handler):
    @wraps(handler)
    async def wrapped(request):
        try:
            return await handler(request)
        except LibraryConflict as exc:
            return web.json_response({"error": str(exc)}, status=409)
        except (ValueError, UnicodeError) as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except OSError:
            return web.json_response({"error": "Cannot access the JSON library. Check its path and permissions."}, status=500)
    return wrapped


async def read_body(request):
    if request.content_type != "application/json":
        raise ValueError("Content-Type must be application/json.")
    raw = bytearray()
    async for chunk in request.content.iter_chunked(65536):
        raw.extend(chunk)
        if len(raw) > 2_000_000:
            raise ValueError("JSON exceeds the 2 MB limit.")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    return data


@routes.get("/lora-trigger-studio/loras")
@json_errors
async def get_loras(request):
    names = await asyncio.to_thread(folder_paths.get_filename_list, "loras")
    return web.json_response({"loras": [lora_key(name) for name in names]})


@routes.get("/lora-trigger-studio/library")
@json_errors
async def get_library(request):
    data, revision = await asyncio.to_thread(library.read)
    return web.json_response({"library": data, "revision": revision})


@routes.get("/lora-trigger-studio/suggestions")
@json_errors
async def get_suggestions(request):
    name = lora_key(request.query.get("lora"))
    available = await asyncio.to_thread(folder_paths.get_filename_list, "loras")
    names = {lora_key(item): item for item in available}
    if name not in names:
        raise ValueError("LoRA not found.")
    path = folder_paths.get_full_path_or_raise("loras", names[name])
    return web.json_response(await asyncio.to_thread(metadata_suggestions, path))


@routes.get("/lora-trigger-studio/preview")
@json_errors
async def get_preview(request):
    name = lora_key(request.query.get("lora"))
    available = await asyncio.to_thread(folder_paths.get_filename_list, "loras")
    names = {lora_key(item): item for item in available}
    if name not in names:
        raise ValueError("LoRA not found.")
    path = folder_paths.get_full_path_or_raise("loras", names[name])
    async with preview_slots:
        image = await asyncio.to_thread(preview_bytes, path, int(request.query.get("size", "96")))
    if image is None:
        return web.Response(status=204, headers={"Cache-Control": "private, max-age=60"})
    return web.Response(body=image, content_type="image/webp", headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})


@routes.get("/lora-trigger-studio/export")
@json_errors
async def export_library(request):
    data, _ = await asyncio.to_thread(library.read)
    return web.Response(text=json.dumps(data, ensure_ascii=False, indent=2), content_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="lora_triggers.json"'})


@routes.post("/lora-trigger-studio/entry")
@json_errors
async def save_entry(request):
    body = await read_body(request)
    name = lora_key(body.get("lora"))
    available = await asyncio.to_thread(folder_paths.get_filename_list, "loras")
    if name not in {lora_key(item) for item in available}:
        raise ValueError("This LoRA is not in ComfyUI's model folders.")
    data, revision = await asyncio.to_thread(library.save_entry, name, body.get("entry"), body.get("revision"))
    return web.json_response({"entry": data["loras"][name], "revision": revision})


@routes.post("/lora-trigger-studio/import")
@json_errors
async def import_library(request):
    body = await read_body(request)
    added, skipped = await asyncio.to_thread(library.merge, body.get("library"), body.get("revision"))
    return web.json_response({"added": added, "skipped": skipped})
