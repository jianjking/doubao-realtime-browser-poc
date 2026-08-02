#!/usr/bin/env bash

set -euo pipefail

SCRIPT_LOCATION="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_LOCATION" != */* ]]; then
  SCRIPT_LOCATION="./$SCRIPT_LOCATION"
fi
PROJECT_DIR="$(cd "${SCRIPT_LOCATION%/*}" && pwd)"
BUSINESS_BACKEND_PID=""
RELAY_PID=""
CLEANUP_STARTED=0
READY_TIMEOUT_SECONDS=15

cleanup() {
  if [[ "$CLEANUP_STARTED" -eq 1 ]]; then
    return
  fi
  CLEANUP_STARTED=1

  local pid
  for pid in "$RELAY_PID" "$BUSINESS_BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  local attempt
  for attempt in {1..20}; do
    local child_running=0
    for pid in "$RELAY_PID" "$BUSINESS_BACKEND_PID"; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        child_running=1
      fi
    done
    if [[ "$child_running" -eq 0 ]]; then
      break
    fi
    sleep 0.1
  done

  for pid in "$RELAY_PID" "$BUSINESS_BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}

handle_signal() {
  cleanup
  exit 130
}

run_node_helper() {
  node - "$@" <<'NODE'
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

const mode = process.argv[2];
const value = process.argv[3];

function main() {
if (mode === 'port-open') {
  const port = Number(value);
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
  return;
}

if (mode === 'validate-origin') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    process.exit(1);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.origin === 'null'
  ) {
    process.exit(1);
  }
  process.exit(0);
}

if (mode === 'http-ready') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    process.exit(2);
  }
  const transport = parsed.protocol === 'https:' ? https : http;
  const request = transport.get(parsed, {
    headers: { Connection: 'close' },
  }, (response) => {
    response.resume();
    response.once('end', () => {
      process.exit(response.statusCode === 200 ? 0 : 1);
    });
  });
  request.once('error', () => process.exit(1));
  request.setTimeout(500, () => {
    request.destroy();
    process.exit(1);
  });
  return;
}

if (mode === 'token') {
  process.stdout.write(crypto.randomBytes(32).toString('base64url'));
  return;
}

process.exit(2);
}

main();
NODE
}

check_port_in_use() {
  run_node_helper port-open "$1"
}

validate_port() {
  local port="$1"
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    printf '错误：端口 %s 必须是 1 到 65535 之间的整数。\n' "$port" >&2
    return 1
  fi
}

require_sensitive_env() {
  local name="$1"
  local prompt="$2"
  local current="${!name-}"
  local entered=""

  if [[ -n "$current" ]]; then
    return
  fi
  if ! IFS= read -r -s -p "$prompt" entered; then
    printf '\n'
    printf '错误：%s 不能为空。\n' "$name" >&2
    return 1
  fi
  printf '\n'
  if [[ -z "${entered//[[:space:]]/}" ]]; then
    printf '错误：%s 不能为空。\n' "$name" >&2
    unset entered
    return 1
  fi
  printf -v "$name" '%s' "$entered"
  export "$name"
  unset entered
}

configure_voice_service_credentials() {
  local voice_key="${VOLCENGINE_API_KEY-}"
  local name=""

  if [[ -z "$voice_key" ]]; then
    voice_key="${DOUBAO_ASR_API_KEY-}"
  fi
  if [[ -z "$voice_key" ]]; then
    voice_key="${FORTUNE_TTS_API_KEY-}"
  fi
  if [[ -z "$voice_key" ]]; then
    if ! IFS= read -r -s -p \
      "请输入语音服务 API Key（实时通话、求签 ASR、道童 TTS 共用）：" \
      voice_key; then
      printf '\n'
      printf '错误：语音服务 API Key 不能为空。\n' >&2
      return 1
    fi
    printf '\n'
    if [[ -z "${voice_key//[[:space:]]/}" ]]; then
      printf '错误：语音服务 API Key 不能为空。\n' >&2
      unset voice_key
      return 1
    fi
  fi

  for name in \
    VOLCENGINE_API_KEY \
    DOUBAO_ASR_API_KEY \
    FORTUNE_TTS_API_KEY; do
    if [[ -z "${!name-}" ]]; then
      printf -v "$name" '%s' "$voice_key"
      export "$name"
    fi
  done
  unset voice_key
}

validate_demo_configuration() {
  node - validate-config <<'NODE'
try {
  const {
    createInternalCallLifecycleClientFromEnv,
  } = require('./internal_call_lifecycle_client');
  const {
    createFortuneAsrConfigFromEnv,
  } = require('./fortune_asr_client');
  const {
    createFortuneInterpretationClientFromEnv,
  } = require('./business_backend/clients/fortune_interpretation_client');
  const {
    createFortuneTtsClientFromEnv,
  } = require('./business_backend/clients/fortune_tts_client');
  const {
    parsePaymentRuntimeConfig,
  } = require('./business_backend/config/payments');

  createInternalCallLifecycleClientFromEnv({
    env: process.env,
    fetchImpl: async () => {
      throw new Error('configuration validation must not access the network');
    },
  });
  createFortuneAsrConfigFromEnv(process.env);
  createFortuneInterpretationClientFromEnv({
    env: process.env,
    fetchImpl: async () => {
      throw new Error('configuration validation must not access the network');
    },
  });
  createFortuneTtsClientFromEnv({
    env: process.env,
    fetchImpl: async () => {
      throw new Error('configuration validation must not access the network');
    },
  });
  parsePaymentRuntimeConfig(process.env);
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : 'unknown configuration error';
  console.error(`错误：完整演示配置无效：${message}`);
  process.exit(1);
}
NODE
}

wait_for_http_ready() {
  local label="$1"
  local url="$2"
  local started_at="$SECONDS"

  while (( SECONDS - started_at < READY_TIMEOUT_SECONDS )); do
    if [[ -n "$BUSINESS_BACKEND_PID" ]] \
      && ! kill -0 "$BUSINESS_BACKEND_PID" 2>/dev/null; then
      printf '错误：业务后端与首页服务在就绪前退出。\n' >&2
      return 1
    fi
    if [[ -n "$RELAY_PID" ]] && ! kill -0 "$RELAY_PID" 2>/dev/null; then
      printf '错误：Realtime Relay 在就绪前退出。\n' >&2
      return 1
    fi
    if run_node_helper http-ready "$url"; then
      return 0
    fi
    sleep 0.2
  done

  printf '错误：等待%s就绪超时。\n' "$label" >&2
  return 1
}

monitor_children() {
  local child_status
  while true; do
    if ! kill -0 "$BUSINESS_BACKEND_PID" 2>/dev/null; then
      set +e
      wait "$BUSINESS_BACKEND_PID"
      child_status=$?
      set -e
      printf '错误：业务后端与首页服务意外退出。\n' >&2
      if [[ "$child_status" -eq 0 ]]; then
        return 1
      fi
      return "$child_status"
    fi
    if ! kill -0 "$RELAY_PID" 2>/dev/null; then
      set +e
      wait "$RELAY_PID"
      child_status=$?
      set -e
      printf '错误：Realtime Relay 意外退出。\n' >&2
      if [[ "$child_status" -eq 0 ]]; then
        return 1
      fi
      return "$child_status"
    fi
    sleep 0.2
  done
}

trap cleanup EXIT
trap handle_signal INT TERM

if ! command -v node >/dev/null 2>&1; then
  printf '错误：未找到 node 命令。\n' >&2
  exit 1
fi

for required_file in \
  business_backend/server.js \
  server_doubao_realtime.js \
  internal_call_lifecycle_client.js \
  fortune_asr_client.js \
  business_backend/clients/fortune_interpretation_client.js \
  business_backend/clients/fortune_tts_client.js; do
  if [[ ! -f "$PROJECT_DIR/$required_file" ]]; then
    printf '错误：缺少启动入口或依赖文件：%s。\n' "$required_file" >&2
    exit 1
  fi
done

validate_port 3001
validate_port 8765

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

PAYMENT_PROVIDER_MODE="${PAYMENT_PROVIDER_MODE:-mock}"
PAYMENT_MOCK_CONFIRMATION_ENABLED="${PAYMENT_MOCK_CONFIRMATION_ENABLED:-1}"
if [[ "$PAYMENT_PROVIDER_MODE" != "disabled" \
  && "$PAYMENT_PROVIDER_MODE" != "mock" \
  && "$PAYMENT_PROVIDER_MODE" != "live" ]]; then
  printf '错误：PAYMENT_PROVIDER_MODE 必须是 disabled、mock 或 live。\n' >&2
  exit 1
fi
if [[ "$PAYMENT_MOCK_CONFIRMATION_ENABLED" != "0" \
  && "$PAYMENT_MOCK_CONFIRMATION_ENABLED" != "1" ]]; then
  printf '错误：PAYMENT_MOCK_CONFIRMATION_ENABLED 必须是 0 或 1。\n' >&2
  exit 1
fi
if [[ "${NODE_ENV-}" == "production" \
  && ( "$PAYMENT_PROVIDER_MODE" == "mock" \
    || "$PAYMENT_MOCK_CONFIRMATION_ENABLED" == "1" ) ]]; then
  printf '错误：生产环境禁止启用 Mock 支付。\n' >&2
  exit 1
fi
export PAYMENT_PROVIDER_MODE
export PAYMENT_MOCK_CONFIRMATION_ENABLED

configure_voice_service_credentials
require_sensitive_env \
  FORTUNE_TEXT_MODEL_API_KEY \
  "请输入文本模型 API Key（用于生成文字解签）："

export DOUBAO_ENABLE_FORTUNE_ASR=1
if [[ -z "${DOUBAO_ASR_RESOURCE_ID-}" ]]; then
  export DOUBAO_ASR_RESOURCE_ID="volc.seedasr.sauc.duration"
fi

FORTUNE_TEXT_MODEL_BASE_URL="${FORTUNE_TEXT_MODEL_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
export FORTUNE_TEXT_MODEL_BASE_URL
FORTUNE_TEXT_MODEL_NAME="${FORTUNE_TEXT_MODEL_NAME:-deepseek-v4-flash-260425}"
export FORTUNE_TEXT_MODEL_NAME
export FORTUNE_TEXT_MODEL_TIMEOUT_MS="${FORTUNE_TEXT_MODEL_TIMEOUT_MS:-30000}"
FORTUNE_TTS_RESOURCE_ID="${FORTUNE_TTS_RESOURCE_ID:-seed-icl-2.0}"
export FORTUNE_TTS_RESOURCE_ID
FORTUNE_TTS_SPEAKER_ID="${FORTUNE_TTS_SPEAKER_ID:-S_bpBL3BA92}"
export FORTUNE_TTS_SPEAKER_ID

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
  run_node_helper token
)"
export BUSINESS_INTERNAL_API_TOKEN
export BUSINESS_BACKEND_INTERNAL_BASE_URL="http://127.0.0.1:8765"
export BUSINESS_BACKEND_HOST="127.0.0.1"
export BUSINESS_BACKEND_PORT="8765"

if ! run_node_helper validate-origin "$BUSINESS_BACKEND_INTERNAL_BASE_URL"; then
  printf '错误：BUSINESS_BACKEND_INTERNAL_BASE_URL 必须是绝对 HTTP(S) origin。\n' >&2
  exit 1
fi
validate_demo_configuration

node business_backend/server.js &
BUSINESS_BACKEND_PID=$!

node server_doubao_realtime.js &
RELAY_PID=$!

if ! wait_for_http_ready \
  "业务后端与首页服务" \
  "http://127.0.0.1:8765/api/health"; then
  exit 1
fi
if ! wait_for_http_ready \
  "Realtime Relay" \
  "http://127.0.0.1:3001/"; then
  exit 1
fi

printf '手机端入口：http://127.0.0.1:8765/\n'
printf '支付模式：Mock（不会产生真实扣款）\n'
printf 'Realtime Relay：http://127.0.0.1:3001/\n'
printf '求签 ASR：ws://127.0.0.1:3001/fortune-asr\n'

monitor_children
