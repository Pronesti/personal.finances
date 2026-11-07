#!/usr/bin/env python3
"""One explicitly supplied private PDF to JSON stdout. Never scans an installation."""
import json
import sys
from pathlib import Path
from pdf_to_json import convert, UnknownLayout

if len(sys.argv) != 2:
    print('one explicit PDF path required', file=sys.stderr)
    sys.exit(2)
try:
    print(json.dumps(convert(Path(sys.argv[1])), ensure_ascii=False, allow_nan=False))
except UnknownLayout as error:
    print(json.dumps({'code': 'parser_layout_error', 'message': str(error)}), file=sys.stderr)
    sys.exit(1)
except Exception as error:
    print(json.dumps({'code': 'parser_read_error', 'kind': type(error).__name__}), file=sys.stderr)
    sys.exit(2)
