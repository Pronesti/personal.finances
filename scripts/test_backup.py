import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source = self.base / "source"
        self.target = self.base / "target"
        for directory in ("data", "pdfs/.superseded", "pdfs/receipts/.pending", "json", "pdfs/empty"):
            (self.source / directory).mkdir(parents=True)
        self.db = sqlite3.connect(self.source / "data/app.db")
        self.addCleanup(self.db.close)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE statements (id INTEGER PRIMARY KEY, file TEXT);
            CREATE TABLE receipts (id INTEGER PRIMARY KEY, file_path TEXT);
            CREATE TABLE category_rules (position INTEGER PRIMARY KEY, value TEXT);
            INSERT INTO statements VALUES (9, 'statement.pdf');
            INSERT INTO category_rules VALUES (3, 'specific'), (8, 'general');
        """)
        self.receipt = self.source / "pdfs/receipts/hash.pdf"
        self.receipt.write_bytes(b"%PDF-receipt")
        self.db.execute("INSERT INTO receipts VALUES (7, ?)", (str(self.receipt),))
        self.db.commit()  # Keep the connection open so committed pages still live in WAL.
        self.contents = {
            "data/ipc.json": b'{"index":123}',
            "data/mep.json": b'{"rate":456}',
            "data/merchant-categories.json": b'{"rules":[]}',
            "pdfs/statement.pdf": b"%PDF-statement",
            "pdfs/.superseded/old.pdf": b"%PDF-old",
            "json/statement.json": b'{"statement":true}',
            "pdfs/receipts/hash.pdf": b"%PDF-receipt",
            "pdfs/receipts/.pending/pending.pdf": b"%PDF-pending",
            "pdfs/receipts/.pending/pending.rows.txt": b"editable OCR",
            "pdfs/receipts/.pending/pending.meta.json": b'{"scale":2}',
        }
        for name, content in self.contents.items():
            (self.source / name).write_bytes(content)
        self.archive = self.base / "backup.zip"

    def create(self, env=None):
        return backup.create_backup(self.source, self.archive, {} if env is None else env)

    def restore(self, **kwargs):
        return backup.restore_backup(self.archive, self.target, app_stopped=True, environ={}, **kwargs)

    def alter_archive(self, change):
        with zipfile.ZipFile(self.archive) as archive:
            entries = {info.filename: archive.read(info) for info in archive.infolist()}
        manifest = json.loads(entries["manifest.json"])
        change(entries, manifest)
        entries["manifest.json"] = json.dumps(manifest).encode()
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in entries.items():
                archive.writestr(name, content)

    def test_wal_and_complete_portable_round_trip(self):
        self.assertGreater((self.source / "data/app.db-wal").stat().st_size, 0)
        manifest = self.create()
        self.assertNotIn("data/app.db-wal", manifest["files"])
        self.assertNotIn("pdfs/receipts/hash.pdf", manifest["files"])
        backup.verify_backup(self.archive)
        self.restore()
        for name, content in self.contents.items():
            self.assertEqual((self.target / name).read_bytes(), content, name)
        self.assertTrue((self.target / "pdfs/empty").is_dir())
        with sqlite3.connect(self.target / "data/app.db") as restored:
            self.assertEqual(restored.execute("SELECT * FROM statements").fetchall(), [(9, "statement.pdf")])
            self.assertEqual(restored.execute("SELECT * FROM category_rules ORDER BY position").fetchall(), [(3, "specific"), (8, "general")])
            self.assertEqual(restored.execute("SELECT file_path FROM receipts").fetchone()[0], str(self.target / "pdfs/receipts/hash.pdf"))
        self.assertEqual(self.db.execute("SELECT file_path FROM receipts").fetchone()[0], str(self.receipt))

    def test_external_overrides_and_relative_paths(self):
        external = self.base / "external"
        external.mkdir()
        (external / "hash.pdf").write_bytes(self.receipt.read_bytes())
        (external / ".pending").mkdir()
        (external / ".pending/correction.rows.txt").write_text("pending")
        self.db.execute("UPDATE receipts SET file_path = ?", (str(external / "hash.pdf"),))
        self.db.commit()
        pdfs = self.base / "statements"
        pdfs.mkdir()
        (pdfs / "external.pdf").write_bytes(b"%PDF-external")
        extracted = self.base / "extracted"
        extracted.mkdir()
        (extracted / "external.json").write_text("{}")
        self.create({"TARJETAS_RECEIPT_DIR": str(external), "TARJETAS_PDF_DIR": str(pdfs), "TARJETAS_JSON_DIR": str(extracted)})
        backup.restore_backup(self.archive, self.target, app_stopped=True, environ={
            "TARJETAS_RECEIPT_DIR": "../hosted-receipts",
            "TARJETAS_PDF_DIR": "../hosted-pdfs", "TARJETAS_JSON_DIR": "../hosted-json",
        })
        self.assertTrue((self.target / "hosted-pdfs/external.pdf").is_file())
        self.assertTrue((self.target / "hosted-json/external.json").is_file())
        self.assertTrue((self.target / "hosted-receipts/.pending/correction.rows.txt").is_file())
        with sqlite3.connect(self.target / "data/app.db") as db:
            self.assertEqual(db.execute("SELECT file_path FROM receipts").fetchone()[0], str(self.target / "hosted-receipts/hash.pdf"))

    def test_schema_without_receipts_is_supported(self):
        self.db.execute("DROP TABLE receipts")
        self.db.commit()
        self.create()
        self.restore()
        backup.check_database(self.target / "data/app.db")

    def test_stale_receipt_location_is_recovered_only_by_content_hash(self):
        sha = hashlib.sha256(self.receipt.read_bytes()).hexdigest()
        self.receipt.rename(self.receipt.with_name(sha + ".pdf"))
        self.db.execute("ALTER TABLE receipts ADD COLUMN file_sha256 TEXT")
        self.db.execute("UPDATE receipts SET file_path = ?, file_sha256 = ?", ("/old/computer/pdfs/receipts/" + sha + ".pdf", sha))
        self.db.commit()
        self.create()
        self.restore()
        restored = self.target / "pdfs/receipts" / (sha + ".pdf")
        self.assertTrue(restored.is_file())
        with sqlite3.connect(self.target / "data/app.db") as db:
            self.assertEqual(db.execute("SELECT file_path FROM receipts").fetchone()[0], str(restored))
        self.archive.unlink()
        self.receipt.with_name(sha + ".pdf").write_bytes(b"wrong receipt")
        with self.assertRaises(backup.BackupError):
            self.create()

    def test_missing_receipt_fails_without_leaving_partial_archive(self):
        self.receipt.unlink()
        with self.assertRaises(backup.BackupError):
            self.create()
        self.assertFalse(self.archive.exists())

    def test_backup_never_overwrites_or_recursively_includes_itself(self):
        self.archive.write_bytes(b"existing")
        with self.assertRaises(FileExistsError):
            self.create()
        self.assertEqual(self.archive.read_bytes(), b"existing")
        with self.assertRaises(backup.BackupError):
            backup.create_backup(self.source, self.source / "data/backup.zip", {})

    def test_links_are_rejected_instead_of_silently_omitting_data(self):
        (self.source / "pdfs/link.pdf").symlink_to(self.receipt)
        with self.assertRaises(backup.BackupError):
            self.create()

    def test_tampered_or_missing_file_leaves_destination_intact(self):
        self.create()
        self.target.mkdir()
        (self.target / "data").mkdir()
        marker = self.target / "data/keep.txt"
        marker.write_text("existing")
        self.alter_archive(lambda entries, manifest: entries.__setitem__("data/ipc.json", b"tampered data"))
        with self.assertRaises(backup.BackupError):
            self.restore(replace=True)
        self.assertEqual(marker.read_text(), "existing")
        self.alter_archive(lambda entries, manifest: entries.pop("data/mep.json"))
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)

    def test_zip_traversal_manifest_path_and_unlisted_entries_are_rejected(self):
        self.create()
        self.alter_archive(lambda entries, manifest: entries.__setitem__("../escape", b"no"))
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)
        self.assertFalse((self.base / "escape").exists())
        self.archive.unlink()
        self.create()

        def traversal(entries, manifest):
            entries["data/../../escape"] = b"no"
            manifest["files"]["data/../../escape"] = {"size": 2, "sha256": hashlib.sha256(b"no").hexdigest()}

        self.alter_archive(traversal)
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)

    def test_unsupported_version_and_incomplete_path_map_are_rejected(self):
        self.create()
        self.alter_archive(lambda entries, manifest: manifest.__setitem__("version", 999))
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)
        self.archive.unlink()
        self.create()
        self.alter_archive(lambda entries, manifest: manifest.__setitem__("receipt_paths", {}))
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)

    def test_requires_stopped_app_and_explicit_replace_preserves_old_data(self):
        self.create()
        with self.assertRaises(backup.BackupError):
            backup.restore_backup(self.archive, self.target, environ={})
        (self.target / "data").mkdir(parents=True)
        (self.target / "data/keep.txt").write_text("original")
        with self.assertRaises(backup.BackupError):
            self.restore()
        previous = self.restore(replace=True)
        self.assertEqual(len(previous), 1)
        self.assertEqual((Path(previous[0]) / "keep.txt").read_text(), "original")

    def test_install_failure_rolls_back_all_preexisting_trees(self):
        self.create()
        for name in ("data", "pdfs", "json"):
            (self.target / name).mkdir(parents=True)
            (self.target / name / "keep.txt").write_text(name)
        original_replace = backup.os.replace

        def fail_pdf_install(source, target):
            if Path(source).name.startswith(".tarjetas-incoming-") and Path(target) == self.target / "pdfs":
                raise OSError("simulated disk error")
            return original_replace(source, target)

        with patch.object(backup.os, "replace", side_effect=fail_pdf_install):
            with self.assertRaises(OSError):
                self.restore(replace=True)
        for name in ("data", "pdfs", "json"):
            self.assertEqual((self.target / name / "keep.txt").read_text(), name)
        self.assertFalse(list(self.target.glob(".tarjetas-*")))


if __name__ == "__main__":
    unittest.main()
