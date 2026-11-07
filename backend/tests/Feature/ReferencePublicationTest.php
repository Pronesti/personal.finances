<?php

namespace Tests\Feature;

use App\Domain\Ledger\FinancialCommands;
use App\Domain\Reports\ReferencePublisher;
use App\Domain\Reports\ReferenceTables;
use App\Support\PrivateRoots;
use Illuminate\Support\Facades\DB;
use Tests\PostgresTestCase;

class ReferencePublicationTest extends PostgresTestCase
{
    public function test_local_publication_is_complete_versioned_reloadable_and_changes_no_native_money(): void
    {
        $root = PrivateRoots::canonical((string) config('tarjetas.test_target.temp_root')).'/references-'.bin2hex(random_bytes(8));
        mkdir($root, 0700);
        $data = json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/references.json')), true);
        foreach (['cpi' => 'ipc.json', 'mep' => 'mep.json'] as $name => $file) {
            file_put_contents($root.'/'.$file, json_encode($data[$name]));
            chmod($root.'/'.$file, 0600);
        }
        config(['tarjetas.reference_root' => $root]);
        $reader = new ReferenceTables;
        $old = $reader->read();
        $before = DB::table('accounting.journals')->count();
        $new = $old;
        $new['mep'][array_key_last($new['mep'])] += 1;
        $new['cpi'][array_key_last($new['cpi'])] += 2;
        $input = $root.'/new.json';
        file_put_contents($input, json_encode($new));
        chmod($input, 0600);
        $result = (new ReferencePublisher)->publish($input, FinancialCommands::digest($old));
        $this->assertSame($new, $reader->read());
        $this->assertSame(FinancialCommands::digest($new), $result['fingerprint']);
        $this->assertSame(hash_file('sha256', $input), $result['sourceSha256']);
        $this->assertSame($before, DB::table('accounting.journals')->count());
        $this->assertFileExists($root.'/release-'.$result['version'].'/ipc.json');
        $this->assertFileExists($root.'/release-'.$result['version'].'/mep.json');
        try {
            (new ReferencePublisher)->publish($input, FinancialCommands::digest($old));
            $this->fail('stale update accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('stale_reference_version', $e->getMessage());
        }
        file_put_contents($input, json_encode(['cpi' => ['2026-01' => -1], 'mep' => $new['mep']]));
        try {
            (new ReferencePublisher)->publish($input, FinancialCommands::digest($new));
            $this->fail('invalid rates accepted');
        } catch (\RuntimeException $e) {
            $this->assertSame('invalid_report_rate', $e->getMessage());
        }
        $this->assertSame($new, $reader->read());
        $paths = $reader->files();
        file_put_contents($paths['cpi'], '{}');
        $this->expectExceptionMessage('references_unavailable');
        $reader->read();
    }
}
