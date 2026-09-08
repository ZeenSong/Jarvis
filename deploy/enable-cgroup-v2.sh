#!/usr/bin/env bash
# Prepare next boot only. Never reboot the workstation automatically.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo '请使用 sudo bash deploy/enable-cgroup-v2.sh' >&2; exit 1; }
jarvis_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
  echo '当前已经是统一 cgroup v2，无需修改 GRUB。'
  exit 0
fi
command -v update-grub >/dev/null
jarvis_config=/etc/default/grub.d/90-jarvis-cgroup-v2.cfg
if [[ -e $jarvis_config ]] && ! cmp -s "$jarvis_repo/deploy/90-jarvis-cgroup-v2.cfg" "$jarvis_config"; then
  echo "已有不同配置：$jarvis_config；保留原文件，停止。" >&2
  exit 1
fi
install -d -m 0755 /etc/default/grub.d
install -m 0644 "$jarvis_repo/deploy/90-jarvis-cgroup-v2.cfg" "$jarvis_config"
update-grub
# Only stop the newly installed failing K3s; Docker and other services stay running.
systemctl stop k3s
echo '已添加独立 GRUB 配置，未修改原有 /etc/default/grub，也未执行重启。'
echo '保存工作后运行 sudo reboot。重启会中断当前所有应用/容器。'
echo '重启后执行 cat /sys/fs/cgroup/cgroup.controllers，应包含 cpu cpuset memory pids。'
echo '然后重新执行 deploy/bootstrap-host.sh 的 sudo 命令。'
echo '撤销：将 /etc/default/grub.d/90-jarvis-cgroup-v2.cfg 移到 /root/ 下，运行 sudo update-grub 后重启。'
