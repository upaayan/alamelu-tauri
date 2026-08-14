#!/usr/bin/env bash
# windows-sync.sh — sync Sudhir configuration to the Windows machine.
#
# The Mac is the source of truth. The Windows machine runs the
# backend inside WSL2 (no native Windows build), so the pi agent
# files and the Codex auth file must match between the Mac and WSL. The relay
# bucket never carries credential bytes; AWS Secrets Manager does.
#
# Files synced:
#   ~/.pi/agent/auth.json                       -> lazydata/agent-cli/pi/auth.json
#   ~/.pi/agent/models.json                     -> lazydata/agent-cli/pi/models.json
#   ~/.pi/agent/.vertex.json                    -> lazydata/agent-cli/pi/.vertex.json
#   ~/.pi/agent/extensions/xai2-oauth.ts        -> lazydata/agent-cli/pi/extensions/xai2-oauth.ts
#   ~/.codex/auth.json (Mac) /                 -> lazydata/agent-cli/sudhir-codex/auth.json
#     ~/.sudhir-codex/auth.json (WSL)

set -Eeuo pipefail

REGION="${S3_RELAY_REGION:-ap-south-1}"
PI_PREFIX="${PI_SECRET_PREFIX:-lazydata/agent-cli/pi}"
CODEX_SECRET_ID="${CODEX_SECRET_ID:-lazydata/agent-cli/sudhir-codex/auth.json}"
CLAUDE_SECRET_ID="${CLAUDE_SECRET_ID:-lazydata/agent-cli/claude/credentials.json}"
CLAUDE_KEYCHAIN_SERVICE="Claude Code-credentials"

usage() {
  echo "usage: $0 push|pull" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
MODE="$1"
[[ "$MODE" == "push" || "$MODE" == "pull" ]] || usage

secret_put_binary() {
  local secret_id="$1" local_path="$2"
  if aws secretsmanager describe-secret --secret-id "${secret_id}" \
      --region "${REGION}" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "${secret_id}" \
      --secret-binary "fileb://${local_path}" --region "${REGION}" \
      --query '{Name:Name,VersionId:VersionId}' --output text
  else
    aws secretsmanager create-secret --name "${secret_id}" \
      --secret-binary "fileb://${local_path}" --region "${REGION}" \
      --query '{Name:Name,VersionId:VersionId}' --output text
  fi
}

secret_get_to_file() {
  local secret_id="$1" out_path="$2"
  aws secretsmanager get-secret-value --secret-id "${secret_id}" \
    --region "${REGION}" --query SecretBinary --output text \
    | tr -d '\n' | base64 -d > "${out_path}"
}

validate_json() {
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1"
}

if [[ "${MODE}" == "push" ]]; then
  # --- Mac side: push current files to Secrets Manager --------------
  [[ "$(uname)" == "Darwin" ]] || { echo "push must run on the Mac" >&2; exit 1; }

  echo "=== pushing Pi files (Mac -> Secrets Manager) ==="
  for spec in \
    "${PI_PREFIX}/auth.json:${HOME}/.pi/agent/auth.json" \
    "${PI_PREFIX}/models.json:${HOME}/.pi/agent/models.json" \
    "${PI_PREFIX}/.vertex.json:${HOME}/.pi/agent/.vertex.json" \
    "${PI_PREFIX}/extensions/xai2-oauth.ts:${HOME}/.pi/agent/extensions/xai2-oauth.ts" \
    "${CODEX_SECRET_ID}:${HOME}/.codex/auth.json"; do
    secret="${spec%%:*}"
    path="${spec#*:}"
    [[ -f "${path}" ]] || { echo "MISSING source: ${path}" >&2; exit 1; }
    secret_put_binary "${secret}" "${path}"
    echo "  pushed ${secret}"
  done

  # Verify round-trip hashes so pull can never install stale bytes.
  echo "=== verifying round-trip hashes ==="
  ok=1
  for spec in \
    "${PI_PREFIX}/auth.json:${HOME}/.pi/agent/auth.json" \
    "${PI_PREFIX}/models.json:${HOME}/.pi/agent/models.json" \
    "${PI_PREFIX}/.vertex.json:${HOME}/.pi/agent/.vertex.json" \
    "${PI_PREFIX}/extensions/xai2-oauth.ts:${HOME}/.pi/agent/extensions/xai2-oauth.ts" \
    "${CODEX_SECRET_ID}:${HOME}/.codex/auth.json"; do
    secret="${spec%%:*}"
    path="${spec#*:}"
    tmp="$(mktemp)"
    secret_get_to_file "${secret}" "${tmp}"
    if [[ "$(shasum -a 256 "${tmp}" | awk '{print $1}')" == \
          "$(shasum -a 256 "${path}" | awk '{print $1}')" ]]; then
      echo "  OK ${secret}"
    else
      echo "  MISMATCH ${secret}" >&2
      ok=0
    fi
    rm -f "${tmp}"
  done

  [[ "${ok}" -eq 1 ]] || exit 1
  echo "=== push complete; run 'pull' in WSL to install ==="
  exit 0
fi

# --- WSL side: fetch from Secrets Manager and install --------------------
echo "=== pulling Pi files (Secrets Manager -> WSL) ==="
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "${HOME}/.pi/agent/extensions" "${HOME}/.sudhir-codex" \
  "${HOME}/.pi/agent/backups/${TS}" 2>/dev/null || true
umask 077

install_file() {
  local secret="$1" target="$2" expect_json="${3:-0}"
  local tmp
  tmp="$(mktemp)"
  secret_get_to_file "${secret}" "${tmp}"
  [[ -s "${tmp}" ]] || { echo "  EMPTY secret ${secret}" >&2; rm -f "${tmp}"; return 1; }
  if [[ "${expect_json}" -eq 1 ]]; then
    validate_json "${tmp}" || { echo "  INVALID JSON ${secret}" >&2; rm -f "${tmp}"; return 1; }
  fi
  mkdir -p "$(dirname "${target}")"
  if [[ -f "${target}" ]]; then
    cp -p "${target}" "${HOME}/.pi/agent/backups/${TS}/$(basename "${target}")"
  fi
  chmod 600 "${tmp}"
  mv "${tmp}" "${target}"
  chmod 600 "${target}"
  echo "  installed ${target} ($(shasum -a 256 "${target}" | awk '{print $1}'))"
}

install_file "${PI_PREFIX}/auth.json" "${HOME}/.pi/agent/auth.json" 1
install_file "${PI_PREFIX}/models.json" "${HOME}/.pi/agent/models.json" 1
install_file "${PI_PREFIX}/.vertex.json" "${HOME}/.pi/agent/.vertex.json" 1
install_file "${PI_PREFIX}/extensions/xai2-oauth.ts" "${HOME}/.pi/agent/extensions/xai2-oauth.ts" 0
install_file "${CODEX_SECRET_ID}" "${HOME}/.sudhir-codex/auth.json" 1

# Normalize Mac paths in auth.json to WSL paths
if [[ -f "${HOME}/.pi/agent/auth.json" ]]; then
  python3 - "${HOME}/.pi/agent/auth.json" "${HOME}/.pi/agent" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
pi_agent = sys.argv[2]
text = p.read_text(encoding="utf-8")
text = text.replace("/Users/sudhirjha/.pi/agent", pi_agent)
p.write_text(text, encoding="utf-8")
PY
fi

echo "=== pull complete ==="
echo "backup: ${HOME}/.pi/agent/backups/${TS}"
ls -la "${HOME}/.pi/agent/auth.json" "${HOME}/.pi/agent/models.json" \
  "${HOME}/.pi/agent/.vertex.json" "${HOME}/.pi/agent/extensions/xai2-oauth.ts" \
  "${HOME}/.sudhir-codex/auth.json"
