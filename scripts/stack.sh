#!/usr/bin/env bash
# Start/stop the local test stack: a fake OpenAI-compatible LLM plus two app instances
#   :3100  AI configured (points at the fake LLM)      :3101  AI NOT configured
# Usage: scripts/stack.sh start|stop|status [dev|prod]     (default: prod; run `npm run build` first)
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=.stack
mkdir -p "$RUN"
MODE="${2:-prod}"

stop_pid() { [ -f "$RUN/$1.pid" ] && kill "$(cat "$RUN/$1.pid")" 2>/dev/null || true; rm -f "$RUN/$1.pid"; }
wait_http() { for _ in $(seq 1 90); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "timeout waiting for $1" >&2; return 1; }

case "${1:-}" in
  start)
    "$0" stop >/dev/null 2>&1 || true
    set -a; . ./.env; set +a
    node scripts/fake-llm.mjs 4010 > "$RUN/fake-llm.log" 2>&1 & echo $! > "$RUN/llm.pid"
    PORT=5001 python3 scripts/verify-server.py > "$RUN/verify.log" 2>&1 & echo $! > "$RUN/verify.pid"
    CMD="npx next start"; [ "$MODE" = dev ] && CMD="npx next dev"
    LLM_PROVIDER=openai OPENAI_API_KEY=sk-test-fake-key OPENAI_BASE_URL=http://127.0.0.1:4010/v1 OPENAI_MODEL=gpt-4o-mini \
      LLM_TIMEOUT_MS=4000 AI_RATE_LIMIT_PER_MIN=1000 $CMD -p 3100 > "$RUN/app-ai.log" 2>&1 & echo $! > "$RUN/app-ai.pid"
    LLM_PROVIDER=none $CMD -p 3101 > "$RUN/app-noai.log" 2>&1 & echo $! > "$RUN/app-noai.pid"
    wait_http http://127.0.0.1:4010/__last; wait_http http://127.0.0.1:3100/api/folders; wait_http http://127.0.0.1:3101/api/folders
    echo "stack up ($MODE): app+AI :3100, app no-AI :3101, fake LLM :4010, verify :5001" ;;
  stop)
    for n in app-ai app-noai llm verify; do stop_pid "$n"; done
    # next spawns a child server process; sweep by port as well
    for p in 3100 3101 4010 5001; do fuser -k "$p"/tcp >/dev/null 2>&1 || true; done
    echo "stack stopped" ;;
  status)
    for p in 3100 3101 4010; do curl -s -o /dev/null "http://127.0.0.1:$p/" && echo "port $p: up" || echo "port $p: down"; done ;;
  *) echo "usage: $0 start|stop|status [dev|prod]" >&2; exit 2 ;;
esac
