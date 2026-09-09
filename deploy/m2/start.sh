#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
if [[ -f "${M2_ENV_FILE:-.local/m2.env}" ]]; then
  set -a
  source "${M2_ENV_FILE:-.local/m2.env}"
  set +a
fi
export KUBECONFIG="${KUBECONFIG:-$PWD/.local/m2.kubeconfig}"
command_name="${1:-help}"
if [[ "$command_name" == prepare ]]; then
  mkdir -p .local
  # Keep the original root-only K3s configuration and default minikube context intact.
  sudo install -m 600 -o "$(id -u)" -g "$(id -g)" /etc/rancher/k3s/k3s.yaml "$KUBECONFIG"
  printf 'K3s configuration copied to %s\n' "$KUBECONFIG"
  exit 0
fi
if [[ "$command_name" == help ]]; then
  printf '%s\n' 'Usage: bash deploy/m2/start.sh prepare|backup|deploy|pair|status|rollback' 'Configuration: deploy/m2/operator.env.example → .local/m2.env'
  exit 0
fi
[[ -r "$KUBECONFIG" ]] || { printf 'Run: bash deploy/m2/start.sh prepare\n' >&2; exit 1; }
export M2_CONTEXT="${M2_CONTEXT:-$(kubectl --kubeconfig "$KUBECONFIG" config current-context)}"
[[ "$M2_CONTEXT" != minikube && "$M2_CONTEXT" != docker-desktop ]] || { printf 'Production requires an explicit K3s context\n' >&2; exit 1; }
k() { kubectl --context "$M2_CONTEXT" --request-timeout=20s "$@"; }
k get nodes -o json | node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{const n=JSON.parse(s).items;if(!n.length||!n.every(x=>x.status.nodeInfo.kubeletVersion.includes("k3s")))process.exit(1)})'
case "$command_name" in
  backup)
    export M2_BACKUP_DIR="${M2_BACKUP_DIR:-$PWD/.local/m2-backup-$(date +%Y%m%d-%H%M%S)}"
    npm run build
    node deploy/m2/preflight.mjs
    M2_BACKUP_FILE="$M2_BACKUP_DIR/postgres.dump" node deploy/m2/verify-backup.mjs
    printf '%s\n' "$M2_BACKUP_DIR" > .local/m2-last-backup
    ;;
  deploy)
    [[ "$(k get nodes -o jsonpath='{.items[*].metadata.name}' | wc -w)" -eq 1 ]] || { printf 'This offline launcher supports a single-node K3s; import images on every node before a multi-node deployment.\n' >&2; exit 1; }
    backup_dir="${M2_BACKUP_DIR:-$(cat .local/m2-last-backup)}"
    M2_SELECTED_BACKUP="$backup_dir" node --input-type=module -e 'import{readFile}from"node:fs/promises";const p=process.env.M2_SELECTED_BACKUP;const before=JSON.parse(await readFile(p+"/before.json"));const checked=JSON.parse(await readFile(p+"/postgres.dump.verified.json"));if(before.context!==process.env.M2_CONTEXT||checked.status!=="passed"||Date.now()-Date.parse(before.created_at)>86400000)throw Error("Run a fresh backup and restore verification for this cluster first")'
    export GATEWAY_IP="${GATEWAY_IP:-$(k -n jarvis get secret jarvis-secrets -o jsonpath='{.data.tailscale-ip}' | base64 -d)}"
    export GATEWAY_SOURCE_IP="${GATEWAY_SOURCE_IP:-$(k -n jarvis get pods -l app=jarvis-server -o jsonpath='{.items[0].status.podIP}')}"
    export CORE_MODEL="${CORE_MODEL:-deepseek-v4-flash}" OPS_MODEL="${OPS_MODEL:-deepseek-v4-flash}" CODING_MODEL="${CODING_MODEL:-gpt-5.6-luna}"
    export CODING_REPOSITORY="${CODING_REPOSITORY:-https://github.com/ZeenSong/Jarvis.git}" CODING_COMMIT="${CODING_COMMIT:-48efaca2e421737e6f297dbefa2bad56bffcac03}"
    export M2_RENDER_DIR="${M2_RENDER_DIR:-$PWD/.local/m2-deploy}"
    node deploy/m2/render.mjs
    # Offline image bundle targets this machine's single-node K3s installation.
    gzip -dc artifacts/jarvis-m2-0.2.0-rc.1-images.tar.gz | sudo k3s ctr images import -
    k create namespace jarvis-workers --dry-run=client -o yaml | k apply -f -
    k label namespace jarvis-workers pod-security.kubernetes.io/enforce=restricted --overwrite
    node deploy/m2/provision-secrets.mjs
    k apply -f "$M2_RENDER_DIR/configmaps.json"
    k apply -f "$M2_RENDER_DIR/codex-auth.yaml"
    k -n jarvis-workers wait --for=condition=complete job/codex-auth-seed --timeout=180s
    k apply -f "$M2_RENDER_DIR/workers.yaml" -f "$M2_RENDER_DIR/proxy.yaml" -f "$M2_RENDER_DIR/ops-gateway.yaml"
    k -n jarvis-workers rollout restart deployment/worker-controller deployment/egress-proxy deployment/ops-read-gateway
    k -n jarvis-workers rollout status deployment/worker-controller --timeout=180s
    k -n jarvis-workers rollout status deployment/egress-proxy --timeout=180s
    k -n jarvis-workers rollout status deployment/ops-read-gateway --timeout=180s
    k -n jarvis patch deployment jarvis-server --type=strategic --patch-file "$M2_RENDER_DIR/server-patch.yaml"
    k -n jarvis rollout restart deployment/jarvis-server
    k -n jarvis rollout status deployment/jarvis-server --timeout=180s
    printf 'M2 service started at http://%s:8080; run start.sh pair, then complete docs/m2/demo.md\n' "$GATEWAY_IP"
    ;;
  pair)
    k -n jarvis exec deployment/jarvis-server -- node dist/apps/server/src/pair.js
    ;;
  status)
    k -n jarvis get pods -o wide
    k -n jarvis-workers get pods,jobs,pvc
    ;;
  rollback)
    backup_dir="${M2_BACKUP_DIR:-$(cat .local/m2-last-backup)}"
    previous_image="$(M2_SELECTED_BACKUP="$backup_dir" node --input-type=module -e 'import{readFileSync}from"node:fs";const s=JSON.parse(readFileSync(process.env.M2_SELECTED_BACKUP+"/before.json"));if(s.context!==process.env.M2_CONTEXT)throw Error("Wrong cluster backup");const image=s.images.find(i=>i.name==="server")?.image;if(!image)throw Error("Missing prior image");process.stdout.write(image)')"
    k -n jarvis set image deployment/jarvis-server "server=$previous_image"
    k -n jarvis rollout status deployment/jarvis-server --timeout=180s
    k -n jarvis-workers scale deployment/worker-controller --replicas=0
    printf 'Previous service image restored. M2 tables, login and workspace volumes are retained. Inspect active Jobs with start.sh status.\n'
    ;;
  *) printf 'Unknown command: %s\n' "$command_name" >&2; exit 1 ;;
esac
