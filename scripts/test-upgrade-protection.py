"""Negative tests for package reinstall/manifest/source-only overwrite detection."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-cursor-compaction.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class ProtectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.metadata = {"name": "pi-cursor-sdk", "version": "0.3.6", "pi": {"extensions": ["./dist/index.js"]}}
        self.write_metadata()
        self.files = {}
        for name in ["src/fix.ts", "dist/fix.js"]:
            p = self.root / name
            p.parent.mkdir(exist_ok=True)
            p.write_text("fixed\n")
            self.files[name] = {"after": checker.digest(p), "before": "unpatched"}
        (self.root / "dist/index.js").write_text("entry")
        self.manifest = {"0.3.6": {"entry": "dist/index.js", "files": self.files}}

    def write_metadata(self):
        (self.root / "package.json").write_text(json.dumps(self.metadata))

    def test_fixed_passes(self):
        self.assertEqual(checker.check_package(self.root, self.manifest), "0.3.6")

    def test_source_only_fix_fails(self):
        (self.root / "dist/fix.js").write_text("reinstalled original")
        with self.assertRaisesRegex(ValueError, "dist/fix.js"):
            checker.check_package(self.root, self.manifest)

    def test_reinstalled_source_fails(self):
        (self.root / "src/fix.ts").write_text("reinstalled original")
        with self.assertRaisesRegex(ValueError, "src/fix.ts"):
            checker.check_package(self.root, self.manifest)

    def test_unknown_version_fails(self):
        self.metadata["version"] = "0.4.0"
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "Unreviewed"):
            checker.check_package(self.root, self.manifest)

    def test_changed_entry_fails(self):
        self.metadata["pi"]["extensions"] = ["src/index.ts"]
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, "loader entry"):
            checker.check_package(self.root, self.manifest)

    def test_missing_entry_fails(self):
        (self.root / "dist/index.js").unlink()
        with self.assertRaisesRegex(ValueError, "Missing loader"):
            checker.check_package(self.root, self.manifest)

    def test_fixed_cannot_be_patched_as_baseline(self):
        with self.assertRaisesRegex(ValueError, "before state"):
            checker.check_package(self.root, self.manifest, "before")

    def test_modified_recovery_asset_fails(self):
        (self.root / "fix.patch").write_text("patch")
        manifest = {"test": {"assets": {"fix.patch": checker.digest(self.root / "fix.patch")}}}
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        checker.check_assets(self.root)
        (self.root / "fix.patch").write_text("lost fix")
        with self.assertRaisesRegex(ValueError, "Recovery asset changed"):
            checker.check_assets(self.root)


if __name__ == "__main__":
    unittest.main()
