#!/usr/bin/env bash
# Production deploy = versions two-step (upload → promote), NOT `wrangler deploy`.
#
# Why: the intimate.nl zone still carries externally-managed DNS records from
# the pre-Workers setup. `wrangler deploy` tries to reconcile route origins
# (PUT .../domains/records), gets a 409 on those records, and then EXITS WITHOUT
# PROMOTING the uploaded version — code uploads but never goes live, silently.
# The two-step skips trigger sync entirely; the zone routes (wrangler.jsonc)
# are already attached and static.
#
# Owner fix that retires this script (INFRASTRUCTURE.md §1): delete the legacy
# A/AAAA records for intimate.nl + www.intimate.nl in the Cloudflare DNS
# dashboard, then IMMEDIATELY run `bunx wrangler deploy` (it recreates proper
# Workers origin records — the gap between the two is downtime). After that,
# `wrangler deploy` works and this script can go back to one line.
set -euo pipefail
out=$(bunx wrangler versions upload)
echo "$out"
id=$(echo "$out" | grep -ioE 'Worker Version ID: [a-f0-9-]{36}' | grep -oE '[a-f0-9-]{36}')
bunx wrangler versions deploy "$id@100%" -y
