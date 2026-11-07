#!/usr/bin/env python3
"""Verify a standalone rebuild handoff without the original app or external packages."""
from pathlib import Path
import hashlib
import json
import re
from datetime import date

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures"
manifest = json.loads((FIXTURES / "manifest.json").read_text())
actual_files = {p.relative_to(FIXTURES).as_posix() for p in FIXTURES.rglob("*") if p.is_file() and p.name != "manifest.json"}
assert actual_files == set(manifest["files"]), "Manifest file set differs"
for name, expected in manifest["files"].items():
    relative = Path(name)
    assert not relative.is_absolute() and ".." not in relative.parts, name
    file = FIXTURES / relative
    assert not file.is_symlink(), name
    data = file.read_bytes()
    assert len(data) == expected["bytes"], f"{name}: size differs"
    assert hashlib.sha256(data).hexdigest() == expected["sha256"], f"{name}: hash differs"
    if file.suffix == ".json":
        json.loads(data)
context = ROOT.parent / "project-context-prompt.md"
assert hashlib.sha256(context.read_bytes()).hexdigest() == manifest["context_sha256"], "Context prompt changed"
routes = json.loads((FIXTURES / "routes.json").read_text())
assert len(routes) == 32
readme = (ROOT / "README.md").read_text()
for route in routes:
    assert "`" + route + "`" in readme, f"Route not specified: {route}"
expected_documents = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*")
                      if p.is_file() and "fixtures" not in p.relative_to(ROOT).parts
                      and "__pycache__" not in p.parts}
assert set(manifest["documents"]) == expected_documents, "Document manifest file set differs"
for name, expected in manifest["documents"].items():
    relative = Path(name)
    assert not relative.is_absolute() and ".." not in relative.parts, name
    assert not (ROOT / relative).is_symlink(), name
    data = (ROOT / relative).read_bytes()
    if relative.suffix == ".json":
        json.loads(data)
    assert len(data) == expected["bytes"] and hashlib.sha256(data).hexdigest() == expected["sha256"], f"Document changed: {name}"
for name in ["README.md", "START-HERE.md", "architecture.md", "implementation-safeguards.md", "../project-context-prompt.md"]:
    value = (ROOT / name).read_text()
    assert len(re.findall(r"^```", value, re.M)) % 2 == 0, name
    assert not any(line.rstrip() != line for line in value.splitlines()), name
catalog = json.loads((FIXTURES / "catalog.json").read_text())
ids = [a["id"] for a in catalog["accounts"]]
assert len(ids) == len(set(ids))
assert len(catalog["groups"]) == 11
for account in catalog["accounts"]:
    assert account["parentId"] is None or account["parentId"] in ids
def validate(schema, value, location="$"):
    """Validate the keywords used by this packaged schema without third-party dependencies."""
    kinds = schema.get("type", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    matches = {"object": isinstance(value, dict), "array": isinstance(value, list),
               "string": isinstance(value, str), "null": value is None,
               "number": isinstance(value, (int, float)) and not isinstance(value, bool),
               "integer": isinstance(value, int) and not isinstance(value, bool),
               "boolean": isinstance(value, bool)}
    assert not kinds or any(matches[k] for k in kinds), f"{location}: wrong schema type"
    if "enum" in schema:
        assert value in schema["enum"], f"{location}: wrong enum"
    if isinstance(value, dict):
        assert set(schema.get("required", [])).issubset(value), f"{location}: missing fields"
        for key, child in schema.get("properties", {}).items():
            if key in value:
                validate(child, value[key], location + "." + key)
    if isinstance(value, list):
        for index, item in enumerate(value):
            validate(schema.get("items", {}), item, f"{location}[{index}]")
    if isinstance(value, str):
        assert "pattern" not in schema or re.search(schema["pattern"], value), location
        if schema.get("format") == "date":
            assert date.fromisoformat(value).isoformat() == value, location

schema = json.loads((FIXTURES / "schemas/statement-extraction.schema.json").read_text())
for brand in ["visa", "mastercard", "mercadopago"]:
    value = json.loads((FIXTURES / f"{brand}.expected.json").read_text())
    assert (FIXTURES / "pdf" / value["file"]).read_bytes().startswith(b"%PDF-")
    assert all({"voucher", "raw_line", "block_cardholder"}.issubset(line) for line in value["transactions"])
    validate(schema, value)
print(json.dumps({"ok": True, "hashed_fixtures": len(actual_files), "page_routes": len(routes), "seed_accounts": len(ids), "primary_groups": len(catalog["groups"])}, indent=2))
