<?php

namespace Tests\Feature;

use App\Domain\Recovery\OwnedRecovery;
use App\Domain\Reports\ReferencePublisher;
use App\Models\Ledger;
use App\Support\PrivateRoots;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\PostgresTestCase;
use ZipArchive;

class RecoveryArchiveTest extends PostgresTestCase
{
    public function test_actual_postgres_capture_encrypts_identity_preserves_all_owned_references_and_refuses_tampering(): void
    {
        $bin = getenv('TARJETAS_ACCEPTANCE_PG_BIN');
        if (! $bin) {
            $this->markTestSkipped('Explicit matching-major PostgreSQL tools required for recovery integration.');
        }
        $this->artisan('tarjetas:acceptance:references')->assertExitCode(0);
        $this->artisan('tarjetas:acceptance:document-users')->assertExitCode(0);
        $root = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root')).'/recovery-test-'.bin2hex(random_bytes(8));
        mkdir($root, 0700);
        $key = $root.'/key';
        file_put_contents($key, random_bytes(32));
        chmod($key, 0600);
        $wrong = $root.'/wrong-key';
        file_put_contents($wrong, random_bytes(32));
        chmod($wrong, 0600);
        $recovery = new OwnedRecovery;
        $archive = $root.'/capture.zip';
        $before = DB::table('accounting.journals')->count();
        try {
            $configuredRoot = config('tarjetas.reference_root');
            $publishedRoot = $root.'-references';
            mkdir($publishedRoot, 0700);
            config(['tarjetas.reference_root' => $publishedRoot]);
            $publication = (new ReferencePublisher)->publish(realpath(base_path('../docs/rebuild/fixtures/references.json')), 'empty');
            try {
                $result = $recovery->capture($archive, $key, $bin);
            } finally {
                config(['tarjetas.reference_root' => $configuredRoot]);
            }
            $zip = new ZipArchive;
            $zip->open($archive);
            $this->assertSame(file_get_contents($publishedRoot.'/release-'.$publication['version'].'/ipc.json'), $zip->getFromName('references/ipc.json'));
            $zip->close();
            $this->assertSame(OwnedRecovery::FORMAT, $result['format']);
            $this->assertGreaterThanOrEqual(8, $result['references']);
            $this->assertSame(0, fileperms($archive) & 0077);
            $checked = $recovery->inspect($archive, $result['sha256'], $key);
            $this->assertSame(DB::table('ledgers')->count(), count($checked['identity']['ledgers']));
            $this->assertSame(DB::table('users')->count(), count($checked['identity']['users']));
            foreach ($checked['identity']['users'] as $user) {
                $this->assertNull($user['remember_token']);
                $this->assertNotEmpty($user['password']);
            }
            $refs = $checked['manifest']['references'];
            $shared = [];
            foreach ($refs as $ref) {
                $shared[$ref['sha256']][$ref['ledger_id']] = true;
            }$this->assertNotEmpty(array_filter($shared, fn ($owners) => count($owners) > 1));
            $this->assertCount(count($refs), array_unique(array_map(fn ($ref) => json_encode([$ref['ledger_id'], $ref['kind'], $ref['reference_id']]), $refs)));
            foreach ([['wrong-sha', str_repeat('0', 64), $key], ['wrong-key', $result['sha256'], $wrong]] as [$case,$sha,$keyFile]) {
                try {
                    $recovery->inspect($archive, $sha, $keyFile);
                    $this->fail($case.' accepted');
                } catch (RuntimeException $error) {
                    $this->assertSame($case === 'wrong-sha' ? 'recovery_archive_digest' : 'recovery_identity_authentication', $error->getMessage());
                }
            }
            foreach (['swapped-owner', 'missing-owner-reference', 'corrupt-object', 'unsafe-path'] as $case) {
                $copy = $root.'/'.$case.'.zip';
                copy($archive, $copy);
                chmod($copy, 0600);
                $zip = new ZipArchive;
                $zip->open($copy);
                $manifest = json_decode($zip->getFromName('manifest.json'), true);
                if ($case === 'swapped-owner') {
                    $manifest['references'][0]['ledger_id'] = '00000000-0000-4000-8000-000000000000';
                } elseif ($case === 'missing-owner-reference') {
                    array_shift($manifest['references']);
                } elseif ($case === 'corrupt-object') {
                    $name = 'documents/'.$manifest['references'][0]['relative_path'];
                    $zip->addFromString($name, 'corrupt');
                } else {
                    $zip->addFromString('../outside', 'unsafe');
                }
                $zip->addFromString('manifest.json', json_encode($manifest));
                $zip->close();
                try {
                    $recovery->inspect($copy, hash_file('sha256', $copy), $key);
                    $this->fail($case.' accepted');
                } catch (RuntimeException $error) {
                    $this->assertContains($error->getMessage(), ['recovery_reference_owner_path', 'recovery_reference_count', 'recovery_payload_digest', 'recovery_unsafe_archive_path']);
                }
            }
            try {
                $recovery->restore($archive, $result['sha256'], $key, $bin);
                $this->fail('Nonempty restore target accepted.');
            } catch (RuntimeException $error) {
                $this->assertSame('recovery_target_not_empty', $error->getMessage());
            }
            $owner = Ledger::query()->firstOrFail();
            $export = $root.'/one-ledger.zip';
            $recovery->export($owner, $export);
            $zip = new ZipArchive;
            $zip->open($export);
            $financial = json_decode($zip->getFromName('financial.json'), true);
            $this->assertSame($owner->id, $financial['ledgerId']);
            $this->assertSame(OwnedRecovery::FINANCIAL, array_keys($financial['tables']));
            foreach ($financial['tables'] as $rows) {
                foreach ($rows as $row) {
                    $this->assertSame($owner->id, $row['ledger_id']);
                }
            }$this->assertFalse($zip->locateName('identity.enc'));
            $this->assertFalse($zip->locateName('financial.dump'));
            $this->assertArrayNotHasKey('users', $financial['tables']);
            $zip->close();
            $this->assertSame($before, DB::table('accounting.journals')->count());
        } finally {
            foreach (scandir($root) as $name) {
                if ($name !== '.' && $name !== '..') {
                    unlink($root.'/'.$name);
                }
            }rmdir($root);
        }
    }
}
