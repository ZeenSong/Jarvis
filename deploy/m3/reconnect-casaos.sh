#!/usr/bin/env bash
# Run interactively over SSH; never put the password in arguments or files.
set -euo pipefail
cd "$(dirname "$0")/../.."
read -r -s -p 'CasaOS 密码: ' casaos_password
printf '\n'
trap 'unset casaos_password' EXIT
printf '%s\n' "$casaos_password" | CASAOS_SESSION_FILE="${CASAOS_SESSION_FILE:-$PWD/.local/m3-production-casaos/casaos-session.json}" node deploy/m3/casaos-login.mjs
