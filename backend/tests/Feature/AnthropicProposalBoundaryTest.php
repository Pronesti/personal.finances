<?php

namespace Tests\Feature;

use App\Domain\Ledger\AccountingError;
use App\Domain\Processing\ProcessingBudget;
use App\Domain\Reviews\AnthropicProposals;
use App\Domain\Reviews\MerchantProposalProvider;
use Illuminate\Http\Client\Factory;
use Illuminate\Support\Facades\Http;
use Tests\PostgresTestCase;

class AnthropicProposalBoundaryTest extends PostgresTestCase
{
    public function test_configured_provider_sends_only_sanitized_names_and_fixed_taxonomy_and_validates_output(): void
    {
        Http::preventStrayRequests();
        config(['tarjetas.proposal_driver' => 'anthropic', 'tarjetas.anthropic_key' => 'synthetic-key-not-real', 'tarjetas.anthropic_model' => 'synthetic-model']);
        Http::fake(['https://api.anthropic.com/v1/messages' => Http::response(['stop_reason' => 'end_turn', 'content' => [['type' => 'text', 'text' => json_encode([['name' => 'SYNTHETIC SHOP', 'purpose' => 'food', 'confidence' => 0.4]])]]])]);
        $provider = app(MerchantProposalProvider::class);
        $this->assertInstanceOf(AnthropicProposals::class, $provider);
        $result = $provider->suggest(['SYNTHETIC SHOP']);
        $this->assertSame('food', $result[0]['purposeId']);
        $this->assertSame(0.4, $result[0]['confidence']);
        $this->assertSame('SYNTHETIC SHOP', $result[0]['name']);
        Http::assertSent(function ($request) {
            $data = $request->data();
            $this->assertSame(['model', 'max_tokens', 'stream', 'system', 'messages'], array_keys($data));
            $this->assertSame('synthetic-model', $data['model']);
            $this->assertSame([['role' => 'user', 'content' => '["SYNTHETIC SHOP"]']], $data['messages']);
            $this->assertFalse($data['stream']);
            $this->assertStringNotContainsString('synthetic-key-not-real', json_encode($data));
            $this->assertStringNotContainsString('accountId', $data['system']);
            $this->assertSame(['2026-10-21'], $request->header('anthropic-version'));

            return true;
        });
        Http::assertSentCount(1);
    }

    public function test_missing_configuration_unsafe_names_provider_failure_and_invalid_or_truncated_output_fail_closed(): void
    {
        Http::preventStrayRequests();
        Http::fake();
        config(['tarjetas.anthropic_key' => null, 'tarjetas.anthropic_model' => null]);
        try {
            (new AnthropicProposals)->suggest(['SYNTHETIC SHOP']);
            $this->fail('Missing key admitted');
        } catch (AccountingError $error) {
            $this->assertSame('proposals_unavailable', $error->errorCode);
        }Http::assertNothingSent();
        config(['tarjetas.anthropic_key' => 'synthetic-key-not-real', 'tarjetas.anthropic_model' => 'synthetic-model']);
        foreach ([['SYNTHETIC 123,45'], ['SYNTHETIC 123456789'], array_fill(0, 201, 'SYNTHETIC')] as $names) {
            try {
                (new AnthropicProposals)->suggest($names);
                $this->fail('Unsafe names admitted');
            } catch (AccountingError $error) {
                $this->assertSame('invalid_proposal_response', $error->errorCode);
            }
        }Http::assertNothingSent();
        foreach ([['status' => 503, 'body' => ['secret' => 'must never propagate'], 'code' => 'proposal_service_failed'], ['status' => 200, 'body' => ['stop_reason' => 'max_tokens', 'content' => [['type' => 'text', 'text' => '[]']]], 'code' => 'invalid_proposal_response'], ['status' => 200, 'body' => ['stop_reason' => 'end_turn', 'content' => [['type' => 'text', 'text' => 'not JSON']]], 'code' => 'invalid_proposal_response'], ['status' => 200, 'body' => ['stop_reason' => 'end_turn', 'content' => [['type' => 'text', 'text' => '[{"name":"UNKNOWN","purpose":"food","confidence":1}]']]], 'code' => 'invalid_proposal_response']] as $case) {
            Http::swap(new Factory);
            Http::preventStrayRequests();
            Http::fake(['https://api.anthropic.com/v1/messages' => Http::response($case['body'], $case['status'])]);
            try {
                (new AnthropicProposals)->suggest(['SYNTHETIC SHOP']);
                $this->fail('Bad provider response admitted');
            } catch (AccountingError $error) {
                $this->assertSame($case['code'], $error->errorCode);
                $this->assertStringNotContainsString('must never propagate', $error->getMessage());
            }
        }
    }

    public function test_expired_original_budget_prevents_any_provider_dispatch(): void
    {
        Http::preventStrayRequests();
        Http::fake();
        config(['tarjetas.anthropic_key' => 'synthetic-key-not-real', 'tarjetas.anthropic_model' => 'synthetic-model']);
        $time = 0;
        $budget = new ProcessingBudget(10, 0, function () use (&$time) {
            return $time;
        });
        $time = 10;
        try {
            (new AnthropicProposals($budget))->suggest(['SYNTHETIC SHOP']);
            $this->fail('Expired request dispatched');
        } catch (AccountingError $error) {
            $this->assertSame('processing_timeout', $error->errorCode);
        }Http::assertNothingSent();
    }
}
