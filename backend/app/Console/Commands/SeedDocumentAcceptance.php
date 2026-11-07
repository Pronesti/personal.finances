<?php

namespace App\Console\Commands;

use App\Domain\Evidence\DocumentStore;
use App\Domain\Ledger\CatalogBootstrap;
use App\Domain\Ledger\LedgerRepository;
use App\Models\Ledger;
use App\Models\User;
use App\Support\TestTargetGuard;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/** Fresh factory dataset keeps exclusive hashes exclusive during the document journey. */
class SeedDocumentAcceptance extends Command
{
    protected $signature = 'tarjetas:acceptance:document-users';

    protected $description = 'Create a fresh pair of guarded factory document-isolation ledgers';

    public function handle(TestTargetGuard $guard, DocumentStore $documents): int
    {
        $guard->check();
        $fixtures = json_decode(file_get_contents(base_path('../docs/rebuild/isolation-fixtures.json')), true);
        $emails = [];
        foreach ($fixtures['identities'] as $index => $identity) {
            $label = $index === 0 ? 'a' : 'b';
            $email = 'synthetic-documents-'.$label.'-'.Str::uuid().'@example.invalid';
            $user = User::factory()->create(['email' => $email, 'name' => 'Synthetic document owner '.$label, 'password' => 'Synthetic-Acceptance-Only-2026!']);
            $ledger = Ledger::factory()->create(['owner_user_id' => $user->id]);
            $repository = new LedgerRepository($ledger);
            app(CatalogBootstrap::class)->initialize($repository, json_decode(file_get_contents(base_path('../docs/rebuild/fixtures/cards.json')), true));
            $repository->transaction(function () use ($fixtures, $identity, $ledger, $repository, $documents) {
                foreach ($fixtures['references'] as $reference) {
                    if ($reference['ledger_id'] !== $identity['ledger_id']) {
                        continue;
                    }
                    $object = $documents->put($ledger, file_get_contents(base_path('../docs/rebuild/'.$reference['fixture'])), $reference['kind'] === 'pending' ? $reference['reference_id'] : null);
                    if ($object['sha256'] !== $reference['sha256'] || $object['byte_length'] !== $reference['bytes']) {
                        throw new \RuntimeException('synthetic_object_mismatch');
                    }
                    $repository->insert('object_references', ['kind' => $reference['kind'], 'reference_id' => $reference['reference_id'], ...$object]);
                }
            });
            $emails[$label] = $email;
        }
        $this->line(json_encode($emails));

        return self::SUCCESS;
    }
}
