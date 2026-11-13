#!/usr/bin/env bash
# 운영 서버의 관리자 페이지(서버 안 127.0.0.1:9000)를 SSH 터널로 이 컴퓨터의 localhost:9000 에 잇고 브라우저로 연다.
# 관리자 페이지는 인터넷에 열려 있지 않다. 이 터널로만 들어간다.
#
#   scripts/admin-tunnel.sh                         기본 서버(modelll.app)
#   MODELLL_HOST=1.2.3.4 scripts/admin-tunnel.sh    다른 서버
#   SSH_KEY=~/.ssh/other.pem SSH_USER=ubuntu ...    키와 사용자 바꾸기
#
# Ctrl+C로 터널을 닫는다.
set -euo pipefail

HOST="${MODELLL_HOST:-modelll.app}"
KEY="${SSH_KEY:-$HOME/.ssh/chen-erd-deploy.pem}"
USER_NAME="${SSH_USER:-ec2-user}"
PORT=9000

if [ ! -f "$KEY" ]; then
  echo "SSH 키가 없습니다: $KEY (SSH_KEY로 바꿀 수 있습니다)" >&2
  exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "이 컴퓨터의 $PORT 포트를 이미 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄고 다시 실행하세요." >&2
  exit 1
fi

echo "터널을 엽니다: localhost:$PORT -> $USER_NAME@$HOST 의 127.0.0.1:$PORT (Ctrl+C로 닫기)"
ssh -i "$KEY" -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "127.0.0.1:$PORT:127.0.0.1:$PORT" "$USER_NAME@$HOST" &
SSH_PID=$!
trap 'kill "$SSH_PID" 2>/dev/null || true' EXIT INT TERM

# 터널이 열릴 때까지 잠깐 기다린 뒤 브라우저를 연다
for _ in $(seq 1 20); do
  if ! kill -0 "$SSH_PID" 2>/dev/null; then
    echo "터널을 열지 못했습니다." >&2
    exit 1
  fi
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then break; fi
  sleep 0.5
done
if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT"; else echo "브라우저에서 http://localhost:$PORT 를 엽니다."; fi
wait "$SSH_PID"
