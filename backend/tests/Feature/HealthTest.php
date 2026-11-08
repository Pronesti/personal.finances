<?php

namespace Tests\Feature;

use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Session\Middleware\StartSession;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Tests\TestCase;

class HealthTest extends TestCase
{
    public function test_health_is_stateless_for_spa_requests_even_with_an_unreachable_database(): void
    {
        config(['database.connections.pgsql.port' => 1, 'cors.allowed_origins' => ['https://app.tarjetas.test']]);
        $response = $this->withHeaders(['Origin' => 'https://app.tarjetas.test', 'Referer' => 'https://app.tarjetas.test/login', 'Cookie' => 'tarjetas_v1_session=old'])->getJson('/api/v1/health');
        $response->assertOk()->assertExactJson(['status' => 'ok', 'service' => 'tarjetas-api', 'api_version' => 'v1'])->assertHeader('Access-Control-Allow-Origin', 'https://app.tarjetas.test');
        $this->assertSame([], $response->headers->all('set-cookie'));
        $route = app('router')->getRoutes()->getByName('api.v1.health');
        foreach ([StartSession::class, EnsureFrontendRequestsAreStateful::class, AddQueuedCookiesToResponse::class] as $middleware) {
            $this->assertNotContains($middleware, app('router')->gatherRouteMiddleware($route));
        }
        $this->withHeaders(['Origin' => 'https://app.tarjetas.test', 'Access-Control-Request-Method' => 'GET'])->options('/api/v1/health')->assertNoContent()->assertHeader('Access-Control-Allow-Origin', 'https://app.tarjetas.test');
    }

    public function test_untrusted_origin_has_no_cors_permission_and_unknown_api_is_json(): void
    {
        config(['cors.allowed_origins' => ['https://app.tarjetas.test']]);
        $this->withHeader('Origin', 'https://untrusted.test')->getJson('/api/v1/health')->assertOk()->assertHeader('Access-Control-Allow-Origin', 'https://app.tarjetas.test');
        config(['app.env' => 'local']);
        $this->getJson('/api/v1/unknown')->assertNotFound()->assertJsonPath('error.code', 'not_found');
        $this->getJson('/')->assertNotFound();
    }
}
