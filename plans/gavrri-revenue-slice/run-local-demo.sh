#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
demo_dir="$(mktemp -d "${TMPDIR:-/tmp}/gavrri-sales-formats.XXXXXX")"
cp -R packages/workshop-backend/format-blueprints/workspace-* "$demo_dir/"
mkdir -p "$demo_dir/revenue-demo/files"
cp plans/gavrri-revenue-slice/gadget/client.js plans/gavrri-revenue-slice/gadget/server.js "$demo_dir/revenue-demo/files/"
cat > "$demo_dir/revenue-demo/blueprint.json" <<'JSON'
{"blueprintId":"local.demo.sales","title":"営業ノート（ローカルデモ）","description":"Local-only sales gadget, test data only.","output":{"id":"sales","noun":"Sales","plural":"Sales","icon":"chartBar"},"author":{"type":"user","name":"Local Test","id":"localtest"},"revision":1,"created":"2026-10-28T00:00:00Z","version":1,"lastUpdated":"2026-10-28T00:00:00Z","bindings":{}}
JSON
export FORMAT_BLUEPRINTS_DIR="$demo_dir"
node packages/workshop-backend/scripts/build-format-blueprints.ts
exec node scripts/run-local.ts --local-sales-demo
