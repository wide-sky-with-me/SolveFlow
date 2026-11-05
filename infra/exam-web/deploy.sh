#!/usr/bin/env sh
# Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-single-host-deployment.md
set -eu
umask 077
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || { [ "$#" -eq 2 ] && [ "$2" != --single-host ]; }; then
  echo 'Usage: infra/exam-web/deploy.sh /absolute/private/deploy.env [--single-host]' >&2
  exit 2
fi
case "$1" in /*) ;; *) echo 'An absolute private env path is required.' >&2; exit 2;; esac
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
private_env=$1
single_host=${2:-}
compose() {
  if [ "$single_host" = --single-host ]; then
    if grep -q '^EXAM_TLS_DIR=.' "$private_env"; then
      docker compose --env-file "$private_env" -f "$project_root/infra/exam-web/compose.yaml" -f "$project_root/infra/exam-web/compose.single-host.yaml" -f "$project_root/infra/exam-web/compose.existing-tls.yaml" "$@"
    else
      docker compose --env-file "$private_env" -f "$project_root/infra/exam-web/compose.yaml" -f "$project_root/infra/exam-web/compose.single-host.yaml" "$@"
    fi
  else
    docker compose --env-file "$private_env" -f "$project_root/infra/exam-web/compose.yaml" "$@"
  fi
}
# Validate before changing the isolated project; never stop another project to claim its ports.
compose config --quiet
release_name=$(sed -n 's/^EXAM_RELEASE=//p' "$private_env")
case "$release_name" in ''|*[!a-zA-Z0-9_.-]*) echo 'Invalid release name.' >&2; exit 2;; esac
docker build --file "$project_root/infra/exam-web/Dockerfile" --tag "solveflow/exam-web:$release_name" "$project_root"
if [ "$single_host" = --single-host ]; then
  compose up -d --wait postgres redis storage
else
  compose up -d --wait postgres redis
fi
backup_dir=$(dirname -- "$private_env")/backups
mkdir -p "$backup_dir"
backup_file="$backup_dir/exams-$(date -u +%Y%m%d-%H%M%S).sql"
compose exec -T postgres pg_dump -U solveflow -d solveflow_exams > "$backup_file"
compose run --rm migrate
compose run --rm bootstrap
compose up -d --wait api worker events gateway
echo 'Managed exam services started. Perform HTTPS, private bucket and restore acceptance before public use.'
