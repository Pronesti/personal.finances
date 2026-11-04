#!/usr/bin/env python3
"""Portable PostgreSQL and private file backup. Never selects a live target implicitly."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
import backup as legacy

BackupError = legacy.BackupError
FORMAT = 'tarjetas-accounting-backup'
VERSION = 1
MAX_BYTES = legacy.MAX_BYTES
MAX_ENTRIES = legacy.MAX_ENTRIES
MAX_MANIFEST = legacy.MAX_MANIFEST
# The application owns this read-only view; absence fails closed rather than omitting evidence.
METADATA_SQL = 'SELECT metadata::text FROM accounting.accounting_backup_metadata'
EMPTY_SQL = """SELECT count(*) FROM (
 SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 UNION ALL SELECT oid FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema')
 AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'
) AS user_objects"""


def connection_env(values):
    allowed = {'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGSSLROOTCERT', 'PGPASSFILE', 'PGCONNECT_TIMEOUT'}
    if not isinstance(values, dict) or set(values) - allowed or not values.get('PGDATABASE'):
        raise BackupError('Explicit validated PG connection fields are required')
    if any(not isinstance(v, str) or '\x00' in v or '\n' in v for v in values.values()):
        raise BackupError('Invalid PG connection fields')
    if values['PGDATABASE'].startswith(('postgres:', 'postgresql:')) or '=' in values['PGDATABASE']:
        raise BackupError('PGDATABASE must be a database name, not a connection string')
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env.update(values)
    env.setdefault('PGCONNECT_TIMEOUT', '10')
    return env


def run(command, env):
    try:
        result = subprocess.run(command, env=env, capture_output=True, text=True, check=False, timeout=3600)
    except (OSError, subprocess.SubprocessError):
        raise BackupError('PostgreSQL process could not complete') from None
    if result.returncode:
        # Client diagnostics may include passwords/DSNs. Never propagate them.
        raise BackupError('PostgreSQL process failed; candidate target is incomplete')
    return result.stdout.strip()


def query(sql, env):
    return run(['psql', '-X', '--no-password', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], env)


def safe_name(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name:
        raise BackupError('Unsafe archive path')
    path = PurePosixPath(name)
    if path.is_absolute() or any(p in ('', '.', '..') for p in name.split('/')):
        raise BackupError('Unsafe archive path')
    if name != 'database.dump' and (len(path.parts) < 2 or path.parts[0] not in ('objects', 'pending', 'references')):
        raise BackupError('Unexpected archive path')
    return path


def extract_verified(archive, stage):
    try:
        with zipfile.ZipFile(archive) as source:
            entries = source.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > MAX_ENTRIES + 1 or len(set(names)) != len(names):
                raise BackupError('Duplicate or excessive archive entries')
            if 'manifest.json' not in names or source.getinfo('manifest.json').file_size > MAX_MANIFEST:
                raise BackupError('Missing or oversized manifest')
            manifest = json.loads(source.read('manifest.json'), object_pairs_hook=legacy.no_duplicate_keys)
            if not isinstance(manifest, dict) or manifest.get('format') != FORMAT or type(manifest.get('version')) is not int or manifest['version'] != VERSION:
                raise BackupError('Unsupported backup format/version')
            files = manifest.get('files')
            database = manifest.get('database')
            refs = manifest.get('source_references')
            if (not isinstance(files, dict) or not isinstance(database, dict) or database.get('path') != 'database.dump'
                or type(database.get('server_major')) is not int or database['server_major'] < 10
                or not isinstance(manifest.get('app_revision'), str) or not manifest['app_revision']
                or type(manifest.get('schema_version')) is not int or manifest['schema_version'] < 1
                or not isinstance(refs, list) or any(not isinstance(r, str) for r in refs)):
                raise BackupError('Invalid manifest metadata')
            if 'manifest.json' in files or set(names) != set(files) | {'manifest.json'} or 'database.dump' not in files:
                raise BackupError('Archive contents do not match manifest')
            if len(refs) != len(set(refs)) or any(not r.startswith('objects/') or r not in files for r in refs):
                raise BackupError('Missing required source object reference')
            total = 0
            for entry in entries:
                mode = entry.external_attr >> 16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)) or entry.is_dir():
                    raise BackupError('Non-regular archive entry')
                if entry.filename == 'manifest.json':
                    continue
                safe_name(entry.filename)
                info = files[entry.filename]
                if not isinstance(info, dict) or type(info.get('size')) is not int or info['size'] < 0 or not isinstance(info.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', info['sha256']):
                    raise BackupError('Invalid file metadata')
                total += info['size']
                if entry.file_size != info['size'] or total > MAX_BYTES:
                    raise BackupError('Invalid file size or archive exceeds limit')
                target = stage / entry.filename
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                sha = hashlib.sha256()
                size = 0
                with source.open(entry) as inp, target.open('xb') as out:
                    target.chmod(0o600)
                    while chunk := inp.read(1024 * 1024):
                        size += len(chunk)
                        if size > info['size']:
                            raise BackupError('File exceeds declared size')
                        sha.update(chunk)
                        out.write(chunk)
                if size != info['size'] or sha.hexdigest() != info['sha256']:
                    raise BackupError('File checksum mismatch')
            return manifest
    except (zipfile.BadZipFile, json.JSONDecodeError, UnicodeError, EOFError):
        raise BackupError('Malformed backup archive') from None


def check_archive_hash(archive, expected_sha256):
    if expected_sha256 is not None:
        if not re.fullmatch('[0-9a-f]{64}', expected_sha256) or legacy.digest(Path(archive)) != expected_sha256:
            raise BackupError('Archive SHA-256 mismatch')


def verify_backup(archive, *, expected_sha256=None):
    check_archive_hash(archive, expected_sha256)
    with tempfile.TemporaryDirectory(prefix='accounting-verify-') as temp:
        return extract_verified(archive, Path(temp))


def roots(document_root, reference_root):
    paths = [Path(document_root).absolute(), Path(reference_root).absolute()]
    for path in paths:
        if any(p.is_symlink() for p in (path, *path.parents)) or path == Path('/'):
            raise BackupError('Unsafe storage root')
    a, b = paths
    if a == b or a in b.parents or b in a.parents:
        raise BackupError('Storage roots must be separate')
    return a, b


def create_backup(destination, *, document_root, reference_root, database_env, app_stopped):
    if not app_stopped:
        raise BackupError('Stop app/import/reference writers and pass --app-stopped')
    docs, refs = roots(document_root, reference_root)
    if any(not p.is_dir() for p in (docs, refs)):
        raise BackupError('Both source roots must exist')
    if any(p.name not in ('objects', 'pending') for p in docs.iterdir()):
        raise BackupError('Document root contains unsupported files; refusing omission')
    destination = Path(destination).absolute()
    if any(p == destination or p in destination.parents for p in (docs, refs)):
        raise BackupError('Archive must be outside source roots')
    env = connection_env(database_env)
    with tempfile.TemporaryDirectory(prefix='accounting-backup-') as temp:
        stage = Path(temp)
        try:
            metadata = json.loads(query(METADATA_SQL, env))
        except (ValueError, TypeError):
            raise BackupError('Invalid application backup metadata') from None
        for name in ('objects', 'pending'):
            if (docs/name).is_symlink():
                raise BackupError('Symlink cannot be backed up')
            legacy.copy_tree(docs/name, stage/name)
        legacy.copy_tree(refs, stage/'references')
        run(['pg_dump', '--no-password', '--format=custom', '--no-owner', '--file', str(stage/'database.dump')], env)
        if not (stage/'database.dump').is_file():
            raise BackupError('pg_dump produced no dump')
        files = {p.relative_to(stage).as_posix(): {'size': p.stat().st_size, 'sha256': legacy.digest(p)} for p in stage.rglob('*') if p.is_file()}
        if not isinstance(metadata, dict):
            raise BackupError('Invalid application backup metadata')
        manifest = {**metadata, 'format': FORMAT, 'version': VERSION, 'files': files}
        (stage/'manifest.json').write_text(json.dumps(manifest, sort_keys=True))
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with destination.open('xb') as output:
                destination.chmod(0o600)
                with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
                    for name in ['manifest.json', *files]:
                        archive.write(stage/name, name)
        except BaseException:
            # Do not remove an older archive if exclusive creation failed.
            raise
        try:
            return verify_backup(destination)
        except BaseException:
            destination.unlink()
            raise


def restore_backup(archive, *, document_root, reference_root, database_env, app_stopped, expected_sha256=None):
    if not app_stopped:
        raise BackupError('Stop destination writers and pass --app-stopped')
    check_archive_hash(archive, expected_sha256)
    with tempfile.TemporaryDirectory(prefix='accounting-restore-') as temp:
        stage = Path(temp)
        manifest = extract_verified(archive, stage)
        docs, refs = roots(document_root, reference_root)
        for path in (docs, refs):
            if path.exists() and (not path.is_dir() or any(path.iterdir())):
                raise BackupError('Restore requires empty new storage roots')
        env = connection_env(database_env)
        if query(EMPTY_SQL, env) != '0':
            raise BackupError('Restore requires an empty new PostgreSQL database')
        # Reserve and stage files before database writes. On failure preserve candidate files
        # and the source archive so an operator can inspect/retry into another fresh target.
        for path in (docs, refs):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.chmod(0o700)
        for group in ('objects', 'pending'):
            legacy.copy_tree(stage/group, docs/group)
        legacy.copy_tree(stage/'references', refs)
        for base in (docs, refs):
            for path in base.rglob('*'):
                path.chmod(0o700 if path.is_dir() else 0o600)
        run(['pg_restore', '--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--dbname', env['PGDATABASE'], str(stage/'database.dump')], env)
        try:
            restored_metadata = json.loads(query(METADATA_SQL, env))
        except (ValueError, TypeError):
            raise BackupError('Restored metadata invalid; candidate incomplete') from None
        if not isinstance(restored_metadata, dict):
            raise BackupError('Restored metadata invalid; candidate incomplete')
        if (restored_metadata.get('schema_version') != manifest['schema_version']
            or sorted(restored_metadata.get('source_references', [])) != sorted(manifest['source_references'])):
            raise BackupError('Restored source references differ; candidate incomplete')
        for name, info in manifest['files'].items():
            if name == 'database.dump':
                continue
            target = refs/name.removeprefix('references/') if name.startswith('references/') else docs/name
            if legacy.digest(target) != info['sha256']:
                raise BackupError('Installed file checksum mismatch; candidate incomplete')
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'verify', 'restore'])
    parser.add_argument('archive', type=Path)
    parser.add_argument('--document-root', type=Path)
    parser.add_argument('--reference-root', type=Path)
    parser.add_argument('--app-stopped', action='store_true')
    parser.add_argument('--sha256', help='Expected separately recorded archive SHA-256 (verify/restore)')
    args = parser.parse_args()
    try:
        if args.command == 'verify':
            result = verify_backup(args.archive, expected_sha256=args.sha256)
        else:
            if args.document_root is None or args.reference_root is None:
                raise BackupError('Explicit document/reference roots required')
            env = {k: v for k, v in os.environ.items() if k in {'PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGPASSFILE','PGCONNECT_TIMEOUT'}}
            operation = create_backup if args.command == 'create' else restore_backup
            options = {'expected_sha256': args.sha256} if args.command == 'restore' else {}
            if args.command == 'create' and args.sha256:
                raise BackupError('--sha256 applies only to verify/restore')
            result = operation(args.archive, document_root=args.document_root, reference_root=args.reference_root, database_env=env, app_stopped=args.app_stopped, **options)
        print(f"{args.command} complete: {len(result['files'])} checked files")
        return 0
    except (BackupError, OSError, ValueError):
        print('Backup operation failed; no switchover performed. Check configuration, archive, and candidate target.', file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
