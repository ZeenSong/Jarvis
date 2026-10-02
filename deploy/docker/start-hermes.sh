#!/bin/sh
set -eu

/opt/hermes/.venv/bin/python /opt/jarvis-compose/prepare-hermes-data.py
exec /opt/hermes/docker/entrypoint-dispatch.sh hermes -p jarvis gateway run
