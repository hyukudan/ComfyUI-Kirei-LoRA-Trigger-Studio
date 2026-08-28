from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


def find_preview(model_path):
    model = Path(model_path).resolve()
    for prefix in (model.with_suffix("").name + ".preview", model.with_suffix("").name, model.name):
        for extension in (".png", ".jpg", ".jpeg", ".webp"):
            candidate = model.parent / (prefix + extension)
            if candidate.is_file() and candidate.resolve().parent == model.parent:
                return candidate
    return None


def preview_bytes(model_path, size=96):
    if size not in (96, 640):
        raise ValueError("Unsupported thumbnail size.")
    path = find_preview(model_path)
    if path is None:
        return None
    if path.stat().st_size > 20_000_000:
        raise ValueError("The preview image exceeds 20 MB.")
    try:
        with Image.open(path) as image:
            if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > 16_000_000:
                raise ValueError("Unsupported or oversized preview image (maximum 16 megapixels).")
            image = ImageOps.exif_transpose(image)
            image.thumbnail((size, size))
            image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="WEBP", quality=82)
            return output.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as exc:
        raise ValueError("Could not decode the local preview.") from exc
