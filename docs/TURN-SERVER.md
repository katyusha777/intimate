# TURN-SERVER.md — coturn box runbook (turn.intimate.nl)

**Audience: a Claude Code session running ON the server itself** (this file is
self-contained — no repo context needed). The box is the WebRTC TURN relay for
intimate.nl 1:1 calls (repo context: docs/VIDEO-CALLING.md §8). It relays
**DTLS-SRTP ciphertext only** — it cannot see or decrypt call media, and it
must never log who talked to whom.

## Privacy law for this box (never violate)

1. **No session/relay logging.** coturn's log target stays `/dev/null` (or the
   systemd unit's `--no-stdout-log`). Never leave `verbose` on outside a live
   debugging minute; remove it and restart when done.
2. No packet capture, no traffic inspection tooling installed, ever.
3. `turn.intimate.nl` DNS stays **grey-cloud/DNS-only** (raw UDP/TLS — the
   Cloudflare proxy would break it).
4. The `static-auth-secret` never leaves `/etc/coturn/turnserver.conf` except
   into Cloudflare Worker secrets (laptop-side step below).

## State as of 2026-08-06 (provisioned remotely — do NOT redo these)

| Item | State |
|---|---|
| OS | CentOS Stream 10, hostname `intimate-turn`, public IP `2.28.28.93` directly on eth0 (no NAT), Hetzner IPv6 also bound |
| SSH | port `6791`, root; key `intimate-turn-provisioning` (ed25519) installed in `authorized_keys` |
| Packages | `coturn` 4.15.0 + `certbot` 4.2.0 via EPEL |
| TLS cert | Let's Encrypt for `turn.intimate.nl` in `/etc/letsencrypt/live/turn.intimate.nl/`; **copies** readable by coturn at `/etc/coturn/certs/*.pem` |
| Renewal | `certbot-renew.timer` enabled; deploy hook `/etc/letsencrypt/renewal-hooks/deploy/coturn-certs.sh` re-copies certs + restarts coturn |
| Config | `/etc/coturn/turnserver.conf` (`root:coturn` 640): `use-auth-secret` + `static-auth-secret=<64-hex>`, `realm=turn.intimate.nl`, `tls-listening-port=443`, plain 3478, relay ports `49152-65535`, `fingerprint`, `no-cli`, `no-tlsv1/1_1`, `no-rfc5780`, private peer ranges denied |
| systemd | `coturn.service` enabled + active; drop-in `/etc/systemd/system/coturn.service.d/override.conf` grants `CAP_NET_BIND_SERVICE` (port 443) + `LimitNOFILE=65536` |
| Firewall | firewalld enabled: `6791/tcp 80/tcp 443/tcp 3478/tcp 3478/udp 5349/tcp 49152-65535/udp` |
| Verified | listeners on `2.28.28.93:3478` (tcp+udp) and `:443` (TLS); TCP 443 + 3478 reachable from the public internet |

Gotchas already learned (don't re-trip them):
- The service runs as user `coturn` — config/certs must stay group-readable
  (`root:coturn` 640 / owned copies in `/etc/coturn/certs`). A root-only
  `turnserver.conf` makes coturn **silently start with defaults**.
- `alt-tls-listening-port` did not bind in this coturn build — 443 is the
  primary `tls-listening-port` on purpose. Clients get `turns:…:443`.
- Port 5349 is open in the firewall but nothing listens — harmless; close it
  or ignore.

## Remaining work

Provisioning finished remotely on 2026-08-06: **allocation proven over UDP 3478
and TLS 443** with time-limited HMAC creds (`turnutils_uclient`, 0% loss),
logging silenced (`log-file=/dev/null` + `no-stdout-log`), `TURN_SECRET`
stored in Worker secrets (prod + staging). Only owner steps remain:

1. **Harden SSH:** the owner rotates the root password (it was shared in
   chat). Then set `PasswordAuthentication no` in `/etc/ssh/sshd_config`
   (keys are already in place — confirm the owner has their own key too
   before doing this) and `systemctl reload sshd`.
2. Optional hygiene: `dnf install -y dnf-automatic && systemctl enable --now
   dnf-automatic.timer` (security updates; coturn restarts are cheap).

Re-verify a relay allocation any time:

```bash
SECRET=$(grep '^static-auth-secret=' /etc/coturn/turnserver.conf | cut -d= -f2)
U="$(( $(date +%s) + 3600 )):probe"
P=$(echo -n "$U" | openssl dgst -sha1 -hmac "$SECRET" -binary | base64)
turnutils_uclient -u "$U" -w "$P" -y 2.28.28.93            # UDP 3478
turnutils_uclient -u "$U" -w "$P" -y -S -p 443 2.28.28.93  # TLS 443
# success = "Total lost packets 0"; a 401 = wrong secret/HMAC formula
```

## What the app expects (laptop-side, NOT this server — context only)

- The Worker gets the secret once: `bunx wrangler secret put TURN_SECRET`
  (+ `--env staging`) with the value from `static-auth-secret`.
- Per call, a server action mints `username = "<unix-expiry>:<session-id>"`,
  `credential = base64(HMAC-SHA1(TURN_SECRET, username))`, TTL ≤ 1h, and hands
  browsers: `turn:turn.intimate.nl:3478?transport=udp`,
  `turn:turn.intimate.nl:3478?transport=tcp`,
  `turns:turn.intimate.nl:443?transport=tcp`.
- The professional's side connects with `iceTransportPolicy: 'relay'` — her IP
  must never reach a client. That policy lives in the app, but it's the reason
  this box exists; treat its availability accordingly.
