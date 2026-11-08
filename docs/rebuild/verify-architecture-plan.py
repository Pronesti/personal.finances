#!/usr/bin/env python3
"""Static plan checks only: does not run or validate a Laravel/React implementation."""
import json
import hashlib
import runpy
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
contract = json.loads((ROOT / "architecture-contract.json").read_text())
checks = []


def check(name, condition):
    assert condition, name
    checks.append(name)


def environment(name):
    return dict(line.split("=", 1) for line in (ROOT / name).read_text().splitlines()
                if line.strip() and not line.startswith("#"))


backend = environment("backend.env.example")
frontend = environment("frontend.env.example")
check("plan-not-implementation", contract["status"] == "plan_only_not_implemented")
check("laravel-backend-directory", contract["backend"]["directory"] == "backend" and contract["backend"]["framework"] == "Laravel")
check("versioned-api", contract["backend"]["api_prefix"] == "/api/v1")
check("react-typescript-vite-spa", all(contract["frontend"][key] == value for key, value in {
    "directory": "frontend", "framework": "React", "language": "TypeScript", "bundler": "Vite", "type": "standalone_spa"}.items()))
check("separate-builds", contract["backend"]["independent_build_and_deployment"] and contract["frontend"]["independent_build_and_deployment"])
check("direct-http", contract["frontend"]["direct_http"])
check("prohibited-coupling-recorded", {"Inertia", "Blade application screens", "Laravel React starter kit", "Next.js runtime"}.issubset(contract["prohibited"]))
auth = contract["authentication"]
check("sanctum-cookie-mode", auth["mode"] == "sanctum_cookie_session")
check("csrf-bootstrap-and-header", auth["csrf_cookie_path"] == "/sanctum/csrf-cookie" and auth["csrf_header"] == "X-XSRF-TOKEN")
check("credentialed-xsrf-client", auth["with_credentials"] and auth["with_xsrf_token"])
check("no-browser-auth-token-storage", auth["token_storage"] == [])
check("registration-provisioning-out-of-scope", auth["registration"] == "out_of_scope" and auth["account_provisioning"] == "out_of_scope")
check("multi-user-private-ledgers", contract["ownership"]["multiple_users"] and contract["ownership"]["one_private_ledger_per_user"])
check("server-owned-ledger-resolution", contract["ownership"]["ledger_from_authenticated_user"] and not contract["ownership"]["client_owner_selection"])
check("schema-extension-required", contract["ownership"]["baseline_schema_requires_extension"])
check("isolation-status", contract["ownership"]["other_owner_resource_status"] == 404)
check("owner-cache-jobs-commands", contract["ownership"]["scope_caches_jobs_deduplication_and_commands"])
identities = contract["synthetic_isolation_identities"]
check("two-distinct-test-users", len(identities) == 2 and len({u["id"] for u in identities}) == 2 and len({u["ledger_id"] for u in identities}) == 2)
check("same-parent-subdomains", urlsplit(backend["APP_URL"]).hostname.endswith(backend["SESSION_DOMAIN"]) and urlsplit(backend["FRONTEND_URL"]).hostname.endswith(backend["SESSION_DOMAIN"]))
check("different-origins", backend["APP_URL"] != backend["FRONTEND_URL"])
check("cors-exact-origin", backend["CORS_ALLOWED_ORIGINS"] == backend["FRONTEND_URL"] and "*" not in backend["CORS_ALLOWED_ORIGINS"])
check("stateful-host-no-scheme", backend["SANCTUM_STATEFUL_DOMAINS"] == urlsplit(backend["FRONTEND_URL"]).netloc)
check("cookie-domain-no-port", ":" not in backend["SESSION_DOMAIN"] and "/" not in backend["SESSION_DOMAIN"])
check("secure-http-only-lax", backend["SESSION_SECURE_COOKIE"] == "true" and backend["SESSION_HTTP_ONLY"] == "true" and backend["SESSION_SAME_SITE"] == "lax")
check("database-sessions", backend["SESSION_DRIVER"] == "database")
check("postgres-only", backend["DB_CONNECTION"] == "pgsql")
check("frontend-configured-versioned-base", frontend == {"VITE_API_BASE_URL": backend["APP_URL"] + "/api/v1"})
check("secrets-not-in-frontend", not any(key in frontend for key in ["APP_KEY", "DB_PASSWORD", "ANTHROPIC_API_KEY", "TARJETAS_DOCUMENT_ROOT"]))
health = contract["health"]
check("public-versioned-health", health["method"] == "GET" and health["path"] == "/api/v1/health" and health["public"])
check("health-json-status", health["expected_status"] == 200 and health["expected_json"] == {"status": "ok", "service": "tarjetas-api", "api_version": "v1"})
check("health-browser-proof-required-not-claimed", health["required_proof"] == "real_browser_request_from_frontend_to_api" and health["verification_status"] == "not_run_target_apps_not_implemented")
for name in ["login", "current_user", "logout"]:
    check("versioned-auth-" + name, auth[name].startswith("/api/v1/auth/"))
# Compare the contract to examples, not only examples to each other.
local = contract["local"]
check("contract-local-origins", local["frontend_origin"] == backend["FRONTEND_URL"] and local["api_origin"] == backend["APP_URL"])
check("contract-local-api-base", local["api_base_url"] == frontend["VITE_API_BASE_URL"])
check("contract-local-cors", local["cors_allowed_origins"] == backend["CORS_ALLOWED_ORIGINS"].split(","))
check("contract-local-stateful", local["sanctum_stateful_domains"] == backend["SANCTUM_STATEFUL_DOMAINS"].split(","))
check("contract-local-session-domain", local["session_domain"] == backend["SESSION_DOMAIN"])
check("health-stateless-with-cors", all(health[k] is False for k in ["stateful_middleware", "session_middleware", "database_dependency", "sets_cookie"]) and health["cors_enabled"] is True and health["browser_no_session_side_effects_required"] is True)
check("eloquent-compatible-owner-keys", contract["ownership"]["eloquent_primary_key"] == "globally_unique_row_id_uuid" and contract["ownership"]["logical_unique_key"] == ["ledger_id", "id"])
check("shared-keys-resolve-to-caller", contract["ownership"]["shared_key_status"] == 200)
viewer = contract["document_viewer"]
check("document-credentialed-blob-flow", viewer["transport"] == "credentialed_spa_blob_fetch" and viewer["direct_api_new_tab"] is False and viewer["popup_blocked_fallback"] == "second_click_blob_link" and viewer["expire_clears_cached_bytes"])
recovery = contract["recovery"]
check("recovery-owner-qualified-v2", recovery["format"] == "tarjetas-owned-recovery-v2" and recovery["reference_identity"] == ["ledger_id", "kind", "reference_id"] and recovery["owner_qualified_paths"])
check("recovery-auth-policy", recovery["identity_component"] == "separate_encrypted_users_password_hashes_and_ledger_mapping" and recovery["sessions_included"] is False and recovery["remember_tokens_cleared"] and recovery["legacy_backup_compatible_unchanged"] is False)
safety = contract["test_safety"]
check("test-guard-fail-closed", safety["driver"] == "pgsql" and all(safety[k] for k in ["guard_before_destructive_hooks", "approved_target_registry_required", "protected_database_marker_required", "resolved_config_checked", "cached_config_rejected", "browser_csrf_enabled"]) and safety["development_target_allowed"] is False)
integration = environment("backend.testing.env.example")
browser = environment("backend.browser-testing.env.example")
check("test-databases-distinct", len({e["DB_DATABASE"] for e in [backend, integration, browser]}) == 3)
check("test-roles-distinct", integration["DB_USERNAME"] and browser["DB_USERNAME"] and len({e["DB_USERNAME"] for e in [backend, integration, browser]}) == 3)
check("test-cookies-distinct", len({e["SESSION_COOKIE"] for e in [backend, integration, browser]}) == 3)
for label, env, app_env in [("integration", integration, "testing"), ("browser", browser, "browser-testing")]:
    check(label + "-target-env", env["APP_ENV"] == app_env and env["DB_CONNECTION"] == "pgsql" and env["SESSION_DRIVER"] == "database")
    check(label + "-guard-placeholders-deny", all(k in env and env[k] == "" for k in ["TARJETAS_TEST_TARGET_ID", "TARJETAS_TEST_TARGET_REGISTRY", "TARJETAS_TEST_TEMP_ROOT", "TARJETAS_DOCUMENT_ROOT", "TARJETAS_REFERENCE_DIR"]))
    check(label + "-origin-cookie-contract", env["CORS_ALLOWED_ORIGINS"] == env["FRONTEND_URL"] and env["SANCTUM_STATEFUL_DOMAINS"] == urlsplit(env["FRONTEND_URL"]).netloc and env["SESSION_DOMAIN"] != backend["SESSION_DOMAIN"] and all(urlsplit(env[k]).hostname.endswith(env["SESSION_DOMAIN"]) for k in ["APP_URL", "FRONTEND_URL"]))
limits = contract["upload_limits"]
check("exact-file-limits", limits["statement_file_bytes"] == 10 * 1024**2 and limits["receipt_file_bytes"] == 40 * 1024**2)
check("upload-envelope-headroom", limits["multipart_overhead_bytes"] == 1024**2 and limits["php_upload_max_filesize_bytes"] >= limits["receipt_file_bytes"] and min(limits["php_post_max_size_bytes"], limits["ingress_body_max_bytes"]) > limits["receipt_file_bytes"] + limits["multipart_overhead_bytes"])
check("upload-error-statuses", limits["file_over_limit_status"] == 400 and limits["body_over_limit_status"] == 413)
timeouts = contract["timeouts"]
check("bounded-ocr-request", timeouts["ocr_attempts_max"] == 3 and timeouts["ocr_attempt_max_seconds"] == 180 and timeouts["request_wall_clock_seconds"] == 720 and timeouts["non_ocr_total_max_seconds"] == 180 and timeouts["deadline_includes_intake"])
check("ordered-server-timeouts", timeouts["request_wall_clock_seconds"] < timeouts["fpm_terminate_seconds"] < timeouts["upstream_read_seconds"] < timeouts["edge_response_wait_seconds"])
check("client-budget-covers-edge-and-upload", timeouts["spa_import_timeout_ms"] / 1000 > timeouts["edge_response_wait_seconds"] + timeouts["upload_max_seconds"])
fixture = json.loads((ROOT / "isolation-fixtures.json").read_text())
check("fixture-identities-match-contract", fixture["identities"] == identities)
owner = {u["id"]: u["ledger_id"] for u in identities}
refs = fixture["references"]
check("eight-owner-references", len(refs) == 8 and len({(x["ledger_id"], x["kind"], x["reference_id"]) for x in refs}) == 8 and len({x["relative_path"] for x in refs}) == 8)
for index, ref in enumerate(refs):
    rel = Path(ref["fixture"])
    check(f"reference-safe-fixture-{index}", rel.parts[0] in ["fixtures", "isolation"] and not rel.is_absolute() and ".." not in rel.parts and not (ROOT / rel).is_symlink())
    data = (ROOT / rel).read_bytes()
    check(f"reference-content-{index}", len(data) == ref["bytes"] and hashlib.sha256(data).hexdigest() == ref["sha256"])
    tail = "objects/" + ref["sha256"] if ref["kind"] == "object" else "pending/" + ref["reference_id"] + "/" + ref["sha256"]
    check(f"reference-owner-path-{index}", ref["ledger_id"] in owner.values() and ref["kind"] in ["object", "pending"] and ref["relative_path"] == "ledgers/" + ref["ledger_id"] + "/" + tail)
for ref in refs:
    if ref["kind"] == "pending":
        check("pending-source-owner-" + ref["ledger_id"] + "-" + ref["reference_id"], bool(ref["source_revision_logical_id"]) and any(x["ledger_id"] == ref["ledger_id"] and x["kind"] == "object" and x["reference_id"] == ref["source_object_reference_id"] for x in refs))
for kind in ["object", "pending"]:
    by_owner = [{x["sha256"] for x in refs if x["ledger_id"] == u["ledger_id"] and x["kind"] == kind} for u in identities]
    check(kind + "-shared-and-exclusive-content", len(by_owner[0] & by_owner[1]) == 1 and len(by_owner[0] - by_owner[1]) == len(by_owner[1] - by_owner[0]) == 1)
rows = fixture["purchases"]
check("financial-sentinels-distinguishable", len(rows) == 4 and len({x["amount_cents"] for x in rows}) == 4 and len({x["merchant_label"] for x in rows}) == 4 and all(owner[x["user_id"]] == x["ledger_id"] for x in rows))
expected_cases = []
for user in identities:
    ledger = user["ledger_id"]
    for key in sorted({x["logical_id"] for x in rows}):
        item = next((x for x in rows if x["ledger_id"] == ledger and x["logical_id"] == key), None)
        case = {"user_id": user["id"], "resource": "purchase", "key": key, "status": 200 if item else 404}
        if item:
            case["expected"] = {k: item[k] for k in ["ledger_id", "logical_id", "amount_cents", "merchant_label"]}
        expected_cases.append(case)
    for key in sorted({x["sha256"] for x in refs if x["kind"] == "object"}):
        item = next((x for x in refs if x["ledger_id"] == ledger and x["kind"] == "object" and x["sha256"] == key), None)
        case = {"user_id": user["id"], "resource": "document", "key": key, "status": 200 if item else 404}
        if item:
            case["expected"] = {"resolved_ledger_id": ledger, "sha256": item["sha256"], "bytes": item["bytes"]}
        expected_cases.append(case)
check("access-matrix-complete-and-caller-scoped", fixture["access_cases"] == expected_cases)
for user in identities:
    own = [x for x in rows if x["ledger_id"] == user["ledger_id"]]
    report = next(x for x in fixture["expected_reports"] if x["user_id"] == user["id"])
    check("report-excludes-other-owner-" + user["id"], report["acquisition_expense_cents"] == sum(x["amount_cents"] for x in own) and report["purchase_ids"] == sorted(x["logical_id"] for x in own))
mutation = fixture["mutation"]
check("mutation-leaves-b-unchanged", mutation["actor"] == "user-a" and mutation["after"]["user-a"] == mutation["new_name"] and mutation["after"]["user-b"] == mutation["before"]["user-b"] and mutation["after"]["user-a"] != mutation["before"]["user-a"])
runpy.run_path(str(ROOT / "verify-plan-boundaries.py"))["verify"](ROOT, check)
check("fixture-financial-expected-totals", [r["acquisition_expense_cents"] for r in fixture["expected_reports"]] == [12200, 23200])
expected_recovery = fixture["expected_recovery"]
check("recovery-retains-owner-counts", expected_recovery["format"] == recovery["format"] and expected_recovery["references"] == expected_recovery["owner_qualified_paths"] == len(refs) and expected_recovery["distinct_content_digests"] == len({x["sha256"] for x in refs}) < len(refs))
check("recovery-auth-outcomes", expected_recovery["old_session_valid"] is False and expected_recovery["remember_login_valid"] is False and expected_recovery["password_hashes_preserved_in_protected_identity_component"] and expected_recovery["new_login_resolves_original_ledger"])

architecture = (ROOT / "architecture.md").read_text()
readme = (ROOT / "README.md").read_text()
for requirement in ["ledger_id", "composite FKs", "CSRF", "statefulApi", "VITE_API_BASE_URL", "Idempotency-Key", "frontend/dist", "lerd composer", "lerd php", "Node 24", "macOS", "OpenAPI", "production", "404", "419"]:
    check("documented-" + requirement, requirement in architecture)
check("main-plan-links-authoritative-architecture", "[Laravel and React architecture specification](architecture.md)" in readme)
check("no-stale-no-login-build-instruction", "English default and no login" not in readme)
check("no-stale-server-action-build-instruction", "Most financial edits use server actions" not in readme)
print(json.dumps({"static_plan_only": True, "passed": len(checks), "checks": checks,
                  "unverified": ["target API health reachability", "target Sanctum browser authentication", "target multi-user isolation", "target PostgreSQL test guard", "target owner-aware restore", "target HTTP upload limits and processing deadlines"]}, indent=2))
