#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export KUBECONFIG="${KUBECONFIG:-$PWD/.local/m2.kubeconfig}"
[[ -r "$KUBECONFIG" ]] || { echo 'Run start.sh prepare first' >&2; exit 1; }
context="${M2_CONTEXT:-$(kubectl config current-context)}"
[[ "$context" != minikube && "$context" != docker-desktop ]] || exit 1
k() { kubectl --context "$context" --request-timeout=20s "$@"; }
k get nodes -o json | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const n=JSON.parse(s).items;if(n.length!==1||!n[0].status.nodeInfo.kubeletVersion.includes("k3s"))process.exit(1)})'
(cd artifacts && sha256sum -c M2-SHA256SUMS)
gzip -dc artifacts/jarvis-m2-0.2.0-rc.1-images.tar.gz | sudo k3s ctr images import -
k -n jarvis rollout restart deployment/jarvis-server
k -n jarvis rollout status deployment/jarvis-server --timeout=180s
echo 'Web pairing fix installed. Hard-refresh the browser and generate a new code with start.sh pair.'
