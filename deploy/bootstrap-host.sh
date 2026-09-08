#!/usr/bin/env bash
# Run interactively with sudo on the chosen Jarvis host.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo '请使用 sudo bash deploy/bootstrap-host.sh；密码只在本机终端输入。' >&2
  exit 1
fi
jarvis_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$jarvis_repo"
if [[ ! -f /sys/fs/cgroup/cgroup.controllers ]] && ! awk '$1=="memory" && $4==1 {found=1} END {exit !found}' /proc/cgroups; then
  echo '当前 cgroup 混合模式缺少 memory 控制器。先执行 sudo bash deploy/enable-cgroup-v2.sh，保存工作并重启，再重跑本脚本。' >&2
  exit 1
fi
command -v docker >/dev/null
docker image inspect jarvis-server:0.1.0 >/dev/null
docker image inspect postgres:17-alpine >/dev/null
jarvis_temp=$(mktemp -d /tmp/jarvis-bootstrap.XXXXXX)
trap 'rm -f "$jarvis_temp/tailscale-install.sh" "$jarvis_temp/k3s-install.sh" "$jarvis_temp/postgres-password" "$jarvis_temp/database-url" "$jarvis_temp/tailscale-ip"; rmdir "$jarvis_temp"' EXIT

if ! command -v tailscale >/dev/null; then
  bash "$jarvis_repo/deploy/install-tailscale-static.sh"
fi
systemctl enable --now tailscaled
echo 'Tailscale 如输出登录链接，请在浏览器打开并授权此服务器。'
tailscale up --accept-dns=false
jarvis_tailnet_ip=$(tailscale ip -4)
if [[ ! $jarvis_tailnet_ip =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '没有取得有效 Tailscale IPv4，暂不继续部署。' >&2
  exit 1
fi

# Keep existing Docker and desktop workloads intact. K3s has its own containerd.
if ! command -v k3s >/dev/null; then
  curl -fL --retry 3 https://get.k3s.io -o "$jarvis_temp/k3s-install.sh"
  export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost},10.42.0.0/16,10.43.0.0/16,100.64.0.0/10"
  export no_proxy="$NO_PROXY"
  INSTALL_K3S_EXEC="server --disable traefik --disable servicelb --bind-address $jarvis_tailnet_ip --node-ip $jarvis_tailnet_ip --advertise-address $jarvis_tailnet_ip --tls-san $jarvis_tailnet_ip --flannel-iface tailscale0 --write-kubeconfig-mode 600" sh "$jarvis_temp/k3s-install.sh"
fi
systemctl enable --now k3s
kctl() { k3s kubectl --server="https://$jarvis_tailnet_ip:6443" "$@"; }
kctl wait --for=condition=Ready node --all --timeout=180s
docker save jarvis-server:0.1.0 postgres:17-alpine | k3s ctr images import -
kctl apply -f deploy/k8s/namespace.yaml
if ! kctl -n jarvis get secret jarvis-secrets >/dev/null 2>&1; then
  umask 077
  jarvis_password=$(openssl rand -hex 32)
  printf '%s' "$jarvis_password" > "$jarvis_temp/postgres-password"
  printf 'postgres://jarvis:%s@postgres:5432/jarvis' "$jarvis_password" > "$jarvis_temp/database-url"
  printf '%s' "$jarvis_tailnet_ip" > "$jarvis_temp/tailscale-ip"
  kctl -n jarvis create secret generic jarvis-secrets \
    --from-file=postgres-password="$jarvis_temp/postgres-password" \
    --from-file=database-url="$jarvis_temp/database-url" \
    --from-file=tailscale-ip="$jarvis_temp/tailscale-ip"
  unset jarvis_password
else
  jarvis_existing_ip=$(kctl -n jarvis get secret jarvis-secrets -o jsonpath='{.data.tailscale-ip}' | base64 -d)
  if [[ $jarvis_existing_ip != "$jarvis_tailnet_ip" ]]; then
    echo '现有 Jarvis Secret 的 Tailscale IP 与当前不符；保留现有凭据，停止自动操作。' >&2
    exit 1
  fi
fi
if command -v nvidia-container-runtime >/dev/null && kctl get runtimeclass nvidia >/dev/null 2>&1; then
  kctl apply -k deploy/k8s-nvidia
else
  kctl apply -k deploy/k8s
  echo '提示：NVIDIA runtime 未就绪，本次基础服务可以启动，但 GPU 验收尚未完成。'
fi
kctl -n jarvis rollout status statefulset/postgres --timeout=180s
kctl -n jarvis rollout status deployment/jarvis-server --timeout=180s
curl --noproxy '*' --fail --silent --show-error "http://$jarvis_tailnet_ip:8080/health/ready"
printf '\n\nAndroid 服务器地址：http://%s:8080\n' "$jarvis_tailnet_ip"
echo '一次性配对码（10 分钟有效）：'
kctl -n jarvis exec deployment/jarvis-server -- node dist/apps/server/src/pair.js
echo '部署完成。手机安装 Tailscale 并登录同一账号，然后在 Jarvis 输入上述地址和配对码。'
