#!/usr/bin/env python3
"""Reject synthetic regressions through in-memory overlays; never copy the project."""
import json
from pathlib import Path
import contextlib
import io
import runpy
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

def json_change(path, change):
    data = json.loads(path.read_text())
    change(data)
    path.write_text(json.dumps(data, indent=2) + "\n")

def env_change(path, old, new):
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))

cases = [
    ("upload_expiry_lets_completion_win", "verify-plan-boundaries.py", lambda p: env_change(p, "if upload >= upload_limit:", "if upload > upload_limit:"), "exact-upload-expiry-rejects-normal"),
    ("upload_guard_disabled_in_fault_harness", "verify-plan-boundaries.py", lambda p: env_change(p, "if upload >= upload_limit:", "if enforce_non_ocr and upload >= upload_limit:"), "exact-upload-expiry-rejects-outer_watchdog_fault_injection"),
    ("exact_upload_uses_non_ocr_diagnostic", "deadline-fixtures.json", lambda p: json_change(p, lambda f: next(x for x in f["cases"] if x["name"] == "upload_at_expiry_normal")["expected"].update(status=504, code="non_ocr_budget_exceeded")), "deadline-case-outcome-upload_at_expiry_normal"),
    ("exact_upload_fault_mode_can_post", "deadline-fixtures.json", lambda p: json_change(p, lambda f: next(x for x in f["cases"] if x["name"] == "upload_at_expiry_fault_injection")["expected"].update(status=200, code="ok", backend_started=True, financial_postings=1)), "deadline-case-outcome-upload_at_expiry_fault_injection"),
    ("queue_not_charged_by_oracle", "verify-plan-boundaries.py", lambda p: env_change(p, "entry = upload + case['upstream_queue_ms']", "entry = upload"), "non-ocr-regression-rejects-before-backend-entry"),
    ("non_ocr_pre_dispatch_guard_removed", "verify-plan-boundaries.py", lambda p: env_change(p, "if enforce_non_ocr and entry >= non_ocr_limit:", "if False and entry >= non_ocr_limit:"), "non-ocr-regression-rejects-before-backend-entry"),
    ("non_ocr_counter_reset_at_backend", "verify-plan-boundaries.py", lambda p: env_change(p, "non_ocr = entry", "non_ocr = 0"), "deadline-case-outcome-buffered_upload_then_success"),
    ("expired_queue_allowed_to_post", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][7]["expected"].update(status=200, code="ok", backend_started=True, finished_elapsed_ms=182000, financial_postings=1)), "deadline-case-outcome-upload_and_queue_exhaust_non_ocr_before_dispatch"),
    ("normal_queue_uses_outer_watchdog_expectation", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][2]["expected"].update(code="request_deadline_exceeded", finished_elapsed_ms=720000)), "deadline-case-outcome-upstream_queue_exhausts_non_ocr_budget"),
    ("cleanup_not_charged", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][11].update(cleanup_ms=0)), "deadline-case-outcome-cleanup_uses_remaining_non_ocr_budget"),
    ("normal_case_disables_phase_guard", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][2].update(mode="outer_watchdog_fault_injection", fault_injection={"test_harness_only":True,"disabled_guards":["non_ocr_budget"]})), "deadline-test-mode-upstream_queue_exhausts_non_ocr_budget"),
    ("client_can_disable_phase_guards", "architecture-contract.json", lambda p: json_change(p, lambda c: c["non_ocr_budget_accounting"].update(client_may_disable_guards=True)), "non-ocr-no-client-bypass"),
    ("fk_negative_uses_shared_account", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["cross_owner_reference"]["attempted_child_key"].__setitem__(1, f["shared_account_id"])), "fk-negative-tuple-really-absent"),
    ("fk_wrong_sqlstate", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["cross_owner_reference"].update(expected_sqlstate="23000")), "fk-exact-database-error-and-no-write-oracle"),
    ("application_rejection_counted_as_fk_proof", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["cross_owner_reference"].update(application_rejection_counts_as_database_proof=True)), "fk-exact-database-error-and-no-write-oracle"),
    ("fk_shared_positive_resolves_wrong_owner", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["database_reference_controls"][0].update(resolved_owner_ledger_id=f["identities"][1]["ledger_id"])), "fk-shared-and-exclusive-positive-controls"),
    ("browser_cookie_under_development_parent", "backend.browser-testing.env.example", lambda p: env_change(p, "tarjetas-browser.test", "browser.tarjetas.test"), "cookie-domain-excludes-development-from-browser"),
    ("integration_cookie_under_development_parent", "backend.testing.env.example", lambda p: env_change(p, "tarjetas-integration.test", "integration.tarjetas.test"), "cookie-domain-excludes-development-from-integration"),
    ("deadline_starts_after_buffering", "architecture-contract.json", lambda p: json_change(p, lambda c: c["ingress_deadline"].update(start_event="php_entry_after_buffering")), "deadline-origin-before-any-buffering"),
    ("deadline_restarts_at_backend", "architecture-contract.json", lambda p: json_change(p, lambda c: c["ingress_deadline"].update(backend_may_reset_deadline=True)), "deadline-never-reset-at-backend-or-worker"),
    ("client_deadline_trusted", "architecture-contract.json", lambda p: json_change(p, lambda c: c["ingress_deadline"].update(client_metadata_policy="trust_client_header")), "deadline-trusted-metadata-and-spoofing-policy"),
    ("edge_total_timer_disabled", "architecture-contract.json", lambda p: json_change(p, lambda c: c["ingress_deadline"].update(edge_total_timer_required=False)), "deadline-edge-timers-and-cancellation"),
    ("buffered_upload_budget_restarted", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][1]["expected"].update(processing_budget_ms=719000)), "deadline-case-outcome-buffered_upload_then_processing_timeout"),
    ("overdue_worker_allowed_to_post", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][1]["expected"].update(status=200, code="ok", finished_elapsed_ms=770000, financial_postings=1, worker_cancelled=False)), "deadline-case-outcome-buffered_upload_then_processing_timeout"),
    ("missing_trusted_stamp_allowed", "deadline-fixtures.json", lambda p: json_change(p, lambda f: f["cases"][5]["expected"].update(status=200, code="ok", financial_postings=1)), "deadline-case-outcome-missing_trusted_metadata_fails_before_processing"),
    ("contract_origin_drift", "architecture-contract.json", lambda p: json_change(p, lambda c: c["local"].update(api_origin="https://wrong.example.invalid")), "contract-local-origins"),
    ("health_stateful", "architecture-contract.json", lambda p: json_change(p, lambda c: c["health"].update(stateful_middleware=True)), "health-stateless-with-cors"),
    ("raw_document_navigation", "architecture-contract.json", lambda p: json_change(p, lambda c: c["document_viewer"].update(direct_api_new_tab=True)), "document-credentialed-blob-flow"),
    ("session_recovery", "architecture-contract.json", lambda p: json_change(p, lambda c: c["recovery"].update(sessions_included=True)), "recovery-auth-policy"),
    ("unsafe_test_database", "backend.testing.env.example", lambda p: env_change(p, "DB_DATABASE=tarjetas_integration_disposable", "DB_DATABASE=tarjetas_rebuild"), "test-databases-distinct"),
    ("forced_sqlite", "backend.testing.env.example", lambda p: env_change(p, "DB_CONNECTION=pgsql", "DB_CONNECTION=sqlite"), "integration-target-env"),
    ("missing_multipart_headroom", "architecture-contract.json", lambda p: json_change(p, lambda c: c["upload_limits"].update(ingress_body_max_bytes=41943040)), "upload-envelope-headroom"),
    ("short_proxy_timeout", "architecture-contract.json", lambda p: json_change(p, lambda c: c["timeouts"].update(upstream_read_seconds=60)), "ordered-server-timeouts"),
    ("swapped_reference_owner", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["references"][0].update(ledger_id=f["identities"][1]["ledger_id"])), "eight-owner-references"),
    ("shared_key_wrongly_not_found", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["access_cases"][2].update(status=404)), "access-matrix-complete-and-caller-scoped"),
    ("report_includes_both_users", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["expected_reports"][0].update(acquisition_expense_cents=sum(x["amount_cents"] for x in f["purchases"]))), "report-excludes-other-owner-user-a"),
    ("cross_owner_mutation", "isolation-fixtures.json", lambda p: json_change(p, lambda f: f["mutation"]["after"].update({"user-b":"Pantry A changed"})), "mutation-leaves-b-unchanged"),
]
class TextVariant:
    """One mutated text value, with the small interface used by existing cases."""
    def __init__(self, value):
        self.value = value

    def read_text(self):
        return self.value

    def write_text(self, value):
        self.value = value


def verify_variant(target=None, variant=None):
    """Read unchanged inputs from this checkout; overlay at most one file in RAM."""
    original_read_text = Path.read_text
    target_path = (ROOT / target).resolve() if target else None

    def read_text(path, *args, **kwargs):
        if target_path is not None and path.resolve() == target_path:
            return variant.read_text()
        return original_read_text(path, *args, **kwargs)

    def execute_script(path, init_globals=None, run_name=None):
        path = Path(path).resolve()
        assert path in {ROOT / 'verify-architecture-plan.py', ROOT / 'verify-plan-boundaries.py'}, path
        namespace = dict(init_globals or {})
        namespace.update(__file__=str(path), __name__=run_name or '<run_path>')
        exec(compile(read_text(path), str(path), 'exec'), namespace)
        return namespace

    def no_write(*args, **kwargs):
        raise AssertionError('Static regression checks must not write project files')

    with patch.object(Path, 'read_text', read_text), patch.object(runpy, 'run_path', execute_script), \
            patch.object(Path, 'write_text', no_write), patch.object(Path, 'write_bytes', no_write), \
            contextlib.redirect_stdout(io.StringIO()):
        execute_script(ROOT / 'verify-architecture-plan.py')


verify_variant()
passed = []
for name, target, mutate, diagnostic in cases:
    variant = TextVariant((ROOT / target).read_text())
    mutate(variant)
    try:
        verify_variant(target, variant)
    except AssertionError as error:
        assert diagnostic in str(error), (name, diagnostic, str(error))
    else:
        raise AssertionError((name, 'Regression was not rejected'))
    passed.append(name)
print(json.dumps({"static_plan_only": True, "execution": "in_memory_single_file_overlays",
                  "project_copies_created": 0,
                  "rejected_regressions": len(passed), "checks": passed}, indent=2))
