#!/usr/bin/env bash

set -euo pipefail

SCRIPT_LOCATION="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_LOCATION" != */* ]]; then
  SCRIPT_LOCATION="./$SCRIPT_LOCATION"
fi
PROJECT_DIR="$(cd "${SCRIPT_LOCATION%/*}" && pwd)"
BUSINESS_BACKEND_PID=""
BUSINESS_BACKEND_LOG=""

cleanup() {
  if [[ -n "$BUSINESS_BACKEND_PID" ]] && kill -0 "$BUSINESS_BACKEND_PID" 2>/dev/null; then
    kill "$BUSINESS_BACKEND_PID" 2>/dev/null || true
    wait "$BUSINESS_BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BUSINESS_BACKEND_LOG" && -f "$BUSINESS_BACKEND_LOG" ]]; then
    rm -f -- "$BUSINESS_BACKEND_LOG"
  fi
}

handle_signal() {
  cleanup
  exit 130
}

check_port_in_use() {
  node - "$1" <<'NODE'
const net = require('node:net');
const port = Number(process.argv[2]);
const socket = net.createConnection({
  host: '127.0.0.1',
  port,
});
let settled = false;

function finish(exitCode) {
  if (settled) {
    return;
  }
  settled = true;
  socket.destroy();
  process.exit(exitCode);
}

socket.once('connect', () => finish(0));
socket.once('error', (error) => {
  if (error && error.code === 'ECONNREFUSED') {
    finish(1);
    return;
  }
  finish(2);
});
socket.setTimeout(1000, () => finish(2));
NODE
}

trap cleanup EXIT
trap handle_signal INT TERM

if check_port_in_use 3001; then
  printf '错误：3001端口已被占用，请先停止旧的Realtime Relay。\n' >&2
  exit 1
else
  port_status=$?
  if [[ "$port_status" -ne 1 ]]; then
    printf '错误：无法检查3001端口状态。\n' >&2
    exit 1
  fi
fi

if check_port_in_use 8765; then
  printf '错误：8765端口已被占用，请先停止旧的业务后端与首页服务。\n' >&2
  exit 1
else
  port_status=$?
  if [[ "$port_status" -ne 1 ]]; then
    printf '错误：无法检查8765端口状态。\n' >&2
    exit 1
  fi
fi

read -r -s -p "请输入 VOLCENGINE_API_KEY：" api_key
printf '\n'
if [[ -z "${api_key//[[:space:]]/}" ]]; then
  printf '错误：VOLCENGINE_API_KEY 不能为空。\n' >&2
  exit 1
fi
export VOLCENGINE_API_KEY="$api_key"
unset api_key

export DOUBAO_ENABLE_SUNWUKONG=1
export DOUBAO_SUNWUKONG_SPEAKER_ID=S_UiUfvBA92

export DOUBAO_ENABLE_GUANYIN=1
export DOUBAO_GUANYIN_SPEAKER_ID=S_TiUfvBA92

export DOUBAO_ENABLE_CAISHEN=1
export DOUBAO_CAISHEN_SPEAKER_ID=S_SiUfvBA92

export DOUBAO_ENABLE_RULAI=1
export DOUBAO_RULAI_SPEAKER_ID=S_RiUfvBA92

export DOUBAO_ENABLE_ZHUBAJIE=1
export DOUBAO_ZHUBAJIE_SPEAKER_ID=S_PiUfvBA92

export DOUBAO_ENABLE_SHAWUJING=1
export DOUBAO_SHAWUJING_SPEAKER_ID=S_OiUfvBA92

export DOUBAO_ENABLE_TANGSENG=1
export DOUBAO_TANGSENG_SPEAKER_ID=S_NiUfvBA92

cd "$PROJECT_DIR"
BUSINESS_INTERNAL_API_TOKEN="$(
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
)"
export BUSINESS_INTERNAL_API_TOKEN
export BUSINESS_BACKEND_INTERNAL_BASE_URL="http://127.0.0.1:8765/internal"
export BUSINESS_BACKEND_HOST="127.0.0.1"
export BUSINESS_BACKEND_PORT="8765"

BUSINESS_BACKEND_LOG="$(mktemp "${TMPDIR:-/tmp}/doubao-business.XXXXXX.log")"
node business_backend/server.js >"$BUSINESS_BACKEND_LOG" 2>&1 &
BUSINESS_BACKEND_PID=$!

sleep 0.25
if ! kill -0 "$BUSINESS_BACKEND_PID" 2>/dev/null; then
  printf '错误：业务后端与首页服务启动失败。\n' >&2
  while IFS= read -r log_line; do
    printf '%s\n' "$log_line" >&2
  done <"$BUSINESS_BACKEND_LOG"
  exit 1
fi

printf '手机端入口：http://127.0.0.1:8765/ui_prototypes/yuhuang_mobile_v1/choice.html\n'
printf 'Realtime Relay：http://127.0.0.1:3001/\n'

node server_doubao_realtime.js
