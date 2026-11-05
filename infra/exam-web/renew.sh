#!/usr/bin/env bash
# Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-single-host-deployment.md
set -euo pipefail
exam_root=${1:?service root required}
exam_cert=${2:?certificate lineage required}
shift 2
[[ $EUID == 0 && $exam_root =~ ^/home/[a-zA-Z0-9_-]+/\.local/share/solveflow-exams$ && $exam_cert =~ ^[a-zA-Z0-9_-]{1,64}$ ]]
umask 077
docker run --rm --network host \
  -v "$exam_root/shared/acme-webroot:/var/www/acme" \
  -v "$exam_root/shared/certbot:/etc/letsencrypt" \
  certbot/certbot@sha256:c23159d30afdd9c97960578aa4654f5901de6cae394958f894074dedd55e599d \
  renew --cert-name "$exam_cert" --quiet "$@"
openssl x509 -in "$exam_root/shared/certbot/live/$exam_cert/fullchain.pem" -noout -checkend 3600 >/dev/null
if cmp -s "$exam_root/shared/certbot/live/$exam_cert/fullchain.pem" "$exam_root/shared/tls/fullchain.pem" && cmp -s "$exam_root/shared/certbot/live/$exam_cert/privkey.pem" "$exam_root/shared/tls/privkey.pem"; then
  exit 0
fi
# Watch the directory mount and explicitly force a reload even if Caddyfile text is unchanged.
install -m 600 -o 1000 -g 1000 "$exam_root/shared/certbot/live/$exam_cert/fullchain.pem" "$exam_root/shared/tls/fullchain.pending"
install -m 600 -o 1000 -g 1000 "$exam_root/shared/certbot/live/$exam_cert/privkey.pem" "$exam_root/shared/tls/privkey.pending"
mv "$exam_root/shared/tls/fullchain.pending" "$exam_root/shared/tls/fullchain.pem"
mv "$exam_root/shared/tls/privkey.pending" "$exam_root/shared/tls/privkey.pem"
docker exec solveflow-exams-gateway-1 caddy reload --force --config /etc/caddy/Caddyfile --adapter caddyfile
