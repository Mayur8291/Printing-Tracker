#!/usr/bin/env bash
# Apply migrations to linked Supabase project. Repairs orphan remote history when CLI suggests it.
set -u

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN not set — skip db push."
  exit 0
fi

if [ -z "${SUPABASE_PROD_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROD_PROJECT_REF not set."
  exit 1
fi

export SUPABASE_INTERNAL_DISABLE_TELEMETRY="${SUPABASE_INTERNAL_DISABLE_TELEMETRY:-1}"

link_args=(--project-ref "$SUPABASE_PROD_PROJECT_REF")
if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
  link_args+=(--password "$SUPABASE_DB_PASSWORD")
fi

echo "Linking Supabase project ${SUPABASE_PROD_PROJECT_REF}..."
if ! supabase link "${link_args[@]}"; then
  echo "supabase link failed."
  exit 1
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

echo "Running supabase db push..."
set +e
supabase db push 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -eq 0 ]; then
  echo "Database migrations applied."
  exit 0
fi

if grep -q "migration repair --status reverted" "$log" 2>/dev/null; then
  versions="$(sed -n 's/.*migration repair --status reverted //p' "$log" | head -1)"
  if [ -n "$versions" ]; then
    echo "Repairing orphan remote migration entries: $versions"
    # shellcheck disable=SC2086
    supabase migration repair --status reverted $versions
    if supabase db push; then
      echo "Database migrations applied after repair."
      exit 0
    fi
  fi
fi

if grep -q "Rerun the command with --include-all flag" "$log" 2>/dev/null; then
  echo "Out-of-order local migrations detected — retrying with --include-all..."
  if supabase db push --include-all; then
    echo "Database migrations applied (include-all)."
    exit 0
  fi
fi

echo "supabase db push failed (exit ${status}):"
cat "$log"
exit 1
