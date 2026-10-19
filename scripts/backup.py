#!/usr/bin/env python3
"""Portable Tarjetas data backups. Requires only Python 3.9+ standard library."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import sys
import tempfile
import uuid
import zipfile
from contextlib import closing
from datetime import datetime, timezone

FORMAT = "tarjetas-backup"
VERSION = 1
GROUPS = ("data", "pdfs", "json", "receipts")
MAX_BYTES = 20 * 1024**3
MAX_ENTRIES = 100_000
MAX_MANIFEST = 32 * 1024**2
REPO = Path(__file__).resolve().parent.parent


class BackupError(Exception):
    pass


def roots_for(repo, environ=None):
    repo = Path(repo).resolve()
    env = os.environ if environ is None else environ

    def configured(key, default):
        value = Path(env.get(key, str(default)))
        # The application runs from web/, including when its overrides are relative.
        return (value if value.is_absolute() else repo / "web" / value).resolve()

    roots = {
        "data": repo / "data",
        "pdfs": configured("TARJETAS_PDF_DIR", repo / "pdfs"),
        "json": configured("TARJETAS_JSON_DIR", repo / "json"),
        "receipts": configured("TARJETAS_RECEIPT_DIR", repo / "pdfs" / "receipts"),
    }
    for name, root in roots.items():
        if root == repo or root in repo.parents or root == repo / "web":
            raise BackupError(f"Unsafe {name} directory: {root}")
        for other_name, other in roots.items():
            if name == other_name:
                continue
            if root == other:
                raise BackupError("Data directories must be distinct")
            if other in root.parents and (name, other_name) != ("receipts", "pdfs"):
                raise BackupError("Only the receipt directory may be nested inside the PDF directory")
    return roots


def digest(file):
    result = hashlib.sha256()
    with open(file, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def connect_readonly(file):
    return sqlite3.connect(Path(file).resolve().as_uri() + "?mode=ro", uri=True)


def check_database(file):
    with closing(connect_readonly(file)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise BackupError("Database integrity check failed")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("Database contains broken foreign-key references")


def receipt_records(db_file):
    with closing(connect_readonly(db_file)) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(receipts)")}
        if "file_path" not in columns:
            return {}
        hash_column = "file_sha256" if "file_sha256" in columns else "NULL"
        return dict(db.execute(f"SELECT file_path, {hash_column} FROM receipts"))


def copy_tree(source, target, exclude=()):
    """Copy regular files and empty directories; never silently follow links."""
    target.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        return
    if not source.is_dir():
        raise BackupError(f"Expected a directory: {source}")
    for entry in sorted(source.iterdir()):
        if entry in exclude:
            continue
        if entry.is_symlink():
            raise BackupError(f"Symlink cannot be backed up: {entry}")
        if entry.is_dir():
            copy_tree(entry, target / entry.name, exclude)
        elif entry.is_file():
            shutil.copyfile(entry, target / entry.name)
        else:
            raise BackupError(f"Unsupported special file: {entry}")


def create_backup(repo, destination, environ=None):
    roots = roots_for(repo, environ)
    destination = Path(destination).resolve()
    if any(destination == root or root in destination.parents for root in roots.values()):
        raise BackupError("Store the backup outside the data/document directories")
    db_file = roots["data"] / "app.db"
    if not db_file.is_file() or db_file.is_symlink():
        raise BackupError("No regular data/app.db found; refusing an empty backup")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the output exclusively, never overwrite an earlier backup.
    with destination.open("xb"):
        pass
    destination.chmod(0o600)
    try:
        with tempfile.TemporaryDirectory(prefix="tarjetas-backup-") as temporary:
            stage = Path(temporary)
            (stage / "data").mkdir()
            # SQLite's backup API includes committed WAL data and does not migrate the schema.
            with closing(connect_readonly(db_file)) as source, closing(sqlite3.connect(stage / "data/app.db")) as snapshot:
                source.backup(snapshot)
                snapshot.execute("PRAGMA journal_mode=DELETE")
            check_database(stage / "data/app.db")
            excluded = tuple(roots["data"] / f"app.db{suffix}" for suffix in ("", "-wal", "-shm", "-journal"))
            copy_tree(roots["data"], stage / "data", excluded)
            copy_tree(roots["pdfs"], stage / "pdfs", (roots["receipts"],))
            copy_tree(roots["json"], stage / "json")
            copy_tree(roots["receipts"], stage / "receipts")
            mappings = {}
            for original, expected_hash in receipt_records(stage / "data/app.db").items():
                source_path = Path(original)
                if not source_path.is_absolute():
                    source_path = Path(repo).resolve() / "web" / source_path
                source_path = source_path.resolve()
                try:
                    relative = source_path.relative_to(roots["receipts"])
                except ValueError as error:
                    # A moved checkout may retain absolute paths from the old computer/folder.
                    # Only the content identity in the DB can establish the replacement PDF.
                    if not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(c not in "0123456789abcdef" for c in expected_hash):
                        raise BackupError("A receipt path is outside the configured receipt directory and has no valid content hash") from error
                    relative = Path(expected_hash + ".pdf")
                portable = "receipts/" + relative.as_posix()
                if not (stage / portable).is_file():
                    raise BackupError("A database receipt references a missing PDF")
                if expected_hash is not None and digest(stage / portable) != expected_hash:
                    raise BackupError("Receipt PDF does not match its database content hash")
                mappings[original] = portable
            files = {}
            directories = []
            for file in sorted(stage.rglob("*")):
                name = file.relative_to(stage).as_posix()
                if file.is_dir():
                    directories.append(name)
                else:
                    files[name] = {"size": file.stat().st_size, "sha256": digest(file)}
            if sum(info["size"] for info in files.values()) > MAX_BYTES or len(files) + len(directories) > MAX_ENTRIES:
                raise BackupError("Backup exceeds the supported 20 GiB / 100,000 entry limit")
            manifest = {"format": FORMAT, "version": VERSION,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "files": files, "directories": directories, "receipt_paths": mappings}
            manifest_json = json.dumps(manifest, indent=2).encode()
            if len(manifest_json) > MAX_MANIFEST:
                raise BackupError("Backup manifest exceeds the supported size limit")
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, strict_timestamps=False) as archive:
                archive.writestr("manifest.json", manifest_json)
                for directory in directories:
                    archive.writestr(directory + "/", b"")
                for name in files:
                    archive.write(stage / name, name)
            verify_backup(destination)
            return manifest
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def safe_name(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name or ":" in name:
        raise BackupError("Unsafe archive path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
        raise BackupError("Unsafe archive path")
    if path.parts[0] not in GROUPS:
        raise BackupError("Unexpected archive directory")
    return path


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError("Duplicate manifest key")
        result[key] = value
    return result


def extract_verified(archive_file, stage):
    """Extract only after checking the manifest and each explicitly listed member."""
    with zipfile.ZipFile(archive_file) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > MAX_ENTRIES + 1 or len(names) != len(set(names)):
            raise BackupError("Too many or duplicate archive entries")
        if "manifest.json" not in names or archive.getinfo("manifest.json").file_size > MAX_MANIFEST:
            raise BackupError("Missing or oversized manifest")
        manifest = json.loads(archive.read("manifest.json"), object_pairs_hook=no_duplicate_keys)
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or type(manifest.get("version")) is not int or manifest["version"] != VERSION:
            raise BackupError("Unsupported backup format/version")
        files, directories, mappings = (manifest.get(key) for key in ("files", "directories", "receipt_paths"))
        if not isinstance(files, dict) or not isinstance(directories, list) or not isinstance(mappings, dict):
            raise BackupError("Invalid manifest structure")
        if any(not isinstance(name, str) for name in directories):
            raise BackupError("Invalid directory list")
        if len(set(directories)) != len(directories) or not set(GROUPS).issubset(directories):
            raise BackupError("Invalid directory list")
        expected = {"manifest.json"} | set(files) | {name + "/" for name in directories}
        if set(names) != expected or "data/app.db" not in files:
            raise BackupError("Archive contents do not match manifest")
        for name in list(files) + directories:
            parsed = safe_name(name)
            if name in files and (len(parsed.parts) == 1 or name in directories):
                raise BackupError("Invalid file path")
            if any(parent.as_posix() in files for parent in parsed.parents):
                raise BackupError("File/directory path collision")
        if any(name in files for name in ("data/app.db-wal", "data/app.db-shm", "data/app.db-journal")):
            raise BackupError("Backup must contain a standalone database snapshot")
        total = 0
        for entry in entries:
            mode = entry.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                raise BackupError("Links, special files, and encrypted entries are unsupported")
            if entry.filename == "manifest.json":
                continue
            if entry.is_dir():
                if entry.file_size:
                    raise BackupError("Directory entry contains data")
                (stage / entry.filename).mkdir(parents=True, exist_ok=True)
                continue
            info = files[entry.filename]
            if not isinstance(info, dict) or type(info.get("size")) is not int or info["size"] < 0 or not isinstance(info.get("sha256"), str):
                raise BackupError("Invalid file metadata")
            total += entry.file_size
            if entry.file_size != info["size"] or total > MAX_BYTES:
                raise BackupError("Invalid file size or backup exceeds 20 GiB")
            target = stage / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            sha = hashlib.sha256()
            written = 0
            with archive.open(entry) as source, target.open("xb") as output:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > info["size"]:
                        raise BackupError("Decompressed file exceeds declared size")
                    sha.update(chunk)
                    output.write(chunk)
            if written != info["size"] or sha.hexdigest() != info["sha256"]:
                raise BackupError("File checksum mismatch")
        records = receipt_records(stage / "data/app.db")
        if set(records) != set(mappings):
            raise BackupError("Receipt path mapping does not match database")
        for original, portable in mappings.items():
            if not isinstance(original, str) or not isinstance(portable, str):
                raise BackupError("Invalid receipt path mapping")
            parsed = safe_name(portable)
            if parsed.parts[0] != "receipts" or portable not in files:
                raise BackupError("Receipt PDF missing from backup")
            if records[original] is not None and files[portable]["sha256"] != records[original]:
                raise BackupError("Receipt PDF does not match its database content hash")
        check_database(stage / "data/app.db")
        return manifest


def verify_backup(archive_file):
    with tempfile.TemporaryDirectory(prefix="tarjetas-verify-") as temporary:
        return extract_verified(archive_file, Path(temporary))


def restore_backup(archive_file, repo, *, replace=False, app_stopped=False, environ=None):
    if not app_stopped:
        raise BackupError("Stop the destination app and pass --app-stopped before restoring")
    roots = roots_for(repo, environ)
    with tempfile.TemporaryDirectory(prefix="tarjetas-restore-") as temporary:
        stage = Path(temporary)
        manifest = extract_verified(archive_file, stage)
        if manifest["receipt_paths"]:
            with closing(sqlite3.connect(stage / "data/app.db")) as db, db:
                # A single update avoids cascading substitutions between old/new paths.
                db.execute("CREATE TEMP TABLE restore_paths (old TEXT PRIMARY KEY, new TEXT NOT NULL)")
                db.executemany("INSERT INTO restore_paths VALUES (?, ?)", [
                    (old, str(roots["receipts"] / Path(portable).relative_to("receipts")))
                    for old, portable in manifest["receipt_paths"].items()
                ])
                db.execute("UPDATE receipts SET file_path = (SELECT new FROM restore_paths WHERE old = receipts.file_path)")
            check_database(stage / "data/app.db")
        groups = list(GROUPS)
        if roots["pdfs"] in roots["receipts"].parents:
            relative = roots["receipts"].relative_to(roots["pdfs"])
            combined = stage / "pdfs" / relative
            if combined.exists():
                raise BackupError("Receipt and PDF restore paths collide")
            combined.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(stage / "receipts"), combined)
            groups.remove("receipts")
        for group in groups:
            target = roots[group]
            if target.is_symlink() or (target.exists() and not target.is_dir()):
                raise BackupError(f"Restore destination is not a regular directory: {target}")
            if target.exists() and any(target.iterdir()) and not replace:
                raise BackupError("Destination already has data; use --replace to retain it and replace")
        # Each incoming tree is staged beside its destination so the renames stay on one disk.
        staged, old, installed = {}, {}, []
        token = uuid.uuid4().hex
        try:
            for group in groups:
                target = roots[group]
                target.parent.mkdir(parents=True, exist_ok=True)
                incoming = Path(tempfile.mkdtemp(prefix=".tarjetas-incoming-", dir=target.parent))
                staged[group] = incoming
                shutil.copytree(stage / group, incoming, dirs_exist_ok=True)
            for group in groups:
                target = roots[group]
                if target.exists():
                    previous = target.with_name(f".tarjetas-before-restore-{token}-{target.name}")
                    os.replace(target, previous)
                    old[group] = previous
                os.replace(staged[group], target)
                installed.append(group)
        except BaseException:
            # Roll back ordinary installation errors. Retained trees also survive interruption.
            for group in reversed(groups):
                if group in installed:
                    shutil.rmtree(roots[group])
                if group in old:
                    os.replace(old[group], roots[group])
            raise
        finally:
            for incoming in staged.values():
                if incoming.exists():
                    shutil.rmtree(incoming)
        return [str(previous) for previous in old.values()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a complete, portable ZIP backup")
    create.add_argument("destination", nargs="?", type=Path)
    create.add_argument("--root", type=Path, default=REPO, help="Source Tarjetas repository")
    verify = commands.add_parser("verify", help="Check all checksums, mappings and SQLite integrity")
    verify.add_argument("archive", type=Path)
    restore = commands.add_parser("restore", help="Restore to a stopped local/hosted Tarjetas copy")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--root", type=Path, default=REPO, help="Destination Tarjetas repository")
    restore.add_argument("--app-stopped", action="store_true", help="Confirm destination app and ingestion jobs are stopped")
    restore.add_argument("--replace", action="store_true", help="Retain existing data directories before replacement")
    args = parser.parse_args()
    try:
        if args.command == "create":
            destination = args.destination or args.root / "backups" / f"tarjetas-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}.zip"
            manifest = create_backup(args.root, destination)
            print(f"Backup created and verified: {destination.resolve()}")
            print(f"{len(manifest['files'])} files; {sum(info['size'] for info in manifest['files'].values())} uncompressed bytes")
        elif args.command == "verify":
            manifest = verify_backup(args.archive)
            print(f"Verified: {len(manifest['files'])} files, all checksums and database integrity OK")
        else:
            previous = restore_backup(args.archive, args.root, replace=args.replace, app_stopped=args.app_stopped)
            print(f"Restored to: {args.root.resolve()}")
            for directory in previous:
                print(f"Previous data retained: {directory}")
    except (BackupError, OSError, sqlite3.Error, zipfile.BadZipFile, ValueError, RuntimeError) as error:
        print(f"Backup error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
