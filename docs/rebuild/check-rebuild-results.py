#!/usr/bin/env python3
"""Compare a rebuild's portable report output without importing the reference app."""
from pathlib import Path
import argparse
import json
import math


def compare(actual, expected, path="$", counts=None):
    counts = counts if counts is not None else {"leaves": 0}
    if isinstance(expected, dict):
        assert isinstance(actual, dict) and actual.keys() == expected.keys(), f"{path}: object keys differ"
        for key in expected:
            compare(actual[key], expected[key], path + "." + key, counts)
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), f"{path}: array length differs"
        for index, value in enumerate(expected):
            compare(actual[index], value, f"{path}[{index}]", counts)
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), f"{path}: number required"
        assert math.isfinite(actual), f"{path}: finite number required"
        if isinstance(expected, int):
            assert actual == expected, f"{path}: {actual} != {expected}"
        else:
            assert abs(actual - expected) <= 1e-9 * max(1, abs(expected)), f"{path}: {actual} != {expected}"
        counts["leaves"] += 1
    else:
        assert type(actual) is type(expected) and actual == expected, f"{path}: value/type differs"
        counts["leaves"] += 1
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("actual", type=Path, help="Rebuild projection JSON from report-input.json")
    args = parser.parse_args()
    expected = Path(__file__).resolve().parent / "fixtures/reports.expected.json"
    counts = compare(json.loads(args.actual.read_text()), json.loads(expected.read_text()))
    print(json.dumps({"match": True, **counts}))
