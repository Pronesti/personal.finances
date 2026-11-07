<?php

namespace App\Domain\Recovery;

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use App\Support\PrivateRoots;
use App\Support\TestTargetGuard;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;

/** Administrator recovery and single-ledger export deliberately have different payloads. */
class OwnedRecovery
{
    public const string FORMAT = 'tarjetas-owned-recovery-v2';

    public const array FINANCIAL = ['account_group_members', 'account_group_revisions', 'account_groups', 'account_name_revisions', 'accounts', 'attribution_revisions', 'attributions', 'billed_components', 'billings', 'cards', 'catalog_commands', 'commands', 'component_revisions', 'correction_links', 'credit_revisions', 'evidence', 'historical_receipt_associations', 'issuer_schedules', 'journal_evidence', 'journal_lines', 'journals', 'linked_credits', 'merchant_entities', 'merchant_purchase_revisions', 'merchant_revisions', 'merchant_rule_revisions', 'object_references', 'opening_obligation_evidence', 'opening_obligations', 'payments', 'product_code_revisions', 'product_match_revisions', 'product_revisions', 'product_rule_revisions', 'purchase_versions', 'purchases', 'receipt_entities', 'receipt_entity_keys', 'receipt_facts', 'receipt_link_decisions', 'review_decisions', 'review_events', 'review_products', 'source_documents', 'source_import_commands', 'source_lines', 'source_purchase_identities', 'source_revisions', 'statement_cycles', 'statement_terms'];

    private const array PLATFORM = ['cache', 'cache_locks', 'failed_jobs', 'job_batches', 'jobs', 'ledgers', 'migrations', 'password_reset_tokens', 'sessions', 'users'];

    private const array EXCLUDE_DATA = ['cache', 'cache_locks', 'failed_jobs', 'job_batches', 'jobs', 'ledgers', 'password_reset_tokens', 'sessions', 'users'];

    private function write(string $path, string $bytes): void
    {
        $file = fopen($path, 'xb');
        if ($file === false) {
            throw new RuntimeException('recovery_file_exists');
        }
        try {
            chmod($path, 0600);
            if (fwrite($file, $bytes) !== strlen($bytes) || ! fflush($file) || ! fsync($file)) {
                throw new RuntimeException('recovery_write_failed');
            }
        } finally {
            fclose($file);
        }
    }

    private function output(string $path): void
    {
        if (! str_starts_with($path, '/') || file_exists($path) || is_link($path) || ! preg_match('/^[A-Za-z0-9._-]+$/D', basename($path))) {
            throw new RuntimeException('recovery_output_must_be_new_absolute_file');
        }
        PrivateRoots::canonical(dirname($path));
    }

    private function key(string $path): string
    {
        if (realpath($path) !== $path || is_link($path) || ! is_file($path) || (fileperms($path) & 0077) !== 0 || filesize($path) !== 32) {
            throw new RuntimeException('recovery_key_requires_private_32_byte_file');
        }

        return file_get_contents($path);
    }

    private function tables(): array
    {
        $tables = DB::select("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','accounting') ORDER BY schemaname,tablename");
        $actual = array_map(fn ($row) => $row->schemaname.'.'.$row->tablename, $tables);
        $expected = [...array_map(fn ($name) => 'accounting.'.$name, self::FINANCIAL), ...array_map(fn ($name) => 'public.'.$name, self::PLATFORM)];
        sort($expected, SORT_STRING);
        if ($actual !== $expected) {
            throw new RuntimeException('recovery_schema_allowlist_mismatch');
        }

        return $actual;
    }

    private function inventory(array $tables): array
    {
        $result = [];
        foreach ($tables as $table) {
            $rows = DB::select('SELECT to_jsonb(t)::text AS row FROM '.$table.' t');
            $values = array_map(fn ($row) => $row->row, $rows);
            sort($values, SORT_STRING);
            $context = hash_init('sha256');
            foreach ($values as $value) {
                hash_update($context, $value."\n");
            }
            $result[$table] = ['rows' => count($values), 'sha256' => hash_final($context)];
        }

        return $result;
    }

    private function rowInventory(array $tables): array
    {
        $result = [];
        foreach ($tables as $table) {
            $keys = array_map(fn ($row) => $row->attname, DB::select('SELECT a.attname FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(num,ord) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE i.indrelid=CAST(? AS regclass) AND i.indisprimary ORDER BY k.ord', [$table]));
            if ($keys === []) {
                throw new RuntimeException('recovery_table_without_identity');
            }
            $rows = [];
            foreach (DB::select('SELECT to_jsonb(t)::text AS row FROM '.$table.' t') as $row) {
                $decoded = json_decode($row->row, true, flags: JSON_THROW_ON_ERROR);
                $identity = [];
                foreach (array_unique([...$keys, 'ledger_id', 'id']) as $key) {
                    if (array_key_exists($key, $decoded)) {
                        $identity[$key] = $decoded[$key];
                    }
                }
                ksort($identity, SORT_STRING);
                $rows[] = ['identity' => $identity, 'sha256' => hash('sha256', $row->row)];
            }
            usort($rows, fn ($a, $b) => strcmp(LedgerRepository::json($a['identity']), LedgerRepository::json($b['identity'])));
            $result[$table] = $rows;
        }

        return $result;
    }

    private function identity(): array
    {
        return ['users' => DB::table('users')->orderBy('id')->get()->map(fn ($row) => [...(array) $row, 'remember_token' => null])->all(), 'ledgers' => DB::table('ledgers')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all()];
    }

    private function file(string $path): array
    {
        return ['sha256' => hash_file('sha256', $path), 'bytes' => filesize($path)];
    }

    private function references(?string $owner = null): array
    {
        $query = DB::table('accounting.object_references');
        if ($owner !== null) {
            $query->where('ledger_id', $owner);
        }

        return $query->orderBy('ledger_id')->orderBy('kind')->orderBy('reference_id')->get(['ledger_id', 'kind', 'reference_id', 'relative_path', 'sha256', 'byte_length'])->map(fn ($row) => ['ledger_id' => $row->ledger_id, 'kind' => $row->kind, 'reference_id' => $row->reference_id, 'relative_path' => $row->relative_path, 'sha256' => $row->sha256, 'bytes' => (int) $row->byte_length])->all();
    }

    private function referencePath(array $reference): string
    {
        foreach (['ledger_id', 'kind', 'reference_id', 'relative_path', 'sha256', 'bytes'] as $key) {
            if (! array_key_exists($key, $reference)) {
                throw new RuntimeException('recovery_reference_fields');
            }
        }
        if (! is_string($reference['ledger_id']) || ! preg_match('/^[a-f0-9-]{36}$/D', $reference['ledger_id']) || ! is_string($reference['sha256']) || ! preg_match('/^[a-f0-9]{64}$/D', $reference['sha256']) || ! is_int($reference['bytes']) || $reference['bytes'] < 0) {
            throw new RuntimeException('recovery_reference_identity');
        }
        $base = 'ledgers/'.$reference['ledger_id'];
        $expected = match ($reference['kind']) {
            'object' => $base.'/objects/'.$reference['sha256'],'pending' => preg_match('/^[A-Za-z0-9_-]+$/D', $reference['reference_id']) ? $base.'/pending/'.$reference['reference_id'].'/'.$reference['sha256'] : null,default => null
        };
        if ($expected === null || $reference['relative_path'] !== $expected) {
            throw new RuntimeException('recovery_reference_owner_path');
        }

        return 'documents/'.$expected;
    }

    private function privateFile(string $root, string $relative): string
    {
        $path = $root;
        foreach (explode('/', $relative) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                throw new RuntimeException('recovery_unsafe_path');
            }$path .= '/'.$segment;
            if (is_link($path)) {
                throw new RuntimeException('recovery_symlink');
            }
        }
        if (! is_file($path) || realpath($path) !== $path || (fileperms($path) & 0077) !== 0) {
            throw new RuntimeException('recovery_private_file_unavailable');
        }

        return $path;
    }

    private function postgres(string $bin, string $program, array $arguments): string
    {
        if (realpath($bin) !== $bin || ! is_dir($bin) || ! is_executable($bin.'/'.$program)) {
            throw new RuntimeException('recovery_explicit_postgres_bin_required');
        }
        $version = new Process([$bin.'/'.$program, '--version']);
        $version->mustRun();
        $server = (int) DB::selectOne("SELECT current_setting('server_version_num') AS version")->version;
        if (! preg_match('/\b(\d+)\.\d+/', $version->getOutput(), $match) || (int) $match[1] !== intdiv($server, 10000)) {
            throw new RuntimeException('recovery_postgres_major_mismatch');
        }
        $connection = DB::connection();
        $environment = [];
        foreach (getenv() as $key => $value) {
            $environment[$key] = false;
        }foreach (['PATH', 'HOME', 'LANG', 'LC_ALL'] as $key) {
            $environment[$key] = getenv($key) ?: false;
        }
        foreach (['PGHOST' => 'host', 'PGPORT' => 'port', 'PGDATABASE' => 'database', 'PGUSER' => 'username', 'PGPASSWORD' => 'password', 'PGSSLMODE' => 'sslmode'] as $key => $config) {
            $environment[$key] = (string) ($connection->getConfig($config) ?? ($config === 'sslmode' ? 'prefer' : ''));
        }
        $process = new Process([$bin.'/'.$program, ...$arguments], base_path(), $environment);
        $process->setTimeout(300);
        $previousMask = umask(0077);
        try {
            $process->run();
        } finally {
            umask($previousMask);
        }
        if (! $process->isSuccessful()) {
            throw new RuntimeException('recovery_'.$program.'_failed');
        }

        return $process->getOutput();
    }

    private function add(ZipArchive $zip, string $name, string $path, array &$files): void
    {
        if (! $zip->addFile($path, $name)) {
            throw new RuntimeException('recovery_archive_write');
        }$zip->setExternalAttributesName($name, ZipArchive::OPSYS_UNIX, 0100600 << 16);
        $files[$name] = $this->file($path);
    }

    private function scratch(): string
    {
        $root = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root'));
        $path = $root.'/recovery-'.bin2hex(random_bytes(16));
        if (! mkdir($path, 0700)) {
            throw new RuntimeException('recovery_scratch');
        }

        return $path;
    }

    private function cleanup(string $path): void
    {
        foreach (scandir($path) as $name) {
            if ($name !== '.' && $name !== '..') {
                if (is_dir($path.'/'.$name) && ! is_link($path.'/'.$name)) {
                    $this->cleanup($path.'/'.$name);
                } else {
                    unlink($path.'/'.$name);
                }
            }
        }rmdir($path);
    }

    public function capture(string $output, string $keyFile, string $bin): array
    {
        $this->output($output);
        $key = $this->key($keyFile);
        $scratch = $this->scratch();
        $zip = new ZipArchive;
        try {
            $manifest = DB::transaction(function () use ($scratch, $key, $bin, $output, $zip) {
                DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
                DB::statement("SET LOCAL lock_timeout='5000ms'");
                $tables = $this->tables();
                DB::statement('LOCK TABLE '.implode(',', $tables).' IN SHARE MODE');
                $snapshot = DB::selectOne('SELECT pg_export_snapshot() AS id')->id;
                $identity = ['users' => DB::table('users')->orderBy('id')->get()->map(fn ($row) => [...(array) $row, 'remember_token' => null])->all(), 'ledgers' => DB::table('ledgers')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all()];
                $nonce = random_bytes(12);
                $cipher = openssl_encrypt(LedgerRepository::json($identity), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag, self::FORMAT, 16);
                if ($cipher === false) {
                    throw new RuntimeException('recovery_identity_encryption');
                }
                $this->write($scratch.'/identity.enc', "TRV2\0".$nonce.$tag.$cipher);
                $arguments = ['--format=custom', '--no-owner', '--no-acl', '--schema=public', '--schema=accounting', '--snapshot='.$snapshot, '--file='.$scratch.'/financial.dump'];
                foreach (self::EXCLUDE_DATA as $table) {
                    $arguments[] = '--exclude-table-data=public.'.$table;
                }
                $this->postgres($bin, 'pg_dump', $arguments);
                chmod($scratch.'/financial.dump', 0600);
                $references = $this->references();
                $ledgers = array_column($identity['ledgers'], null, 'id');
                $documents = PrivateRoots::canonical((string) config('tarjetas.document_root'));
                $referenceRoot = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
                $this->write($output, '');
                if ($zip->open($output, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                    throw new RuntimeException('recovery_archive_create');
                }chmod($output, 0600);
                $files = [];
                $this->add($zip, 'financial.dump', $scratch.'/financial.dump', $files);
                $this->add($zip, 'identity.enc', $scratch.'/identity.enc', $files);
                $paths = array_column($references, null, 'relative_path');
                foreach (DB::table('accounting.source_documents')->get() as $object) {
                    $reference = $paths[$object->relative_path] ?? null;
                    if ($reference === null || $reference['ledger_id'] !== $object->ledger_id || $reference['sha256'] !== $object->sha256 || $reference['bytes'] !== (int) $object->byte_length) {
                        throw new RuntimeException('recovery_unreferenced_persisted_object');
                    }
                }
                foreach ($references as $reference) {
                    if (! isset($ledgers[$reference['ledger_id']])) {
                        throw new RuntimeException('recovery_unknown_owner');
                    }$name = $this->referencePath($reference);
                    $path = $this->privateFile($documents, $reference['relative_path']);
                    if ($this->file($path) !== ['sha256' => $reference['sha256'], 'bytes' => $reference['bytes']]) {
                        throw new RuntimeException('recovery_document_integrity');
                    }if (! isset($files[$name])) {
                        $this->add($zip, $name, $path, $files);
                    }
                }
                foreach (['ipc.json', 'mep.json'] as $file) {
                    $path = $this->privateFile($referenceRoot, $file);
                    $this->add($zip, 'references/'.$file, $path, $files);
                }
                $financialTables = array_values(array_filter($tables, fn ($table) => str_starts_with($table, 'accounting.') || $table === 'public.migrations'));
                $this->write($scratch.'/row-inventory.json', LedgerRepository::json($this->rowInventory($financialTables)));
                $this->add($zip, 'row-inventory.json', $scratch.'/row-inventory.json', $files);
                $manifest = ['format' => self::FORMAT, 'appRevision' => (string) config('tarjetas.revision'), 'schemaRevision' => DB::table('migrations')->max('migration'), 'postgresMajor' => intdiv((int) DB::selectOne("SELECT current_setting('server_version_num') AS version")->version, 10000), 'tables' => $tables, 'inventory' => $this->inventory($financialTables), 'identitySha256' => hash('sha256', LedgerRepository::json($identity)), 'references' => $references, 'files' => $files, 'capturedAt' => now()->toIso8601String(), 'authentication' => 'sessions omitted; remember tokens cleared; password reset tokens omitted'];
                $zip->addFromString('manifest.json', LedgerRepository::json($manifest));
                $zip->setExternalAttributesName('manifest.json', ZipArchive::OPSYS_UNIX, 0100600 << 16);
                if (! $zip->close()) {
                    throw new RuntimeException('recovery_archive_close');
                }
                foreach ($files as $name => $metadata) {
                    if (str_starts_with($name, 'references/') && $metadata !== $this->file($referenceRoot.'/'.basename($name))) {
                        throw new RuntimeException('recovery_reference_changed_during_capture');
                    }
                }

                return $manifest;
            });

            return ['format' => self::FORMAT, 'sha256' => hash_file('sha256', $output), 'references' => count($manifest['references']), 'tables' => count($manifest['tables'])];
        } catch (\Throwable $error) {
            try {
                $zip->close();
            } catch (\Throwable) {
            }if (is_file($output)) {
                unlink($output);
            }throw $error;
        } finally {
            $this->cleanup($scratch);
            sodium_memzero($key);
        }
    }

    public function inspect(string $archive, string $externalSha, string $keyFile): array
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $externalSha) || is_link($archive) || ! is_file($archive) || (fileperms($archive) & 0077) !== 0 || realpath($archive) !== $archive || ! hash_equals($externalSha, hash_file('sha256', $archive))) {
            throw new RuntimeException('recovery_archive_digest');
        }
        $key = $this->key($keyFile);
        $zip = new ZipArchive;
        if ($zip->open($archive, ZipArchive::RDONLY) !== true) {
            throw new RuntimeException('recovery_invalid_archive');
        }
        try {
            $raw = $zip->getFromName('manifest.json', 4194305);
            if ($raw === false || strlen($raw) > 4194304) {
                throw new RuntimeException('recovery_manifest_size');
            }$manifest = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
            $expected = [...array_map(fn ($name) => 'accounting.'.$name, self::FINANCIAL), ...array_map(fn ($name) => 'public.'.$name, self::PLATFORM)];
            sort($expected, SORT_STRING);
            $migrationFiles = glob(database_path('migrations/*.php'));
            $schemaRevision = max(array_map(fn ($file) => basename($file, '.php'), $migrationFiles));
            if (($manifest['schemaRevision'] ?? null) !== $schemaRevision) {
                throw new RuntimeException('recovery_schema_revision');
            }
            if (($manifest['format'] ?? null) !== self::FORMAT || ($manifest['tables'] ?? null) !== $expected || ($manifest['appRevision'] ?? null) !== (string) config('tarjetas.revision')) {
                throw new RuntimeException('recovery_format_revision_allowlist');
            }
            $names = [];
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $name = $stat['name'];
                $zip->getExternalAttributesIndex($i, $opsys, $attributes);
                if (isset($names[$name]) || ! preg_match('/^[A-Za-z0-9._\/-]+$/D', $name) || str_starts_with($name, '/') || array_intersect(explode('/', $name), ['', '..', '.']) !== [] || (($attributes >> 16) & 0170000) === 0120000) {
                    throw new RuntimeException('recovery_unsafe_archive_path');
                }$names[$name] = true;
                $total += $stat['size'];
                if ($total > 2147483648) {
                    throw new RuntimeException('recovery_archive_too_large');
                }
            }
            $expectedNames = ['manifest.json', ...array_keys($manifest['files'])];
            sort($expectedNames, SORT_STRING);
            $actualNames = array_keys($names);
            sort($actualNames, SORT_STRING);
            if ($expectedNames !== $actualNames) {
                throw new RuntimeException('recovery_archive_inventory');
            }
            foreach ($manifest['files'] as $name => $expectedFile) {
                $stream = $zip->getStream($name);
                if ($stream === false) {
                    throw new RuntimeException('recovery_missing_payload');
                }$context = hash_init('sha256');
                $bytes = hash_update_stream($context, $stream);
                fclose($stream);
                if (['sha256' => hash_final($context), 'bytes' => $bytes] !== $expectedFile) {
                    throw new RuntimeException('recovery_payload_digest');
                }
            }
            $encrypted = $zip->getFromName('identity.enc');
            if ($encrypted === false || substr($encrypted, 0, 5) !== "TRV2\0") {
                throw new RuntimeException('recovery_identity_missing');
            }$plaintext = openssl_decrypt(substr($encrypted, 33), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr($encrypted, 5, 12), substr($encrypted, 17, 16), self::FORMAT);
            if ($plaintext === false || ! hash_equals($manifest['identitySha256'], hash('sha256', $plaintext))) {
                throw new RuntimeException('recovery_identity_authentication');
            }$identity = json_decode($plaintext, true, flags: JSON_THROW_ON_ERROR);
            $users = array_column($identity['users'], null, 'id');
            $ledgers = array_column($identity['ledgers'], null, 'id');
            if (count($users) !== count($identity['users']) || count($ledgers) !== count($identity['ledgers'])) {
                throw new RuntimeException('recovery_identity_duplicates');
            }foreach ($ledgers as $ledger) {
                if (! isset($users[$ledger['owner_user_id']])) {
                    throw new RuntimeException('recovery_identity_mapping');
                }
            }
            if (count($manifest['references']) !== ($manifest['inventory']['accounting.object_references']['rows'] ?? -1)) {
                throw new RuntimeException('recovery_reference_count');
            }
            $seen = [];
            $requiredFiles = ['financial.dump', 'identity.enc', 'references/ipc.json', 'references/mep.json'];
            if (isset($manifest['files']['row-inventory.json'])) {
                if ($manifest['files']['row-inventory.json']['bytes'] > 67108864) {
                    throw new RuntimeException('recovery_row_inventory_size');
                }
                $rows = json_decode($zip->getFromName('row-inventory.json'), true, flags: JSON_THROW_ON_ERROR);
                if (array_keys($rows) !== array_keys($manifest['inventory'])) {
                    throw new RuntimeException('recovery_row_inventory_tables');
                }
                foreach ($rows as $table => $entries) {
                    if (count($entries) !== $manifest['inventory'][$table]['rows']) {
                        throw new RuntimeException('recovery_row_inventory_count');
                    }
                    $identities = [];
                    foreach ($entries as $entry) {
                        $id = LedgerRepository::json($entry['identity']);
                        if (isset($identities[$id]) || ! preg_match('/^[a-f0-9]{64}$/D', $entry['sha256']) || (str_starts_with($table, 'accounting.') && ! isset($ledgers[$entry['identity']['ledger_id'] ?? '']))) {
                            throw new RuntimeException('recovery_row_inventory_owner_identity');
                        } $identities[$id] = true;
                    }
                }
                $requiredFiles[] = 'row-inventory.json';
            }
            foreach ($manifest['references'] as $reference) {
                $name = $this->referencePath($reference);
                $id = LedgerRepository::json([$reference['ledger_id'], $reference['kind'], $reference['reference_id']]);
                if (isset($seen[$id]) || ! isset($ledgers[$reference['ledger_id']]) || ($manifest['files'][$name] ?? null) !== ['sha256' => $reference['sha256'], 'bytes' => $reference['bytes']]) {
                    throw new RuntimeException('recovery_reference_inventory');
                }$seen[$id] = true;
                $requiredFiles[] = $name;
            }$requiredFiles = array_values(array_unique($requiredFiles));
            sort($requiredFiles, SORT_STRING);
            $files = array_keys($manifest['files']);
            sort($files, SORT_STRING);
            if ($requiredFiles !== $files) {
                throw new RuntimeException('recovery_unexpected_payload');
            }

            return ['manifest' => $manifest, 'identity' => $identity];
        } finally {
            $zip->close();
            sodium_memzero($key);
        }
    }

    public function restore(string $archive, string $sha, string $keyFile, string $bin): array
    {
        $checked = $this->inspect($archive, $sha, $keyFile);
        $manifest = $checked['manifest'];
        if (DB::selectOne("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname IN ('public','accounting')) AS present")->present) {
            throw new RuntimeException('recovery_target_not_empty');
        }
        $documents = PrivateRoots::canonical((string) config('tarjetas.document_root'));
        $references = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        foreach ([$documents, $references] as $root) {
            if (array_values(array_diff(scandir($root), ['.', '..'])) !== []) {
                throw new RuntimeException('recovery_roots_not_empty');
            }
        }
        $scratch = $this->scratch();
        $zip = new ZipArchive;
        $zip->open($archive, ZipArchive::RDONLY);
        try {
            foreach ($manifest['files'] as $name => $metadata) {
                $target = $scratch.'/'.$name;
                $parent = dirname($target);
                if (! is_dir($parent)) {
                    mkdir($parent, 0700, true);
                } $stream = $zip->getStream($name);
                $file = fopen($target, 'xb');
                chmod($target, 0600);
                stream_copy_to_stream($stream, $file);
                fflush($file);
                fsync($file);
                fclose($file);
                fclose($stream);
                if ($this->file($target) !== $metadata) {
                    throw new RuntimeException('recovery_staging_integrity');
                }
            }
            $zip->close();
            $dump = $scratch.'/financial.dump';
            $toc = $this->postgres($bin, 'pg_restore', ['--list', $dump]);
            $lines = array_filter(explode("\n", $toc), fn ($line) => ! preg_match('/^\d+; \d+ \d+ (?:SCHEMA - public|COMMENT - SCHEMA public)(?:\s|$)/D', $line));
            $this->write($scratch.'/restore.list', implode("\n", $lines)."\n");
            foreach (['pre-data', 'data', 'post-data'] as $section) {
                $this->postgres($bin, 'pg_restore', ['--no-owner', '--no-acl', '--section='.$section, '--use-list='.$scratch.'/restore.list', '--file='.$scratch.'/'.$section.'.sql', $dump]);
                chmod($scratch.'/'.$section.'.sql', 0600);
            }
            $identitySql = '';
            foreach (['users' => ['id', 'name', 'email', 'email_verified_at', 'password', 'remember_token', 'created_at', 'updated_at'], 'ledgers' => ['id', 'owner_user_id', 'created_at', 'updated_at']] as $table => $columns) {
                foreach ($checked['identity'][$table] as $row) {
                    $actual = array_keys($row);
                    sort($actual, SORT_STRING);
                    $expected = $columns;
                    sort($expected, SORT_STRING);
                    if ($actual !== $expected) {
                        throw new RuntimeException('recovery_identity_columns');
                    }
                    if ($table === 'users') {
                        $row['remember_token'] = null;
                    }
                    $values = array_map(fn ($column) => $row[$column] === null ? 'NULL' : DB::connection()->getPdo()->quote((string) $row[$column]), $columns);
                    $identitySql .= 'INSERT INTO public.'.$table.' ('.implode(',', $columns).') VALUES ('.implode(',', $values).");\n";
                }
            }
            $this->write($scratch.'/identity.sql', $identitySql);
            $this->write($scratch.'/identity-sequence.sql', "SELECT setval(pg_get_serial_sequence('public.users','id'), GREATEST((SELECT COALESCE(max(id),1) FROM public.users),1), true);\n");
            $arguments = ['--no-psqlrc', '--no-password', '--quiet', '--single-transaction', '--set=ON_ERROR_STOP=1'];
            foreach (['pre-data', 'identity', 'data', 'post-data', 'identity-sequence'] as $section) {
                $arguments[] = '--file='.$scratch.'/'.$section.'.sql';
            }
            $this->postgres($bin, 'psql', $arguments);
            if ($this->inventory(array_keys($manifest['inventory'])) !== $manifest['inventory'] || $this->references() !== $manifest['references']) {
                throw new RuntimeException('recovery_restored_row_inventory');
            }
            if (FinancialCommands::digest($this->identity()) !== FinancialCommands::digest($checked['identity'])) {
                throw new RuntimeException('recovery_restored_identity_inventory');
            }
            if (isset($manifest['files']['row-inventory.json']) && $this->rowInventory(array_keys($manifest['inventory'])) !== json_decode(file_get_contents($scratch.'/row-inventory.json'), true, flags: JSON_THROW_ON_ERROR)) {
                throw new RuntimeException('recovery_restored_row_identities');
            }
            foreach (['sessions', 'password_reset_tokens', 'jobs', 'failed_jobs', 'job_batches', 'cache', 'cache_locks'] as $table) {
                if (DB::table($table)->exists()) {
                    throw new RuntimeException('recovery_transient_authentication_state');
                }
            }
            if (DB::table('users')->whereNotNull('remember_token')->exists()) {
                throw new RuntimeException('recovery_persistent_login_state');
            }
            foreach ($manifest['files'] as $name => $metadata) {
                $root = str_starts_with($name, 'documents/') ? $documents : (str_starts_with($name, 'references/') ? $references : null);
                if ($root === null) {
                    continue;
                }$relative = substr($name, strpos($name, '/') + 1);
                $destination = $root.'/'.$relative;
                if (! is_dir(dirname($destination))) {
                    mkdir(dirname($destination), 0700, true);
                }if (! link($scratch.'/'.$name, $destination)) {
                    throw new RuntimeException('recovery_publish');
                }chmod($destination, 0600);
                if ($this->file($destination) !== $metadata) {
                    throw new RuntimeException('recovery_published_integrity');
                }
            }

            return ['status' => 'restored', 'format' => self::FORMAT, 'references' => count($manifest['references']), 'sessions' => 0, 'traffic' => 'quarantined pending acceptance'];
        } finally {
            try {
                $zip->close();
            } catch (\Throwable) {
            }$this->cleanup($scratch);
        }
    }

    /** Reuse only the newly approved synthetic restore target, refusing changed financial data. */
    public function resetAcceptance(string $archive, string $sha, string $keyFile): array
    {
        app(TestTargetGuard::class)->check();
        if (config('tarjetas.test_target.id') !== 'recovery') {
            throw new RuntimeException('recovery_reset_target_refused');
        }
        $checked = $this->inspect($archive, $sha, $keyFile);
        $manifest = $checked['manifest'];
        $documents = PrivateRoots::canonical((string) config('tarjetas.document_root'));
        $references = PrivateRoots::canonical((string) config('tarjetas.reference_root'));
        $expectedPaths = [];
        foreach ($manifest['files'] as $name => $metadata) {
            $root = str_starts_with($name, 'documents/') ? $documents : (str_starts_with($name, 'references/') ? $references : null);
            if ($root === null) {
                continue;
            }
            $relative = substr($name, strpos($name, '/') + 1);
            $path = $this->privateFile($root, $relative);
            if ($this->file($path) !== $metadata) {
                throw new RuntimeException('recovery_reset_changed_object');
            }
            $expectedPaths[] = $path;
        }
        $actualPaths = [];
        foreach ([$documents, $references] as $root) {
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $entry) {
                if ($entry->isLink() || ! $entry->isFile()) {
                    throw new RuntimeException('recovery_reset_unsafe_path');
                } $actualPaths[] = $entry->getPathname();
            }
        }
        sort($actualPaths, SORT_STRING);
        sort($expectedPaths, SORT_STRING);
        if ($actualPaths !== $expectedPaths) {
            throw new RuntimeException('recovery_reset_extra_files');
        }
        DB::transaction(function () use ($manifest, $checked): void {
            $tables = $this->tables();
            DB::statement("SET LOCAL lock_timeout='5000ms'");
            DB::statement('LOCK TABLE '.implode(',', $tables).' IN ACCESS EXCLUSIVE MODE');
            if ($this->inventory(array_keys($manifest['inventory'])) !== $manifest['inventory'] || $this->references() !== $manifest['references']) {
                throw new RuntimeException('recovery_reset_changed_financial_rows');
            }
            $identity = ['users' => DB::table('users')->orderBy('id')->get()->map(fn ($row) => [...(array) $row, 'remember_token' => null])->all(), 'ledgers' => DB::table('ledgers')->orderBy('id')->get()->map(fn ($row) => (array) $row)->all()];
            if (FinancialCommands::digest($identity) !== FinancialCommands::digest($checked['identity'])) {
                throw new RuntimeException('recovery_reset_changed_identity');
            }
            DB::statement('DROP SCHEMA accounting CASCADE');
            DB::statement('DROP TABLE '.implode(',', array_map(fn ($table) => 'public.'.$table, self::PLATFORM)).' CASCADE');
            DB::statement('DROP FUNCTION public.guard_ledger_identity()');
        });
        foreach ([$documents, $references] as $root) {
            foreach (scandir($root) as $name) {
                if ($name === '.' || $name === '..') {
                    continue;
                } if (is_dir($root.'/'.$name)) {
                    $this->cleanup($root.'/'.$name);
                } else {
                    unlink($root.'/'.$name);
                }
            }
        }

        return ['status' => 'empty disposable recovery target', 'source' => 'unchanged', 'previousArchiveSha256' => $sha];
    }

    public function export(Ledger $ledger, string $output): array
    {
        $this->output($output);
        $repository = new LedgerRepository($ledger);
        $zip = new ZipArchive;
        $files = [];
        try {
            return $repository->readSnapshot(function () use ($ledger, $repository, $zip, $output, &$files) {
                $tables = [];
                foreach (self::FINANCIAL as $table) {
                    $tables[$table] = $repository->query($table)->get()->map(fn ($row) => (array) $row)->all();
                }
                $rows = LedgerRepository::json(['format' => 'tarjetas-single-ledger-export-v1', 'ledgerId' => $ledger->id, 'tables' => $tables]);
                $this->write($output, '');
                if ($zip->open($output, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                    throw new RuntimeException('export_archive');
                }chmod($output, 0600);
                $zip->addFromString('financial.json', $rows);
                $zip->setExternalAttributesName('financial.json', ZipArchive::OPSYS_UNIX, 0100600 << 16);
                $root = PrivateRoots::canonical((string) config('tarjetas.document_root'));
                $refs = $this->references($ledger->id);
                foreach ($refs as $reference) {
                    $name = $this->referencePath($reference);
                    if (isset($files[$name])) {
                        continue;
                    }$path = $this->privateFile($root, $reference['relative_path']);
                    if ($this->file($path) !== ['sha256' => $reference['sha256'], 'bytes' => $reference['bytes']]) {
                        throw new RuntimeException('export_object_integrity');
                    }$this->add($zip, $name, $path, $files);
                }$zip->addFromString('manifest.json', LedgerRepository::json(['format' => 'tarjetas-single-ledger-export-v1', 'ledgerId' => $ledger->id, 'references' => $refs, 'files' => $files]));
                $zip->close();

                return ['sha256' => hash_file('sha256', $output), 'references' => count($refs)];
            });
        } catch (\Throwable $error) {
            try {
                $zip->close();
            } catch (\Throwable) {
            }if (is_file($output)) {
                unlink($output);
            }throw $error;
        }
    }
}
