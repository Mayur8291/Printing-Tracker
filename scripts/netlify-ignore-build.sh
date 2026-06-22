#!/usr/bin/env bash
# Netlify "ignore" command: exit 0 = skip build, exit 1 = run build.
# See https://docs.netlify.com/configure-builds/ignore-builds/

MSG="${COMMIT_REF_MESSAGE:-}"

if [[ "$MSG" == *"[skip netlify]"* ]]; then
  echo "Skipping Netlify build ([skip netlify] in commit message)."
  exit 0
fi

# Optional gate: skip git-triggered production builds so only build hooks deploy live.
# Enable by setting Netlify env var NETLIFY_PRODUCTION_HOOK_ONLY=true (production context).
if [[ "${NETLIFY_PRODUCTION_HOOK_ONLY:-}" == "true" && "${CONTEXT:-}" == "production" && -z "${INCOMING_HOOK_TITLE:-}" ]]; then
  echo "Skipping production git build (NETLIFY_PRODUCTION_HOOK_ONLY). Use Release to production / build hook."
  exit 0
fi

exit 1
