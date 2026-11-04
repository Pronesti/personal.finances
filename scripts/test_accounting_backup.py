import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import accounting_backup as backup


def fixture(base):
    files = {'database.dump': b'PGDMPfixture', 'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3': b'pdf',
             'pending/rows.txt': b'correction', 'references/ipc.json': b'{}'}
    manifest = {'format': 'tarjetas-accounting-backup', 'version': 1,
                'app_revision': 'synthetic', 'schema_version': 1,
                'database': {'path': 'database.dump', 'server_major': 18},
                'source_references': ['objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3'],
                'files': {name: {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                          for name, data in files.items()}}
    archive = base / 'backup.zip'
    write(archive, files, manifest)
    return archive, files, manifest


def write(archive, files, manifest):
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr('manifest.json', json.dumps(manifest))
        for name, data in files.items():
            output.writestr(name, data)


class BackupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve()
        self.archive, self.files, self.manifest = fixture(self.base)

    def restore(self):
        return backup.restore_backup(self.archive, document_root=self.base / 'docs',
            reference_root=self.base / 'refs', database_env={'PGDATABASE': 'isolated'}, app_stopped=True)

    def test_verify(self):
        self.assertEqual(backup.verify_backup(self.archive), self.manifest)

    def test_corruption_before_process(self):
        self.files['objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3'] = b'bad'
        write(self.archive, self.files, self.manifest)
        with patch.object(backup.subprocess, 'run') as runner:
            with self.assertRaisesRegex(backup.BackupError, 'checksum'):
                self.restore()
            runner.assert_not_called()

    def test_corrupt_object_with_matching_manifest_hash_is_rejected(self):
        source = self.manifest['source_references'][0]
        self.files[source] = b'corrupted before backup'
        self.manifest['files'][source] = {
            'size': len(self.files[source]),
            'sha256': hashlib.sha256(self.files[source]).hexdigest(),
        }
        write(self.archive, self.files, self.manifest)
        with patch.object(backup.subprocess, 'run') as runner:
            with self.assertRaisesRegex(backup.BackupError, 'identity'):
                self.restore()
            runner.assert_not_called()

    def test_paths_unlisted_missing_and_version(self):
        for name in ('../escape', '/absolute', 'objects/../escape', 'objects\\escape'):
            with self.subTest(name=name):
                files = {**self.files, name: b'x'}
                manifest = {**self.manifest, 'files': {**self.manifest['files'], name: {'size': 1, 'sha256': hashlib.sha256(b'x').hexdigest()}}}
                write(self.archive, files, manifest)
                with self.assertRaises(backup.BackupError):
                    backup.verify_backup(self.archive)
        write(self.archive, {k: v for k, v in self.files.items() if k != 'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3'}, self.manifest)
        with self.assertRaises(backup.BackupError):
            backup.verify_backup(self.archive)

    def test_restore_nonempty_and_no_pause(self):
        with self.assertRaises(backup.BackupError):
            backup.restore_backup(self.archive, document_root=self.base/'docs', reference_root=self.base/'refs', database_env={}, app_stopped=False)
        (self.base/'docs').mkdir()
        (self.base/'docs/keep').write_text('keep')
        with patch.object(backup.subprocess, 'run') as runner:
            with self.assertRaises(backup.BackupError):
                self.restore()
            runner.assert_not_called()


class ProcessTests(BackupTests):
    def test_wrong_external_archive_hash_before_process(self):
        with patch.object(backup.subprocess, 'run') as runner:
            with self.assertRaisesRegex(backup.BackupError, 'SHA-256'):
                backup.restore_backup(self.archive, document_root=self.base/'new-docs', reference_root=self.base/'new-refs', database_env={'PGDATABASE':'isolated'}, app_stopped=True, expected_sha256='0'*64)
            runner.assert_not_called()
        self.assertFalse((self.base/'new-docs').exists())

    def test_failed_dump_does_not_publish_archive_or_change_sources(self):
        import subprocess
        docs, refs = self.base/'source-docs', self.base/'source-refs'
        (docs/'objects').mkdir(parents=True)
        refs.mkdir()
        (docs/'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').write_bytes(b'pdf')
        output = self.base/'failed.zip'
        responses = [subprocess.CompletedProcess([],0,json.dumps(self.manifest),''), subprocess.CompletedProcess([],1,'','secret')]
        with patch.object(backup.subprocess,'run',side_effect=responses):
            with self.assertRaises(backup.BackupError):
                backup.create_backup(output,document_root=docs,reference_root=refs,database_env={'PGDATABASE':'isolated'},app_stopped=True)
        self.assertFalse(output.exists())
        self.assertEqual((docs/'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').read_bytes(),b'pdf')

    def test_restore_mocked_round_trip_and_flags(self):
        import subprocess
        responses = [subprocess.CompletedProcess([], 0, '0\n', ''),
                     subprocess.CompletedProcess([], 0, '', ''),
                     subprocess.CompletedProcess([], 0, json.dumps(self.manifest), '')]
        with patch.object(backup.subprocess, 'run', side_effect=responses) as runner:
            self.restore()
            command = runner.call_args_list[1].args[0]
            self.assertIn('--single-transaction', command)
            self.assertNotIn('--clean', command)
        self.assertEqual((self.base/'docs/objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').read_bytes(), b'pdf')
        self.assertEqual((self.base/'docs/pending/rows.txt').read_bytes(), b'correction')
        self.assertEqual((self.base/'refs/ipc.json').read_bytes(), b'{}')
        self.assertEqual((self.base/'docs/objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').stat().st_mode & 0o777, 0o600)

    def test_nonempty_database_refused(self):
        import subprocess
        with patch.object(backup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '1', '')) as runner:
            with self.assertRaisesRegex(backup.BackupError, 'empty new PostgreSQL'):
                self.restore()
            self.assertEqual(runner.call_count, 1)
        self.assertFalse((self.base/'docs').exists())

    def test_failed_restore_retains_source_and_candidate(self):
        import subprocess
        responses = [subprocess.CompletedProcess([], 0, '0', ''), subprocess.CompletedProcess([], 1, '', 'password=SECRET')]
        with patch.object(backup.subprocess, 'run', side_effect=responses):
            with self.assertRaises(backup.BackupError) as caught:
                self.restore()
        self.assertNotIn('SECRET', str(caught.exception))
        self.assertTrue(self.archive.exists())
        self.assertTrue((self.base/'docs/objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').exists())

    def test_create_mocked_and_exclusive(self):
        import subprocess
        docs, refs = self.base/'source-docs', self.base/'source-refs'
        (docs/'objects').mkdir(parents=True)
        (docs/'pending').mkdir()
        refs.mkdir()
        (docs/'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').write_bytes(b'pdf')
        (docs/'pending/correction.txt').write_bytes(b'pending')
        (refs/'ipc.json').write_bytes(b'{}')
        output = self.base/'created.zip'
        def process(command, **kwargs):
            if command[0] == 'pg_dump':
                Path(command[-1]).write_bytes(b'PGDMPmock')
                return subprocess.CompletedProcess(command, 0, '', '')
            return subprocess.CompletedProcess(command, 0, json.dumps({k:v for k,v in self.manifest.items() if k not in ('files','format','version')}), '')
        with patch.object(backup.subprocess, 'run', side_effect=process):
            backup.create_backup(output, document_root=docs, reference_root=refs, database_env={'PGDATABASE':'isolated'}, app_stopped=True)
            original = output.read_bytes()
            with self.assertRaises(FileExistsError):
                backup.create_backup(output, document_root=docs, reference_root=refs, database_env={'PGDATABASE':'isolated'}, app_stopped=True)
            self.assertEqual(original, output.read_bytes())
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_missing_required_reference(self):
        self.manifest['source_references'] = ['objects/missing.pdf']
        write(self.archive, self.files, self.manifest)
        with self.assertRaisesRegex(backup.BackupError, 'source object'):
            backup.verify_backup(self.archive)

@unittest.skipUnless(__import__('os').environ.get('ACCOUNTING_PG_BACKUP_TESTS') == '1', 'real PG backup tests require explicit opt-in')
class RealPostgresTests(unittest.TestCase):
    def test_fresh_target_round_trip(self):
        import os
        source_name = os.environ.get('ACCOUNTING_PG_BACKUP_SOURCE')
        target_name = os.environ.get('ACCOUNTING_PG_BACKUP_TARGET')
        if not source_name or not target_name or source_name == target_name:
            self.fail('Set distinct fresh ACCOUNTING_PG_BACKUP_SOURCE and ACCOUNTING_PG_BACKUP_TARGET database names')
        fields = ('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGSSLMODE','PGPASSFILE')
        source = {key: os.environ[key] for key in fields if key in os.environ}
        source['PGDATABASE'] = source_name
        target = {**source, 'PGDATABASE': target_name}
        source_env, target_env = backup.connection_env(source), backup.connection_env(target)
        self.assertEqual(backup.query(backup.EMPTY_SQL, source_env), '0', 'Source test database must be empty')
        self.assertEqual(backup.query(backup.EMPTY_SQL, target_env), '0', 'Target test database must be empty')
        # These names must be disposable databases. They are deliberately retained on failure.
        backup.query("CREATE SCHEMA accounting; CREATE TABLE synthetic_events(kind text, minor bigint); INSERT INTO synthetic_events VALUES ('purchase',100),('bill',100),('payment',100),('correction',-100); CREATE VIEW accounting.accounting_backup_metadata AS SELECT json_build_object('app_revision','synthetic-integration','schema_version',1,'database',json_build_object('path','database.dump','server_major',current_setting('server_version_num')::integer / 10000),'source_references',json_build_array('objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3')) AS metadata", source_env)
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            docs, refs = base/'source-docs', base/'source-refs'
            (docs/'objects').mkdir(parents=True)
            (docs/'pending').mkdir()
            refs.mkdir()
            (docs/'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').write_bytes(b'pdf')
            (docs/'pending/rows.txt').write_bytes(b'pending-correction')
            (refs/'ipc.json').write_bytes(b'{}')
            archive = base/'backup.zip'
            manifest = backup.create_backup(archive, document_root=docs, reference_root=refs, database_env=source, app_stopped=True)
            restored = backup.restore_backup(archive, document_root=base/'moved-docs', reference_root=base/'moved-refs', database_env=target, app_stopped=True)
            self.assertEqual(manifest, restored)
            self.assertEqual(backup.query('SELECT count(*) FROM synthetic_events', target_env), '4')
            self.assertEqual((base/'moved-docs/objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').read_bytes(), (docs/'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3').read_bytes())
            with self.assertRaisesRegex(backup.BackupError, 'empty new PostgreSQL'):
                backup.restore_backup(archive, document_root=base/'third-docs', reference_root=base/'third-refs', database_env=target, app_stopped=True)
            self.assertEqual(backup.query('SELECT count(*) FROM synthetic_events', source_env), '4')

class ArchiveSafetyTests(BackupTests):
    def test_manifest_cannot_claim_itself_as_unverified_payload(self):
        self.manifest['files']['manifest.json'] = {'size': 0, 'sha256': '0'*64}
        write(self.archive,self.files,self.manifest)
        with self.assertRaisesRegex(backup.BackupError,'contents'):
            backup.verify_backup(self.archive)

    def test_duplicate_member(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(self.archive, 'a') as archive:
                archive.writestr('objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3', b'pdf')
        with self.assertRaisesRegex(backup.BackupError, 'Duplicate'):
            backup.verify_backup(self.archive)

    def test_symlink_member(self):
        with zipfile.ZipFile(self.archive) as archive:
            contents = {name: archive.read(name) for name in archive.namelist()}
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, content in contents.items():
                entry = zipfile.ZipInfo(name)
                if name == 'objects/c35b21d6ca39aa7cc3b79a705d989f1a6e88b99ab43988d74048799e3db926a3':
                    entry.create_system = 3
                    entry.external_attr = 0o120777 << 16
                archive.writestr(entry, content)
        with self.assertRaisesRegex(backup.BackupError, 'Non-regular'):
            backup.verify_backup(self.archive)

    def test_size_limit(self):
        with patch.object(backup, 'MAX_BYTES', 1):
            with self.assertRaisesRegex(backup.BackupError, 'size'):
                backup.verify_backup(self.archive)

if __name__ == '__main__':
    unittest.main()
