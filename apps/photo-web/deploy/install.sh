#!/usr/bin/env bash
# Run as root after uploading a verified release and a private shared/config.json.
set -euo pipefail
photo_root=${1:?service root required}
photo_user=${2:?service user required}
photo_cert=${3:-solveflow-photo}
photo_port=${4:-443}
[[ $EUID == 0 && $photo_root =~ ^/home/[a-zA-Z0-9_-]+/\.local/share/solveflow-photo$ && $photo_user =~ ^[a-zA-Z0-9_-]+$ ]]
[[ $photo_cert =~ ^[a-zA-Z0-9_-]{1,64}$ && $photo_port =~ ^[0-9]{1,5}$ ]]
photo_port=$((10#$photo_port))
((photo_port >= 1 && photo_port <= 65535))
photo_group=$(id -gn "$photo_user")
test -x "$photo_root/current/bin/node"
test -f "$photo_root/current/dist/server.mjs"
test -f "$photo_root/shared/config.json"
test "$(stat -c %a "$photo_root/shared/config.json")" = 600
"$photo_root/current/bin/node" --input-type=module - "$photo_root/shared/config.json" "$photo_port" <<'JS'
import { readFile } from 'node:fs/promises';
const configuration = JSON.parse(await readFile(process.argv[2], 'utf8'));
const origin = new URL(configuration.origin);
if (origin.protocol !== 'https:' || Number(origin.port || 443) !== Number(process.argv[3])) throw new Error('HTTPS origin and service port must match.');
JS
test -f "$photo_root/certbot/live/$photo_cert/fullchain.pem"
test -f "$photo_root/certbot/live/$photo_cert/privkey.pem"
install -d -m 700 -o "$photo_user" -g "$photo_group" "$photo_root/shared/state" "$photo_root/tls"
install -m 600 -o "$photo_user" -g "$photo_group" "$photo_root/certbot/live/$photo_cert/fullchain.pem" "$photo_root/tls/fullchain.pem"
install -m 600 -o "$photo_user" -g "$photo_group" "$photo_root/certbot/live/$photo_cert/privkey.pem" "$photo_root/tls/privkey.pem"
install -m 755 -o root -g root "$(dirname "$0")/renew.sh" /usr/local/sbin/solveflow-photo-renew
cat >/etc/systemd/system/solveflow-photo.service <<EOF
[Unit]
Description=SolveFlow public photo answering
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$photo_user
Group=$photo_group
WorkingDirectory=$photo_root/current
Environment=SOLVEFLOW_PHOTO_CONFIG=$photo_root/shared/config.json
Environment=SOLVEFLOW_PHOTO_STATE=$photo_root/shared/state
Environment=SOLVEFLOW_PHOTO_TLS_KEY=$photo_root/tls/privkey.pem
Environment=SOLVEFLOW_PHOTO_TLS_CERT=$photo_root/tls/fullchain.pem
Environment=SOLVEFLOW_PHOTO_ACME=$photo_root/acme-webroot
Environment=SOLVEFLOW_PHOTO_PORT=$photo_port
ExecStart=$photo_root/current/bin/node $photo_root/current/dist/server.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0077
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$photo_root/shared/state
MemoryMax=768M
TasksMax=128
LimitNOFILE=1024
[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/solveflow-photo-renew.service <<EOF
[Unit]
Description=Renew the SolveFlow photo HTTPS certificate
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/solveflow-photo-renew $photo_root $photo_user --lineage $photo_cert
TimeoutStartSec=600
UMask=0077
EOF
cat >/etc/systemd/system/solveflow-photo-renew.timer <<'EOF'
[Unit]
Description=Check SolveFlow HTTPS certificate twice daily
[Timer]
OnCalendar=*-*-* 00,12:15:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
# These are only the temporary listeners created for this application's ACME setup.
systemctl stop solveflow-photo-preflight.service solveflow-photo-acme-bootstrap.service 2>/dev/null || true
systemctl enable --now solveflow-photo.service solveflow-photo-renew.timer
