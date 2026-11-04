#!/bin/sh
set -eu

web_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$web_root"
private_launcher="$web_root/../data/accounting/runtime/start-web.sh"
if [ -x "$private_launcher" ]; then
    exec "$private_launcher" "$@"
fi
exec npm run dev -- "$@"
