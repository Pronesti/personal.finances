<?php

namespace App\Support;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/** No writes, schema initialization or cleanup are permitted inside this guard. */
class TestTargetGuard
{
    public function __construct(private Application $app) {}

    public function check(): void
    {
        try {
            $this->verify();
        } catch (Throwable $exception) {
            // Never include connection strings, credentials or database exception text.
            throw new RuntimeException('Disposable PostgreSQL target refused: '.(str_starts_with($exception->getMessage(), 'test_target_') ? $exception->getMessage() : 'identity_probe_failed').'.');
        }
    }

    private function verify(): void
    {
        if ($this->app->configurationIsCached() || ! in_array(config('app.env'), ['testing', 'browser-testing'], true) || config('database.default') !== 'pgsql' || config('session.driver') !== 'database') {
            throw new RuntimeException('test_target_configuration');
        }
        $registry = config('tarjetas.test_target.registry');
        if (! is_string($registry) || ! str_starts_with($registry, '/') || realpath($registry) !== $registry || is_link($registry) || ! is_file($registry) || (fileperms($registry) & 0222) !== 0) {
            throw new RuntimeException('test_target_registry');
        }
        $data = json_decode(file_get_contents($registry), true, flags: JSON_THROW_ON_ERROR);
        $target = $data['targets'][config('tarjetas.test_target.id')] ?? null;
        if (! is_array($target) || ($target['approved'] ?? false) !== true || ! isset($target['protected_roots']) || ! is_array($target['protected_roots'])) {
            throw new RuntimeException('test_target_unapproved');
        }
        $connection = DB::connection();
        foreach (['driver' => 'pgsql', 'host' => $target['host'], 'port' => $target['port'], 'database' => $target['database'], 'username' => $target['role']] as $key => $expected) {
            if ((string) $connection->getConfig($key) !== (string) $expected) {
                throw new RuntimeException('test_target_connection');
            }
        }
        $roots = ['documents' => config('tarjetas.document_root'), 'references' => config('tarjetas.reference_root'), 'temp' => config('tarjetas.test_target.temp_root')];
        if ($roots !== $target['roots'] || $target['environment'] !== config('app.env')) {
            throw new RuntimeException('test_target_environment');
        }
        PrivateRoots::assertDisjoint(array_values($roots), $target['protected_roots']);
        $connection->transaction(function () use ($connection, $target): void {
            $connection->statement('SET TRANSACTION READ ONLY');
            $connection->statement("SET LOCAL statement_timeout = '3000ms'");
            $identity = $connection->selectOne("SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('cluster_name') AS server_id");
            foreach (['database', 'role', 'host', 'port', 'server_id'] as $key) {
                if ((string) $identity->$key !== (string) $target[$key]) {
                    throw new RuntimeException('test_target_server_identity_'.$key);
                }
            }
            $marker = $connection->selectOne('SELECT marker::text, environment FROM test_safety.target');
            if ($marker === null || $marker->marker !== $target['marker'] || $marker->environment !== $target['environment']) {
                throw new RuntimeException('test_target_marker');
            }
            $role = $connection->selectOne('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user');
            if (array_filter((array) $role)) {
                throw new RuntimeException('test_target_privileged_role');
            }
            $unsafe = $connection->selectOne("SELECT has_schema_privilege(current_user, 'test_safety', 'CREATE') OR has_table_privilege(current_user, 'test_safety.target', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_database WHERE NOT datistemplate AND datname <> current_database() AND has_database_privilege(current_user, oid, 'CONNECT')) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) OR EXISTS(SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS unsafe");
            if ($unsafe->unsafe) {
                throw new RuntimeException('test_target_unprotected_marker_or_role');
            }
        });
    }
}
