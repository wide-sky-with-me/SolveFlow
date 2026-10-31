#!/usr/bin/env bash
set -euo pipefail
photo_root=${1:?service root required}
photo_user=${2:?service user required}
shift 2
[[ $EUID == 0 && $photo_root =~ ^/home/[a-zA-Z0-9_-]+/\.local/share/solveflow-photo$ && $photo_user =~ ^[a-zA-Z0-9_-]+$ ]]
photo_cert=solveflow-photo
if [[ ${1:-} == --lineage ]]; then
  photo_cert=${2:?certificate lineage required}
  shift 2
fi
[[ $photo_cert =~ ^[a-zA-Z0-9_-]{1,64}$ ]]
photo_group=$(id -gn "$photo_user")
docker run --rm --network host \
  -v "$photo_root/acme-webroot:/var/www/acme" \
  -v "$photo_root/certbot:/etc/letsencrypt" \
  certbot/certbot@sha256:c23159d30afdd9c97960578aa4654f5901de6cae394958f894074dedd55e599d \
  renew --cert-name "$photo_cert" --quiet "$@"
# Failed renewal stops here and retains the last working files. Reload only this service.
openssl x509 -in "$photo_root/certbot/live/$photo_cert/fullchain.pem" -noout -checkend 3600 >/dev/null
install -m 600 -o "$photo_user" -g "$photo_group" "$photo_root/certbot/live/$photo_cert/fullchain.pem" "$photo_root/tls/fullchain.pending"
install -m 600 -o "$photo_user" -g "$photo_group" "$photo_root/certbot/live/$photo_cert/privkey.pem" "$photo_root/tls/privkey.pending"
mv "$photo_root/tls/fullchain.pending" "$photo_root/tls/fullchain.pem"
mv "$photo_root/tls/privkey.pending" "$photo_root/tls/privkey.pem"
systemctl kill --signal=HUP solveflow-photo.service
