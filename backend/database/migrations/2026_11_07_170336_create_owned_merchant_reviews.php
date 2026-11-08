<?php

use App\Domain\Ledger\LedgerRepository;
use App\Domain\Reviews\MerchantReviews;
use App\Models\Ledger;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
CREATE TABLE accounting.merchant_entities (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL REFERENCES public.ledgers(id),id text NOT NULL,UNIQUE(ledger_id,id),UNIQUE(ledger_id,row_id)
);
CREATE TABLE accounting.merchant_revisions (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL REFERENCES public.ledgers(id),seq bigint GENERATED ALWAYS AS IDENTITY,
 id text NOT NULL,redirect_id text,payload jsonb NOT NULL,UNIQUE(ledger_id,row_id),
 FOREIGN KEY(ledger_id,id) REFERENCES accounting.merchant_entities(ledger_id,id),FOREIGN KEY(ledger_id,redirect_id) REFERENCES accounting.merchant_entities(ledger_id,id),CHECK(redirect_id IS NULL OR redirect_id<>id)
);
CREATE TABLE accounting.merchant_purchase_revisions (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL REFERENCES public.ledgers(id),seq bigint GENERATED ALWAYS AS IDENTITY,
 id text NOT NULL,merchant_id text NOT NULL,source_line_id text NOT NULL,card_id text NOT NULL,payload jsonb NOT NULL,UNIQUE(ledger_id,row_id),
 FOREIGN KEY(ledger_id,id) REFERENCES accounting.purchases(ledger_id,id),FOREIGN KEY(ledger_id,merchant_id) REFERENCES accounting.merchant_entities(ledger_id,id),
 FOREIGN KEY(ledger_id,source_line_id) REFERENCES accounting.source_lines(ledger_id,id),FOREIGN KEY(ledger_id,card_id) REFERENCES accounting.cards(ledger_id,id)
);
CREATE TABLE accounting.merchant_rule_revisions (
 row_id uuid PRIMARY KEY,ledger_id uuid NOT NULL REFERENCES public.ledgers(id),seq bigint GENERATED ALWAYS AS IDENTITY,
 id text NOT NULL,account_id text NOT NULL,payload jsonb NOT NULL,UNIQUE(ledger_id,row_id),FOREIGN KEY(ledger_id,account_id) REFERENCES accounting.accounts(ledger_id,id)
);
CREATE INDEX merchant_current ON accounting.merchant_revisions(ledger_id,id,seq);
CREATE INDEX merchant_purchase_current ON accounting.merchant_purchase_revisions(ledger_id,id,seq);
CREATE INDEX merchant_rule_current ON accounting.merchant_rule_revisions(ledger_id,id,seq);
CREATE TRIGGER merchant_entities_immutable BEFORE UPDATE OR DELETE ON accounting.merchant_entities FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER merchants_immutable BEFORE UPDATE OR DELETE ON accounting.merchant_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER merchant_purchases_immutable BEFORE UPDATE OR DELETE ON accounting.merchant_purchase_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
CREATE TRIGGER merchant_rules_immutable BEFORE UPDATE OR DELETE ON accounting.merchant_rule_revisions FOR EACH ROW EXECUTE FUNCTION accounting.immutable_row();
SQL);
        Ledger::query()->each(function ($ledger): void {
            $repository = new LedgerRepository($ledger);
            $repository->transaction(function () use ($repository): void {
                $reviews = new MerchantReviews($repository);
                foreach ($repository->query('source_purchase_identities')->orderBy('source_line_id')->get() as $identity) {
                    $payload = $repository->query('source_lines')->where('id', $identity->source_line_id)->value('payload');
                    $description = $payload === null ? null : (json_decode($payload, true)['description'] ?? null);
                    if (is_string($description) && trim($description) !== '') {
                        $reviews->register($identity->purchase_id, $identity->card_id, $description, $identity->source_line_id);
                    }
                }
            });
        });
    }

    public function down(): void
    {
        throw new RuntimeException('Merchant history rollback requires reviewed recovery.');
    }
};
