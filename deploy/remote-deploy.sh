#!/usr/bin/env bash
#
# EC2에서 실행되는 배포 스크립트. GitHub Actions의 Deploy 워크플로가 SSH로 부르고, 서버에서 직접 실행해도 된다.
#
#   remote-deploy.sh up <이미지 태그>   .env의 IMAGE_TAG를 바꾸고 이미지를 내려받아 컨테이너를 교체한다
#   remote-deploy.sh health [초]        /api/health가 200을 돌려줄 때까지 기다린다(기본 60초)
#
# 예) 이전 버전으로 되돌리기: ./deploy/remote-deploy.sh up <이전 커밋 SHA> && ./deploy/remote-deploy.sh health

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/chen-erd}"
cd "$APP_DIR"

die() { printf '오류: %s\n' "$*" >&2; exit 1; }

# .env에서 값을 읽는다. 없으면 빈 문자열.
env_get() {
  local line
  line="$(grep -E "^[[:space:]]*$1=" .env 2>/dev/null | tail -n 1 || true)"
  line="${line#*=}"
  # 줄 끝의 CR과 양쪽 따옴표를 떼어 낸다.
  line="${line%$'\r'}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

# .env의 값을 바꾸거나, 없으면 줄을 추가한다.
env_set() {
  local key="$1" value="$2" tmp
  touch .env
  if grep -qE "^[[:space:]]*${key}=" .env; then
    tmp="$(mktemp)"
    sed -E "s|^[[:space:]]*${key}=.*|${key}=${value}|" .env >"$tmp"
    cat "$tmp" >.env
    rm -f "$tmp"
  else
    if [ -s .env ] && [ -n "$(tail -c 1 .env)" ]; then echo >>.env; fi
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

https_enabled() {
  case ",$(env_get COMPOSE_PROFILES)," in
    *,https,*) return 0 ;;
    *) return 1 ;;
  esac
}

# HTTPS 프로필은 세 값이 함께 맞아야 한다. 틀리면 80번 포트가 겹치거나 인증서를 받지 못한다.
check_config() {
  local publish
  [ -f docker-compose.yml ] || die "${APP_DIR}/docker-compose.yml이 없습니다."
  if https_enabled; then
    [ -n "$(env_get DOMAIN)" ] || die ".env에 COMPOSE_PROFILES=https가 있지만 DOMAIN이 비어 있습니다."
    [ -f deploy/Caddyfile ] || die "${APP_DIR}/deploy/Caddyfile이 없습니다."
    publish="$(env_get APP_PUBLISH)"
    case "$publish" in
      "" | 80 | *:80)
        die ".env에 COMPOSE_PROFILES=https가 있으면 APP_PUBLISH=127.0.0.1:8787도 있어야 합니다(지금 값: '${publish}'). 80번은 caddy가 씁니다."
        ;;
    esac
  fi
}

cmd_up() {
  local tag="${1:-}"
  [ -n "$tag" ] || die "이미지 태그를 지정하십시오. 예: remote-deploy.sh up latest"
  [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "이미지 태그 형식이 올바르지 않습니다: ${tag}"

  check_config
  env_set IMAGE_TAG "$tag"
  echo "IMAGE_TAG=${tag}"

  docker compose pull

  # HTTPS를 끈 경우 남아 있는 caddy가 80번을 잡고 있으면 app이 뜨지 못한다.
  if ! https_enabled; then
    docker compose --profile https rm --stop --force caddy >/dev/null 2>&1 || true
  fi

  docker compose up -d --remove-orphans

  # Caddyfile이 바뀌었을 수 있으니 다시 읽게 한다.
  if https_enabled; then
    docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  fi

  # 쓰지 않는 이미지를 지운다(작은 디스크가 차지 않도록). 이전 버전은 레지스트리에서 다시 받을 수 있다.
  docker image prune -af >/dev/null
  docker compose ps
}

cmd_health() {
  local timeout="${1:-60}" deadline addr port
  [[ "$timeout" =~ ^[0-9]+$ ]] || die "대기 시간은 초 단위 숫자여야 합니다: ${timeout}"
  command -v curl >/dev/null 2>&1 || die "curl이 필요합니다."

  deadline=$((SECONDS + timeout))
  while :; do
    # 예: "0.0.0.0:80" 또는 "127.0.0.1:8787"
    addr="$(docker compose port app 8787 2>/dev/null | head -n 1 || true)"
    port="${addr##*:}"
    if [ -n "$port" ] && curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${port}/api/health"; then
      echo "정상: http://127.0.0.1:${port}/api/health"
      break
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "오류: ${timeout}초 안에 /api/health가 응답하지 않았습니다." >&2
      docker compose ps >&2 || true
      docker compose logs --tail 80 app >&2 || true
      exit 1
    fi
    sleep 3
  done

  if https_enabled; then
    local domain
    domain="$(env_get DOMAIN)"
    if [ -z "$(docker compose ps --status running -q caddy 2>/dev/null)" ]; then
      echo "오류: caddy 컨테이너가 실행 중이 아닙니다." >&2
      docker compose logs --tail 80 caddy >&2 || true
      exit 1
    fi
    # 인증서 발급은 DNS 설정에 달려 있고 처음에는 시간이 걸리므로 실패해도 배포를 되돌리지 않고 알리기만 한다.
    if curl -fsS -o /dev/null --max-time 10 --retry 5 --retry-delay 3 --retry-all-errors \
      --resolve "${domain}:443:127.0.0.1" "https://${domain}/api/health"; then
      echo "정상: https://${domain}/api/health"
    else
      echo "주의: https://${domain}/api/health 확인에 실패했습니다. 도메인의 DNS와 보안 그룹(80, 443), 'docker compose logs caddy'를 확인하십시오." >&2
    fi
  fi
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  health) shift; cmd_health "$@" ;;
  *) die "사용법: remote-deploy.sh up <이미지 태그> | health [초]" ;;
esac
