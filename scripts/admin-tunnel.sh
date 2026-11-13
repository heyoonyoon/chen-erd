#!/usr/bin/env bash
#
# 운영 서버의 관리자 페이지(서버 안 127.0.0.1:9000)를 AWS Session Manager 포트 포워딩으로
# 이 컴퓨터의 localhost:9000 에 잇고 브라우저로 연다. 서버의 22번(SSH) 포트는 닫혀 있다.
#
#   scripts/admin-tunnel.sh
#
# 필요한 것: AWS CLI(이 계정으로 로그인된 상태)와 session-manager-plugin
#   brew install awscli && brew install --cask session-manager-plugin
#
# 환경변수
#   MODELLL_INSTANCE_ID   서버 인스턴스 ID(기본 i-0174bd666d2204aaa)
#   AWS_REGION            리전(기본 ap-northeast-2)
#   AWS_PROFILE           쓸 AWS CLI 프로필(없으면 기본 프로필)
#
# 관리자 페이지는 Host가 localhost:9000 인 요청만 받으므로 이 컴퓨터 쪽 포트도 9000을 쓴다.
# 끝내려면 Ctrl+C.

set -euo pipefail

INSTANCE_ID="${MODELLL_INSTANCE_ID:-i-0174bd666d2204aaa}"
REGION="${AWS_REGION:-ap-northeast-2}"
PORT=9000

die() { printf '%s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || die "AWS CLI가 없습니다. brew install awscli 로 설치하세요."
command -v session-manager-plugin >/dev/null 2>&1 || die "session-manager-plugin이 없습니다. brew install --cask session-manager-plugin 으로 설치하세요."

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "이 컴퓨터의 ${PORT} 포트를 이미 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄고 다시 실행하세요."
fi

aws sts get-caller-identity >/dev/null 2>&1 || die "AWS에 로그인되어 있지 않습니다. aws configure 또는 aws sso login 을 먼저 하세요."

# 터널이 열리면 브라우저를 띄운다
(
  for _ in $(seq 1 40); do
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      open "http://localhost:${PORT}" 2>/dev/null || true
      exit 0
    fi
    sleep 0.5
  done
) &

echo "관리자 페이지 터널을 엽니다: http://localhost:${PORT}  (끝내려면 Ctrl+C)"
exec aws ssm start-session \
  --region "$REGION" \
  --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=${PORT},localPortNumber=${PORT}"
