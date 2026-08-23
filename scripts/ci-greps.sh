#!/usr/bin/env bash
# CI boundary greps — enforce the CLAUDE.md "Admin boundary" + hard-rule invariants
# without a DB. Convention: FOUND a violation = exit 1 (fail); NOT-found = pass.
# Run from repo root: bash scripts/ci-greps.sh
set -uo pipefail

fail=0
SRC=(--include='*.ts' --include='*.tsx' --include='*.astro')

# ── a) Supabase service-role client constructed ONLY in src/actions/admin/** ──
# The service-role client is `createClient()` from @supabase/supabase-js keyed
# with SUPABASE_SERVICE_ROLE_KEY (the one sanctioned use is gdpr.ts). The anon
# SSR clients (createBrowserClient/createServerClient from @supabase/ssr) are
# NOT this — \bcreateClient\b word-boundary skips them. Either the bare
# createClient call or the SERVICE_ROLE secret name, anywhere outside
# actions/admin, is a boundary breach.
hits=$(grep -rnE "\bcreateClient\b|SERVICE_ROLE" src "${SRC[@]}" 2>/dev/null \
  | grep -Ev "^src/actions/admin/" || true)
if [ -n "$hits" ]; then
  echo "::error::service-role client / SERVICE_ROLE used outside src/actions/admin/**:"
  echo "$hits"
  fail=1
fi

# ── b) Raw posthog.capture( only in the typed wrapper (CLAUDE.md rule 10) ──────
# Wrapper lives at src/lib/analytics* (may not exist yet — grep still valid).
hits=$(grep -rnE "posthog\.capture\(" src "${SRC[@]}" 2>/dev/null \
  | grep -Ev "^src/lib/analytics" || true)
if [ -n "$hits" ]; then
  echo "::error::raw posthog.capture( outside the src/lib/analytics wrapper:"
  echo "$hits"
  fail=1
fi

# ── c) set:html — hard-fail on user-content surfaces; warn on the rest ─────────
# set:html on user-generated content = stored XSS. We cannot safely block ALL
# set:html (icons/JSON-LD/i18n message fns are legit), so we hard-fail only where
# the risk is real (messaging / content organisms, messages pages, thread/chat/
# comment/review surfaces) and surface every other occurrence as a review warning.
danger=$(grep -rnE "set:html" src "${SRC[@]}" 2>/dev/null \
  | grep -Ei "organisms/messaging/|organisms/content/|/messages/|thread|chat|comment/|review/" \
  | grep -vi "admin" || true)
if [ -n "$danger" ]; then
  echo "::error::set:html on a messaging/user-content surface (stored-XSS risk):"
  echo "$danger"
  fail=1
fi
warn=$(grep -rnE "set:html" src "${SRC[@]}" 2>/dev/null \
  | grep -viE "organisms/messaging/|organisms/content/|/messages/|thread|chat|comment/|review/" || true)
if [ -n "$warn" ]; then
  echo "::warning::set:html occurrences to review (currently icons/JSON-LD/i18n — keep them non-user-content):"
  echo "$warn"
fi

# ── d) Admin import boundary (proxy for the ESLint boundary rule — follow-up) ──
# Nothing outside the 3 admin dirs may import FROM an admin path. The action
# registry src/actions/index.ts is the one sanctioned cross-fence seam.
# ponytail: grep proxy for the promised ESLint boundary rule; swap in eslint-plugin-boundaries when an eslint config lands.
hits=$(grep -rnE "(pages|actions|components/organisms)/admin" src "${SRC[@]}" 2>/dev/null \
  | grep -Ev "^src/pages/admin/|^src/actions/admin/|^src/components/organisms/admin/" \
  | grep -Ev "^src/actions/index\.ts:" \
  | grep -Ev "^[^:]+:[0-9]+:[[:space:]]*(\*|//)" || true)
if [ -n "$hits" ]; then
  echo "::error::code outside the admin fence references an admin folder (only src/actions/index.ts may):"
  echo "$hits"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "boundary greps: all clear"; fi
exit "$fail"
