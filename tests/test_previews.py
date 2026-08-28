from io import BytesIO
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from previews import find_preview, preview_bytes


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / "sample.safetensors"
        self.model.touch()

    def image(self, name, size=(256, 128), format="PNG"):
        path = self.root / name
        Image.new("RGB", size, "teal").save(path, format=format)
        return path

    def test_missing_preview_is_not_an_error(self):
        self.assertIsNone(preview_bytes(self.model))

    def test_preview_suffix_has_priority(self):
        self.image("sample.png")
        expected = self.image("sample.preview.webp", format="WEBP")
        self.assertEqual(find_preview(self.model), expected)

    def test_model_extension_suffix_supported(self):
        expected = self.image("sample.safetensors.jpg", format="JPEG")
        self.assertEqual(find_preview(self.model), expected)

    def test_output_is_bounded_webp_without_source_metadata(self):
        self.image("sample.png")
        with Image.open(BytesIO(preview_bytes(self.model))) as image:
            self.assertEqual(image.format, "WEBP")
            self.assertEqual(image.size, (96, 48))
            self.assertNotIn("exif", image.info)

    def test_only_fixed_sizes_allowed(self):
        self.image("sample.png")
        with self.assertRaises(ValueError): preview_bytes(self.model, 9999)
        with Image.open(BytesIO(preview_bytes(self.model, 640))) as image:
            self.assertEqual(image.size, (256, 128))

    def test_svg_or_arbitrary_file_never_served_raw(self):
        (self.root / "sample.png").write_text('<svg onload="alert(1)"></svg>')
        with self.assertRaises(ValueError): preview_bytes(self.model)

    def test_other_image_formats_rejected_even_with_png_extension(self):
        self.image("sample.png", format="BMP")
        with self.assertRaises(ValueError): preview_bytes(self.model)

    def test_large_image_pixel_limit(self):
        self.image("sample.png", size=(4001, 4000))
        with self.assertRaises(ValueError): preview_bytes(self.model)

    def test_large_file_rejected_before_decoding(self):
        with (self.root / "sample.png").open("wb") as file:
            file.truncate(20_000_001)
        with self.assertRaisesRegex(ValueError, "20 MB"):
            preview_bytes(self.model)

    def test_symlink_outside_model_directory_ignored(self):
        outside = self.root / "outside"
        outside.mkdir()
        image = outside / "other.png"
        Image.new("RGB", (1, 1)).save(image)
        try:
            (self.root / "sample.png").symlink_to(image)
        except OSError:
            self.skipTest("OS does not permit creating symlinks")
        self.assertIsNone(find_preview(self.model))
