#!/usr/bin/env bash
# Official static distribution: no apt transaction or NVIDIA package changes.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo '需要 sudo 权限' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo '此安装包只适用于 amd64' >&2; exit 1; }
if command -v tailscale >/dev/null; then
  echo 'Tailscale 已存在，保留现有安装。'
  exit 0
fi
jarvis_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
jarvis_archive="$jarvis_repo/.local/downloads/tailscale_1.102.3_amd64.tgz"
jarvis_sha=36ddd9b51be57ffc2990cf76323cfa13643bfbb1b8a969f6183fa164741cdef5
jarvis_stage=$(mktemp -d /tmp/jarvis-tailscale.XXXXXX)
jarvis_unpacked="$jarvis_stage/tailscale_1.102.3_amd64"
cleanup() {
  rm -f "$jarvis_unpacked/tailscale" "$jarvis_unpacked/tailscaled" \
    "$jarvis_unpacked/systemd/tailscaled.service" "$jarvis_unpacked/systemd/tailscaled.defaults" \
    "$jarvis_unpacked/systemd/tailscale-online.target" "$jarvis_unpacked/systemd/tailscale-wait-online.service" \
    "$jarvis_stage/download.tgz"
  rmdir "$jarvis_unpacked/systemd" "$jarvis_unpacked" "$jarvis_stage" 2>/dev/null || true
}
trap cleanup EXIT
if [[ ! -f $jarvis_archive ]]; then
  jarvis_archive="$jarvis_stage/download.tgz"
  curl -fL --retry 3 https://pkgs.tailscale.com/stable/tailscale_1.102.3_amd64.tgz -o "$jarvis_archive"
fi
printf '%s  %s\n' "$jarvis_sha" "$jarvis_archive" | sha256sum -c -
tar -xzf "$jarvis_archive" --no-same-owner -C "$jarvis_stage"
for jarvis_target in /usr/bin/tailscale /usr/sbin/tailscaled /etc/systemd/system/tailscaled.service; do
  [[ ! -e $jarvis_target ]] || { echo "保留已有文件，停止覆盖：$jarvis_target" >&2; exit 1; }
done
install -m 0755 "$jarvis_unpacked/tailscale" /usr/bin/tailscale
install -m 0755 "$jarvis_unpacked/tailscaled" /usr/sbin/tailscaled
install -m 0644 "$jarvis_unpacked/systemd/tailscaled.service" /etc/systemd/system/tailscaled.service
if [[ ! -f /etc/default/tailscaled ]]; then
  install -m 0644 "$jarvis_unpacked/systemd/tailscaled.defaults" /etc/default/tailscaled
fi
systemctl daemon-reload
systemctl enable --now tailscaled
tailscale version
