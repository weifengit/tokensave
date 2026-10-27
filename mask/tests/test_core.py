"""核心链路测试（不依赖 GLiNER / torch）。

运行：
    cd mask && python -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from docmask.audit import audit_masked_text  # noqa: E402
from docmask.config import ConfigLoader  # noqa: E402
from docmask.crypto import load_sealed, save_sealed, seal, unseal  # noqa: E402
from docmask.detection.regex_detector import RegexDetector, luhn_ok  # noqa: E402
from docmask.models import Detection  # noqa: E402
from docmask.pipeline import Masker, apply_terms  # noqa: E402
from docmask.placeholder import format_placeholder, normalize_type, parse_placeholder  # noqa: E402
from docmask.session import MaskSession, SessionRegistry, normalize_key  # noqa: E402

BASE_CONFIG: dict = {
    "version": 1,
    "runtime": {
        "enabled": True,
        "regex": True,
        "glossary": True,
        "gliner": False,
        "cache": False,
        "audit": True,
        "hot_reload": True,
        "gliner_threshold": 0.4,
    },
    "detectors": {
        "regex": {"enabled": True, "rules": {}, "custom_rules": []},
        "gliner": {"enabled": True, "model": "urchade/gliner_small-v2.1"},
        "glossary": {"enabled": True, "path": "", "case_sensitive": False},
    },
    "types": {"map": {"person": "PER", "organization": "ORG", "location": "LOC"}, "custom": [], "ignore": ["DeepSeek"]},
    "cache": {"enabled": False},
    "audit": {"enabled": True},
    "session": {"persist_dir": "", "auto_persist": False},
    "ui_overrides": {"enabled": False},
}


def write_config(directory: Path, runtime: dict | None = None) -> Path:
    config = json.loads(json.dumps(BASE_CONFIG))
    config["runtime"].update(runtime or {})
    path = directory / "docmask.json"
    path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")
    return path


class FakeDetector:
    """把「模型识别」替换成查表，测试才能离线且确定。"""

    name = "fake"

    def __init__(self, mapping: dict[str, str]):
        self.mapping = mapping

    def detect(self, text: str, config, session=None) -> list[Detection]:
        found: list[Detection] = []
        for term, entity_type in self.mapping.items():
            start = text.find(term)
            while start >= 0:
                found.append(Detection(start, start + len(term), term, entity_type, "fake"))
                start = text.find(term, start + len(term))
        return found


class PlaceholderTest(unittest.TestCase):
    def test_format_and_parse(self):
        self.assertEqual(format_placeholder("per", 1), "<<PER_1>>")
        self.assertEqual(parse_placeholder("<<PROJECT_12>>"), ("PROJECT", 12))
        self.assertIsNone(parse_placeholder("<<bad>>"))
        self.assertEqual(normalize_type("internal-code"), "INTERNAL_CODE")

    def test_normalize_key(self):
        self.assertEqual(normalize_key("  Ａcme   Inc. "), normalize_key("acme inc."))


class SessionTest(unittest.TestCase):
    def test_same_entity_gets_stable_placeholder(self):
        session = MaskSession("s1")
        first, reused = session.assign("PER", "张三", "fake")
        second, reused_again = session.assign("PER", "张三", "fake")
        third, _ = session.assign("PER", "李四", "fake")
        self.assertEqual(first, "<<PER_1>>")
        self.assertEqual(first, second)
        self.assertFalse(reused)
        self.assertTrue(reused_again)
        self.assertEqual(third, "<<PER_2>>")

    def test_sessions_are_isolated(self):
        first = MaskSession("a")
        second = MaskSession("b")
        first.assign("PER", "张三", "fake")
        second.assign("PER", "李四", "fake")
        self.assertEqual(first.original_of("<<PER_1>>"), "张三")
        self.assertEqual(second.original_of("<<PER_1>>"), "李四")
        self.assertIsNone(first.original_of("<<PER_9>>"))

    def test_clear_restarts_ids(self):
        session = MaskSession("s")
        session.assign("PER", "张三", "fake")
        session.clear()
        placeholder, _ = session.assign("PER", "李四", "fake")
        self.assertEqual(placeholder, "<<PER_1>>")

    def test_roundtrip_dict(self):
        session = MaskSession("s")
        session.assign("PER", "张三", "fake")
        session.assign("ORG", "某某银行", "fake")
        restored = MaskSession.from_dict(session.to_dict())
        self.assertEqual(restored.original_of("<<PER_1>>"), "张三")
        self.assertEqual(restored.original_of("<<ORG_1>>"), "某某银行")

    def test_registry_new_is_unique(self):
        registry = SessionRegistry()
        session = registry.new()
        with self.assertRaises(ValueError):
            registry.new(session.session_id)
        self.assertEqual(len(registry.ids()), 1)


class RegexTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.loader = ConfigLoader(write_config(Path(self.tmp.name)))
        self.config = self.loader.load(force=True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_structured_rules(self):
        text = "手机 13800138000，身份证 11010519491231002X，邮箱 a.b@example.com，IP 10.20.30.40"
        found = {item.entity_type for item in RegexDetector().detect(text, self.config)}
        self.assertTrue({"PHONE", "ID_CARD", "EMAIL", "IP"} <= found)

    def test_api_key_and_secret(self):
        text = "key sk-abcdef0123456789abcdef，password=hunter2hunter2"
        types = {item.entity_type for item in RegexDetector().detect(text, self.config)}
        self.assertIn("API_KEY", types)
        self.assertIn("SECRET", types)

    def test_luhn_filters_noise(self):
        self.assertTrue(luhn_ok("4111111111111111"))
        self.assertFalse(luhn_ok("4111111111111112"))
        text = "卡号 4111111111111111"
        found = [item for item in RegexDetector().detect(text, self.config) if item.entity_type == "BANK_CARD"]
        self.assertEqual(len(found), 1)


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.loader = ConfigLoader(write_config(Path(self.tmp.name)))
        self.masker = Masker(self.loader, extra_detectors=[FakeDetector({"张三": "PER", "李四": "PER"})])
        self.session = MaskSession("chat-1")

    def tearDown(self):
        self.tmp.cleanup()

    def test_mask_and_unmask_roundtrip(self):
        result = self.masker.mask(self.session, "张三的手机是 13800138000")
        self.assertIn("<<PER_1>>", result.text)
        self.assertIn("<<PHONE_1>>", result.text)
        self.assertNotIn("张三", result.text)
        self.assertNotIn("13800138000", result.text)

        restored = self.masker.unmask(self.session, "请联系 <<PER_1>>（<<PHONE_1>>）")
        self.assertEqual(restored.text, "请联系 张三（13800138000）")
        self.assertEqual(restored.restored, 2)

    def test_multiturn_reuses_mapping(self):
        first = self.masker.mask(self.session, "我是张三")
        second = self.masker.mask(self.session, "张三又来了")
        self.assertEqual(first.hits[0].placeholder, second.hits[0].placeholder)
        self.assertFalse(first.hits[0].reused)
        self.assertTrue(second.hits[0].reused)
        self.assertEqual(second.text, "<<PER_1>>又来了")

    def test_new_entity_adds_id_and_old_one_still_masked(self):
        self.masker.mask(self.session, "张三")
        result = self.masker.mask(self.session, "张三和李四")
        placeholders = [hit.placeholder for hit in result.hits]
        self.assertIn("<<PER_1>>", placeholders)
        self.assertIn("<<PER_2>>", placeholders)

    def test_unknown_placeholder_kept(self):
        result = self.masker.unmask(self.session, "关于 <<PER_7>> 的事")
        self.assertEqual(result.unknown, ["<<PER_7>>"])
        self.assertIn("<<PER_7>>", result.text)

    def test_total_switch_off_returns_original(self):
        loader = ConfigLoader(write_config(Path(self.tmp.name), {"enabled": False}))
        masker = Masker(loader, extra_detectors=[FakeDetector({"张三": "PER"})])
        result = masker.mask(MaskSession("off"), "张三")
        self.assertEqual(result.text, "张三")
        self.assertTrue(result.warnings)

    def test_apply_terms_prefers_longest(self):
        session = MaskSession("s")
        session.assign("PROJECT", "天枢计划", "glossary")
        session.assign("PROJECT", "天枢", "glossary")
        masked, used = apply_terms("天枢计划 与 天枢", session.entities())
        self.assertEqual(masked, "<<PROJECT_1>> 与 <<PROJECT_2>>")
        self.assertEqual(len(used), 2)

    def test_ignore_list_keeps_public_brand(self):
        loader = ConfigLoader(write_config(Path(self.tmp.name)))
        masker = Masker(loader, extra_detectors=[FakeDetector({"DeepSeek": "ORG", "张三": "PER"})])
        result = masker.mask(MaskSession("s"), "张三在用 DeepSeek")
        self.assertIn("DeepSeek", result.text)
        self.assertNotIn("张三", result.text)


class AuditTest(unittest.TestCase):
    def test_residual_plaintext_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = ConfigLoader(write_config(Path(tmp))).load(force=True)
            session = MaskSession("s")
            session.assign("PER", "张三", "fake")
            warnings = audit_masked_text("张三 的电话 13800138000", config, session)
            self.assertTrue(any("漏检" in item for item in warnings))

    def test_clean_text_has_no_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = ConfigLoader(write_config(Path(tmp))).load(force=True)
            session = MaskSession("s")
            session.assign("PER", "张三", "fake")
            warnings = audit_masked_text("请联系 <<PER_1>>", config, session)
            self.assertEqual(warnings, [])


class ConfigTest(unittest.TestCase):
    def test_runtime_overlay_and_hot_reload(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = write_config(Path(tmp))
            overlay = Path(tmp) / "runtime.json"
            overlay.write_text(json.dumps({"runtime": {"gliner": True, "gliner_threshold": 0.6}}), encoding="utf-8")
            loader = ConfigLoader(base, ui_overrides_path=overlay)
            config = loader.load(force=True)
            self.assertTrue(config.detector_enabled("gliner"))
            self.assertAlmostEqual(config.gliner_settings()["threshold"], 0.6)
            self.assertTrue(config.enabled)

            time.sleep(0.02)
            overlay.write_text(json.dumps({"runtime": {"gliner": False}}), encoding="utf-8")
            os.utime(overlay, (time.time() + 5, time.time() + 5))
            reloaded = loader.load()
            self.assertFalse(reloaded.detector_enabled("gliner"))
            self.assertGreater(reloaded.generation, config.generation)


class CryptoTest(unittest.TestCase):
    def test_seal_roundtrip_and_wrong_password(self):
        payload = {"session_id": "s", "entities": [{"placeholder": "<<PER_1>>"}]}
        blob = seal(payload, "pw", iterations=1000)
        self.assertEqual(unseal(blob, "pw"), payload)
        with self.assertRaises(ValueError):
            unseal(blob, "bad")

    def test_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "m.enc"
            save_sealed(path, {"a": 1}, "pw")
            self.assertEqual(load_sealed(path, "pw"), {"a": 1})
            self.assertNotIn(b'"a"', path.read_bytes())


class DocumentMaskerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.loader = ConfigLoader(write_config(self.dir))
        self.masker = Masker(self.loader, extra_detectors=[FakeDetector({"张三": "PER"})])
        self.session = MaskSession("doc-1")

    def tearDown(self):
        self.tmp.cleanup()

    def test_text_file(self):
        from docmask.documents.service import DocumentMasker

        source = self.dir / "note.md"
        source.write_text("负责人 张三，电话 13800138000", encoding="utf-8")
        output = self.dir / "note.masked.md"
        result = DocumentMasker(self.masker).mask_file(self.session, source, output)
        self.assertEqual(result.unit_count, 1)
        self.assertIn("<<PER_1>>", output.read_text(encoding="utf-8"))
        self.assertNotIn("张三", output.read_text(encoding="utf-8"))

    @unittest.skipUnless(__import__("importlib").util.find_spec("docx"), "需要 python-docx")
    def test_docx_roundtrip(self):
        import docx

        from docmask.documents.service import DocumentMasker

        source = self.dir / "report.docx"
        document = docx.Document()
        document.add_paragraph("负责人 张三")
        document.add_paragraph("电话 13800138000")
        document.save(str(source))

        output = self.dir / "report.masked.docx"
        DocumentMasker(self.masker).mask_file(self.session, source, output)

        masked = docx.Document(str(output))
        text = "\n".join(paragraph.text for paragraph in masked.paragraphs)
        self.assertIn("<<PER_1>>", text)
        self.assertNotIn("张三", text)
        self.assertIn("<<PHONE_1>>", text)

    @unittest.skipUnless(__import__("importlib").util.find_spec("openpyxl"), "需要 openpyxl")
    def test_xlsx_roundtrip(self):
        import openpyxl

        from docmask.documents.service import DocumentMasker

        source = self.dir / "sheet.xlsx"
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet["A1"] = "客户姓名"
        sheet["B1"] = "张三"
        sheet["B2"] = 13800138000
        workbook.save(str(source))

        output = self.dir / "sheet.masked.xlsx"
        DocumentMasker(self.masker).mask_file(self.session, source, output)

        reopened = openpyxl.load_workbook(str(output))
        self.assertEqual(reopened.active["B1"].value, "<<PER_1>>")
        # 数字单元格不参与脱敏（避免把表格算坏）
        self.assertEqual(reopened.active["B2"].value, 13800138000)

    @unittest.skipUnless(__import__("importlib").util.find_spec("pptx"), "需要 python-pptx")
    def test_pptx_roundtrip(self):
        from pptx import Presentation
        from pptx.util import Inches

        from docmask.documents.service import DocumentMasker

        source = self.dir / "deck.pptx"
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        textbox = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
        textbox.text_frame.text = "汇报人 张三"
        presentation.save(str(source))

        output = self.dir / "deck.masked.pptx"
        DocumentMasker(self.masker).mask_file(self.session, source, output)

        reopened = Presentation(str(output))
        texts = [shape.text_frame.text for shape in reopened.slides[0].shapes if shape.has_text_frame]
        self.assertTrue(any("<<PER_1>>" in text for text in texts))

    def test_unsupported_suffix(self):
        from docmask.documents import UnsupportedDocument, adapter_for

        with self.assertRaises(UnsupportedDocument):
            adapter_for("scan.pdf")


if __name__ == "__main__":
    unittest.main(verbosity=2)
