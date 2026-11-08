<?php

namespace Database\Seeders;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use App\Models\User;
use App\Support\TestTargetGuard;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Synthetic acceptance only. Never a production account provisioning command. */
class SyntheticAcceptanceSeeder extends Seeder
{
    public function run(): void
    {
        app(TestTargetGuard::class)->check();
        $fixture = json_decode(file_get_contents(base_path('../docs/rebuild/isolation-fixtures.json')), true, flags: JSON_THROW_ON_ERROR);
        DB::transaction(function () use ($fixture): void {
            foreach ($fixture['identities'] as $identity) {
                $user = User::where('email', $identity['email'])->first() ?? User::factory()->create(['name' => $identity['id'], 'email' => $identity['email'], 'password' => 'Synthetic-Acceptance-Only-2026!']);
                if ($user->ledger === null) {
                    Ledger::factory()->create(['id' => $identity['ledger_id'], 'owner_user_id' => $user->id]);
                }
                if ($user->ledger()->first()->id !== $identity['ledger_id']) {
                    throw new \RuntimeException('synthetic_owner_mapping_conflict');
                }
            }
            foreach ($fixture['identities'] as $identity) {
                app(CatalogBootstrap::class)->initialize(new LedgerRepository(Ledger::findOrFail($identity['ledger_id'])), json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            }
            foreach ($fixture['references'] as $reference) {
                $ledger = Ledger::findOrFail($reference['ledger_id']);
                $bytes = file_get_contents(base_path('../docs/rebuild/'.$reference['fixture']));
                $object = app(DocumentStore::class)->put($ledger, $bytes, $reference['kind'] === 'pending' ? $reference['reference_id'] : null);
                if ($object['sha256'] !== $reference['sha256'] || $object['relative_path'] !== $reference['relative_path'] || $object['byte_length'] !== $reference['bytes']) {
                    throw new \RuntimeException('synthetic_object_mismatch');
                }
                if (! DB::table('accounting.object_references')->where('ledger_id', $ledger->id)->where('kind', $reference['kind'])->where('reference_id', $reference['reference_id'])->exists()) {
                    DB::table('accounting.object_references')->insert(['row_id' => Str::uuid()->toString(), 'ledger_id' => $ledger->id, 'kind' => $reference['kind'], 'reference_id' => $reference['reference_id'], ...$object]);
                }
            }
        });
    }
}
