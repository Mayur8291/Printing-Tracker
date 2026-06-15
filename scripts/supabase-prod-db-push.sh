#!/usr/bin/env bash
# Apply migrations to linked Supabase project. Repairs orphan remote history when CLI suggests it.
set -euo pipefail

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN not set — skip db push."
  exit 0
fi

if [ -z "${SUPABASE_PROD_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROD_PROJECT_REF not set."
  exit 1
fi

supabase link --project-ref "$SUPABASE_PROD_PROJECT_REF"

log="$(mktemp)"
set +e
supabase db push 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -eq 0 ]; then
  rm -f "$log"
  exit 0
fi

if grep -q "migration repair --status reverted" "$log"; then
  versions="$(sed -n 's/.*migration repair --status reverted //p' "$log" | head -1)"
  if [ -n "$versions" ]; then
    echo "Repairing orphan remote migration entries: $versions"
    # shellcheck disable=SC2086
    supabase migration repair --status reverted $versions
    supabase db push
    rm -f "$log"
    exit 0
  fi
fi

echo "supabase db push failed:"
cat "$log"
rm -f "$log"
exit 1
