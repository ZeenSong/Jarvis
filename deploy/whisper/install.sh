#!/usr/bin/env bash
# Deploy the self-hosted Whisper service and wire it to Jarvis.
#
#   ./deploy/whisper/install.sh
#
# Optional environment:
#   SPEECH_API_KEY       shared secret used by Jarvis and Whisper (generated if unset)
#   WHISPER_CACHE        Hugging Face cache directory
#   JARVIS_NETWORK       Docker network shared with the Jarvis server (default jarvis_default)
#   WHISPER_IMAGE_TAG    latest-cuda (default) or latest-cpu
#   WHISPER_DEVICE       cuda (default) or cpu
#   WHISPER_COMPUTE_TYPE float16 (default) / int8 / int8_float16
#   WHISPER_HTTPS_PROXY  proxy used for the Hugging Face model download
#
# The script is idempotent: rerunning it keeps the cached model and API key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/deploy/whisper/compose.yaml"
NETWORK="${JARVIS_NETWORK:-jarvis_default}"
MODEL="${WHISPER_MODEL:-Systran/faster-whisper-large-v3}"

# Default to the CasaOS-style persistent location when it exists, otherwise a
# local directory next to this recipe.
if [[ -z "${WHISPER_CACHE:-}" ]]; then
  if [[ -d /DATA/AppData ]]; then
    WHISPER_CACHE=/DATA/AppData/jarvis-whisper/cache
  else
    WHISPER_CACHE="$ROOT/deploy/whisper/cache"
  fi
fi
DATA_DIR="$(dirname "$WHISPER_CACHE")"
KEY_FILE="$DATA_DIR/api-key"
mkdir -p "$WHISPER_CACHE"

if [[ -n "${SPEECH_API_KEY:-}" ]]; then
  KEY="$SPEECH_API_KEY"
elif [[ -s "$KEY_FILE" ]]; then
  KEY="$(tr -d '\n' < "$KEY_FILE")"
else
  KEY="$(openssl rand -hex 32)"
fi
printf '%s' "$KEY" > "$KEY_FILE"
chmod 600 "$KEY_FILE"

export SPEECH_API_KEY="$KEY"
export WHISPER_CACHE
export JARVIS_NETWORK="$NETWORK"
export WHISPER_IMAGE_TAG="${WHISPER_IMAGE_TAG:-latest-cuda}"
export WHISPER_DEVICE="${WHISPER_DEVICE:-cuda}"
export WHISPER_COMPUTE_TYPE="${WHISPER_COMPUTE_TYPE:-float16}"

echo "[whisper] starting ${WHISPER_IMAGE_TAG} on network ${NETWORK}"
echo "[whisper] cache: ${WHISPER_CACHE}"
docker compose -f "$COMPOSE" up -d

echo "[whisper] waiting for the API"
for _ in $(seq 1 60); do
  if docker exec jarvis-whisper curl -fsS -H "Authorization: Bearer $KEY" \
    http://127.0.0.1:8000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec jarvis-whisper curl -fsS -H "Authorization: Bearer $KEY" \
  http://127.0.0.1:8000/health >/dev/null

if ! docker exec jarvis-whisper curl -fsS -H "Authorization: Bearer $KEY" \
  http://127.0.0.1:8000/v1/models | grep -q "\"$MODEL\""; then
  echo "[whisper] downloading ${MODEL} (first run only, several GB)"
  docker exec jarvis-whisper curl -fsS --max-time 3600 -X POST \
    -H "Authorization: Bearer $KEY" \
    "http://127.0.0.1:8000/v1/models/$MODEL"
  echo
fi

echo "[whisper] warming the model so the first voice turn is fast"
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 1 \
    -c:a pcm_s16le /tmp/jarvis-whisper-warm.wav
  docker cp /tmp/jarvis-whisper-warm.wav jarvis-whisper:/tmp/warm.wav >/dev/null
  docker exec jarvis-whisper curl -fsS --max-time 300 \
    -H "Authorization: Bearer $KEY" \
    -F 'file=@/tmp/warm.wav;type=audio/wav' \
    -F "model=$MODEL" -F 'language=zh' \
    http://127.0.0.1:8000/v1/audio/transcriptions >/dev/null
fi

cat <<EOF

[whisper] ready. Add these variables to the Jarvis server environment:

SPEECH_BASE_URL=http://jarvis-whisper:8000/v1
SPEECH_API_KEY=${KEY}
SPEECH_STT_MODEL=${MODEL}
SPEECH_STT_LANGUAGE=zh
SPEECH_TIMEOUT_MS=120000

Jarvis and Whisper must share the ${NETWORK} Docker network. The Whisper port
is not published on the host. Verify from the Jarvis container:

  docker exec jarvis-server node -e "fetch('http://jarvis-whisper:8000/health',{headers:{Authorization:'Bearer '+process.env.SPEECH_API_KEY}}).then(r=>r.text().then(console.log))"
EOF
