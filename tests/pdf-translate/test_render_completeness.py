#!/usr/bin/env python3
"""API-free regression tests for the low-level PDF text draw completeness contract."""

import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import fitz


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "lib" / "pipelines" / "pdf-translate" / "translate_pdf.py"
SPEC = importlib.util.spec_from_file_location("quilo_translate_pdf", MODULE_PATH)
translate_pdf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(translate_pdf)


class DrawCompletenessTest(unittest.TestCase):
    def setUp(self):
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=120, height=120)
        self.font = fitz.Font("helv")

    def tearDown(self):
        self.doc.close()

    def test_draw_fit_reports_complete_normal_text(self):
        state = translate_pdf._draw_fit(
            self.page,
            fitz.Rect(5, 5, 115, 35),
            "Short complete text",
            (0, 0, 0),
            self.font,
            10,
            fitz.TEXT_ALIGN_LEFT,
            max_x=115,
            max_y=35,
        )
        self.assertTrue(state["drawn"])
        self.assertTrue(state["complete"])
        self.assertFalse(state["shrunk"])
        self.assertEqual(state["min_font"], 10.0)

    def test_draw_fit_reports_minimum_font_overflow(self):
        state = translate_pdf._draw_fit(
            self.page,
            fitz.Rect(5, 5, 28, 11),
            "overflow " * 200,
            (0, 0, 0),
            self.font,
            12,
            fitz.TEXT_ALIGN_LEFT,
            min_size=4,
            max_x=28,
            max_y=11,
        )
        self.assertTrue(state["drawn"])
        self.assertFalse(state["complete"])
        self.assertTrue(state["shrunk"])
        self.assertEqual(state["min_font"], 4.0)

    def test_ocr_raster_planner_downscales_readable_wide_pages(self):
        plan = translate_pdf._plan_raster_page_tiles(4_000, 1_000, 1_400)

        self.assertAlmostEqual(plan["zoom"], 0.35, places=6)
        self.assertLessEqual(plan["width"], 1_400)
        self.assertLess(plan["predicted_pixels"], 1_000_000)

    def test_ocr_raster_planner_keeps_supported_long_page_tiling(self):
        plan = translate_pdf._plan_raster_page_tiles(958, 11_833, 1_400)

        self.assertGreater(len(plan["tiles"]), 1)
        self.assertEqual(plan["tiles"][0]["y0"], 0.0)
        self.assertEqual(plan["tiles"][-1]["y1"], 11_833)
        for previous, current in zip(plan["tiles"], plan["tiles"][1:]):
            self.assertEqual(previous["y1"], current["y0"])
        self.assertLessEqual(
            plan["predicted_pixels"],
            translate_pdf.RASTER_MAX_PAGE_PIXEL_AREA,
        )

    def test_ocr_rasterizer_emits_sealed_geometry_inputs_in_exact_order(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf_path = Path(directory) / "source.pdf"
            output_dir = Path(directory) / "tiles"
            document = fitz.open()
            document.new_page(width=600, height=3_000)
            rotated = document.new_page(width=200, height=100)
            rotated.set_rotation(90)
            document.save(pdf_path)
            document.close()

            stream = io.StringIO()
            with mock.patch.object(translate_pdf, "_JSON_STDOUT_FD", None):
                with redirect_stdout(stream):
                    translate_pdf.cmd_rasterize(
                        str(pdf_path),
                        str(output_dir),
                        target_width_px=600,
                        max_pages=2,
                    )
            result = json.loads(stream.getvalue())

            self.assertEqual(result["page_count"], 2)
            self.assertEqual(result["rendered_pages"], 2)
            self.assertEqual([page["index"] for page in result["pages"]], [0, 1])
            self.assertEqual(result["pages"][1]["rotation"], 90)
            self.assertEqual(result["pages"][1]["width"], 100.0)
            self.assertEqual(result["pages"][1]["height"], 200.0)
            flattened = []
            for page in result["pages"]:
                self.assertGreater(len(page["tiles"]), 0)
                covered_to = 0.0
                for position, tile in enumerate(page["tiles"]):
                    self.assertEqual(tile["index"], position)
                    self.assertEqual(tile["bbox"][0], 0.0)
                    self.assertEqual(tile["bbox"][1], covered_to)
                    self.assertEqual(tile["bbox"][2], page["width"])
                    covered_to = tile["bbox"][3]
                    self.assertTrue(Path(tile["file"]).is_file())
                    flattened.append(tile["file"])
                self.assertEqual(covered_to, page["height"])
            self.assertEqual(flattened, result["files"])

    def test_ocr_raster_planner_rejects_unsafe_geometry_before_pixmap(self):
        class FakeRect:
            width = 100_000
            height = 1_000
            x0 = 0
            y0 = 0
            x1 = 100_000
            y1 = 1_000

        class FakePage:
            rect = FakeRect()

            def __init__(self):
                self.get_pixmap_calls = 0

            def get_pixmap(self, **_kwargs):
                self.get_pixmap_calls += 1
                raise AssertionError("get_pixmap must not run for rejected geometry")

        class FakeDocument:
            def __init__(self, page):
                self.page = page
                self.closed = False

            def __len__(self):
                return 1

            def __getitem__(self, index):
                if index != 0:
                    raise IndexError(index)
                return self.page

            def close(self):
                self.closed = True

        page = FakePage()
        document = FakeDocument(page)
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(translate_pdf.fitz, "open", return_value=document):
                with self.assertRaisesRegex(ValueError, "unsafe OCR raster zoom"):
                    translate_pdf.cmd_rasterize(
                        "untrusted.pdf",
                        directory,
                        target_width_px=1_400,
                        max_pages=1,
                    )

        self.assertEqual(page.get_pixmap_calls, 0)
        self.assertTrue(document.closed)

    def test_background_sampler_rejects_unsafe_geometry_before_pixmap(self):
        class UnsafePage:
            rect = fitz.Rect(0, 0, 100_000, 1_000)

            def __init__(self):
                self.get_pixmap_calls = 0

            def get_pixmap(self, **_kwargs):
                self.get_pixmap_calls += 1
                raise AssertionError("unsafe full-page pixmap allocation")

        page = UnsafePage()
        with self.assertRaisesRegex(ValueError, "background sample"):
            translate_pdf._sample_pixmap(page)
        self.assertEqual(page.get_pixmap_calls, 0)

    def test_draw_rich_keeps_base_and_glyph_font_sizes_separate(self):
        state = translate_pdf._draw_rich(
            self.page,
            fitz.Rect(5, 5, 115, 35),
            "H<sub>2</sub>O",
            (0, 0, 0),
            self.font,
            10,
            fitz.TEXT_ALIGN_LEFT,
            max_x=115,
            max_y=35,
        )
        self.assertTrue(state["drawn"])
        self.assertTrue(state["complete"])
        self.assertEqual(state["min_font"], 10.0)
        self.assertEqual(state["min_glyph_font"], 6.6)

    def test_draw_rich_reports_layout_overflow(self):
        state = translate_pdf._draw_rich(
            self.page,
            fitz.Rect(5, 5, 25, 11),
            "H<sub>2</sub> overflow " * 100,
            (0, 0, 0),
            self.font,
            12,
            fitz.TEXT_ALIGN_LEFT,
            min_size=5,
            max_x=25,
            max_y=11,
        )
        self.assertTrue(state["drawn"])
        self.assertFalse(state["complete"])
        self.assertTrue(state["shrunk"])
        self.assertEqual(state["min_font"], 5.0)

    def test_draw_rich_reports_append_failure(self):
        class AppendFailWriter:
            def __init__(self, *_args, **_kwargs):
                pass

            def append(self, *_args, **_kwargs):
                raise RuntimeError("append failed")

            def write_text(self, *_args, **_kwargs):
                return None

        with mock.patch.object(translate_pdf.fitz, "TextWriter", AppendFailWriter):
            state = translate_pdf._draw_rich(
                self.page,
                fitz.Rect(5, 5, 115, 35),
                "H<sub>2</sub>O",
                (0, 0, 0),
                self.font,
                10,
                fitz.TEXT_ALIGN_LEFT,
            )
        self.assertFalse(state["drawn"])
        self.assertFalse(state["complete"])

    def test_draw_rich_reports_write_failure(self):
        class WriteFailWriter:
            def __init__(self, *_args, **_kwargs):
                pass

            def append(self, *_args, **_kwargs):
                return None

            def write_text(self, *_args, **_kwargs):
                raise RuntimeError("write failed")

        with mock.patch.object(translate_pdf.fitz, "TextWriter", WriteFailWriter):
            state = translate_pdf._draw_rich(
                self.page,
                fitz.Rect(5, 5, 115, 35),
                "H<sub>2</sub>O",
                (0, 0, 0),
                self.font,
                10,
                fitz.TEXT_ALIGN_LEFT,
            )
        self.assertFalse(state["drawn"])
        self.assertFalse(state["complete"])

    def test_render_command_reports_overflow_block_ids(self):
        with tempfile.TemporaryDirectory(prefix="quilo-pdf-render-test-") as tmp:
            source = Path(tmp) / "source.pdf"
            output = Path(tmp) / "output.pdf"
            doc = fitz.open()
            page = doc.new_page(width=200, height=120)
            page.insert_textbox(
                fitz.Rect(10, 10, 190, 50),
                "English paragraph for translation completeness testing.",
                fontsize=10,
                fontname="helv",
            )
            doc.save(source)
            doc.close()

            extracted = subprocess.run(
                [sys.executable, str(MODULE_PATH), "extract", str(source)],
                check=True,
                capture_output=True,
                text=True,
            )
            meta = json.loads(extracted.stdout)
            self.assertEqual(len(meta["blocks"]), 1)
            block_id = str(meta["blocks"][0]["id"])
            payload = json.dumps(
                {"translations": {block_id: "아주 긴 번역문 " * 200}},
                ensure_ascii=False,
            )
            rendered = subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "render",
                    str(source),
                    str(output),
                    str(ROOT / "lib" / "fonts" / "Pretendard-Regular.ttf"),
                ],
                input=payload,
                check=True,
                capture_output=True,
                text=True,
            )
            stats = json.loads(rendered.stdout)
            self.assertFalse(stats["ok"])
            self.assertEqual(stats["overflow"], 1)
            self.assertEqual([str(v) for v in stats["overflow_ids"]], [block_id])
            self.assertEqual(stats["failed"], 0)
            self.assertEqual(stats["min_font"], 4.0)
            self.assertEqual(len(stats["font_sizes"]), 1)
            self.assertEqual(str(stats["font_sizes"][0]["id"]), block_id)
            self.assertEqual(stats["font_sizes"][0]["source"], 10.0)
            self.assertEqual(stats["font_sizes"][0]["rendered"], 4.0)
            self.assertTrue(output.exists())

            complete_output = Path(tmp) / "complete-output.pdf"
            complete_payload = json.dumps(
                {"translations": {block_id: "완전한 번역 문장입니다."}},
                ensure_ascii=False,
            )
            complete_render = subprocess.run(
                [
                    sys.executable,
                    str(MODULE_PATH),
                    "render",
                    str(source),
                    str(complete_output),
                    str(ROOT / "lib" / "fonts" / "Pretendard-Regular.ttf"),
                ],
                input=complete_payload,
                check=True,
                capture_output=True,
                text=True,
            )
            complete_stats = json.loads(complete_render.stdout)
            self.assertTrue(complete_stats["ok"])
            self.assertEqual(complete_stats["replaced"], 1)
            self.assertEqual(complete_stats["overflow"], 0)
            self.assertEqual(complete_stats["failed"], 0)
            self.assertGreaterEqual(complete_stats["min_font"], 6.0)
            self.assertEqual(len(complete_stats["font_sizes"]), 1)
            self.assertEqual(str(complete_stats["font_sizes"][0]["id"]), block_id)


if __name__ == "__main__":
    unittest.main()
