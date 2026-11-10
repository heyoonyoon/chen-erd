#!/usr/bin/env bash
#
# 새 EC2 인스턴스를 Chen ERD 실행 환경으로 만든다.
#   - Docker와 compose 플러그인 설치
#   - 스왑 1GB 추가(작은 인스턴스용. 이미 스왑이 있으면 건너뜀)
#   - /opt/chen-erd 디렉터리 생성
#   - 현재 사용자를 docker 그룹에 추가
#
# 지원: Amazon Linux 2023, Ubuntu 22.04 / 24.04
# 여러 번 실행해도 안전하다. sudo를 쓸 수 있는 일반 사용자로 실행한다.
#
#   bash ec2-setup.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/chen-erd}"
SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-1024}"
# 비워 두면 최신 버전을 받는다(Amazon Linux에서만 쓰인다). 예: COMPOSE_VERSION=v5.7.0
COMPOSE_VERSION="${COMPOSE_VERSION:-}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '오류: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  TARGET_USER="${SUDO_USER:-root}"
else
  command -v sudo >/dev/null 2>&1 || die "sudo가 필요합니다."
  SUDO="sudo"
  TARGET_USER="$(id -un)"
fi

[ -r /etc/os-release ] || die "/etc/os-release를 읽을 수 없습니다. 지원하지 않는 시스템입니다."
# shellcheck disable=SC1091
. /etc/os-release
OS_ID="${ID:-}"
OS_VERSION="${VERSION_ID:-}"

has_compose() { docker compose version >/dev/null 2>&1 || $SUDO docker compose version >/dev/null 2>&1; }

# ── Docker 설치 ──────────────────────────────────────────────

install_compose_binary() {
  # Amazon Linux 저장소에 compose 플러그인이 없을 때 공식 배포 파일을 받아 설치한다.
  local arch base dir tmp
  case "$(uname -m)" in
    x86_64) arch="x86_64" ;;
    aarch64 | arm64) arch="aarch64" ;;
    *) die "지원하지 않는 CPU 아키텍처입니다: $(uname -m)" ;;
  esac
  if [ -n "$COMPOSE_VERSION" ]; then
    base="https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}"
  else
    base="https://github.com/docker/compose/releases/latest/download"
  fi
  dir="/usr/local/lib/docker/cli-plugins"
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 -o "${tmp}/docker-compose-linux-${arch}" "${base}/docker-compose-linux-${arch}"
  curl -fsSL --retry 3 -o "${tmp}/docker-compose-linux-${arch}.sha256" "${base}/docker-compose-linux-${arch}.sha256"
  (cd "$tmp" && sha256sum -c "docker-compose-linux-${arch}.sha256") || die "compose 파일의 체크섬이 맞지 않습니다."
  $SUDO install -d -m 0755 "$dir"
  $SUDO install -m 0755 "${tmp}/docker-compose-linux-${arch}" "${dir}/docker-compose"
  rm -rf "$tmp"
}

install_amazon_linux() {
  if ! command -v docker >/dev/null 2>&1; then
    log "Docker 설치 (Amazon Linux)"
    $SUDO dnf install -y docker
  fi
  $SUDO systemctl enable --now docker
  if ! has_compose; then
    log "compose 플러그인 설치"
    if ! $SUDO dnf install -y docker-compose-plugin >/dev/null 2>&1; then
      install_compose_binary
    fi
  fi
}

install_ubuntu() {
  if ! command -v docker >/dev/null 2>&1 || ! has_compose; then
    log "Docker 설치 (Ubuntu ${OS_VERSION})"
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y
    $SUDO apt-get install -y ca-certificates curl
    $SUDO install -m 0755 -d /etc/apt/keyrings
    if [ ! -s /etc/apt/keyrings/docker.asc ]; then
      $SUDO curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      $SUDO chmod a+r /etc/apt/keyrings/docker.asc
    fi
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" |
      $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
  $SUDO systemctl enable --now docker
}

case "$OS_ID" in
  amzn)
    [ "${OS_VERSION%%.*}" = "2023" ] || die "Amazon Linux 2023만 지원합니다(현재: ${OS_VERSION})."
    install_amazon_linux
    ;;
  ubuntu)
    case "$OS_VERSION" in
      22.04 | 24.04) ;;
      *) echo "주의: Ubuntu ${OS_VERSION}에서는 확인하지 않았습니다. 그대로 진행합니다." >&2 ;;
    esac
    install_ubuntu
    ;;
  *)
    die "지원하지 않는 배포판입니다: ${OS_ID:-알 수 없음}. Amazon Linux 2023 또는 Ubuntu 22.04/24.04에서 실행하십시오."
    ;;
esac

has_compose || die "docker compose를 실행할 수 없습니다. 설치 로그를 확인하십시오."

# ── 스왑 ─────────────────────────────────────────────────────

if [ -n "$(swapon --noheadings --show 2>/dev/null)" ]; then
  log "스왑이 이미 켜져 있어 건너뜁니다."
else
  log "스왑 ${SWAP_SIZE_MB}MB 추가 (${SWAP_FILE})"
  if [ ! -f "$SWAP_FILE" ]; then
    # 파일 시스템에 따라 fallocate로 만든 파일은 스왑으로 쓸 수 없으므로 dd로 채운다.
    $SUDO dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none
    $SUDO chmod 600 "$SWAP_FILE"
    $SUDO mkswap "$SWAP_FILE" >/dev/null
  fi
  $SUDO swapon "$SWAP_FILE"
fi
if [ -f "$SWAP_FILE" ] && ! grep -qE "^${SWAP_FILE}[[:space:]]" /etc/fstab; then
  echo "${SWAP_FILE} none swap sw 0 0" | $SUDO tee -a /etc/fstab >/dev/null
fi

# ── 디렉터리와 권한 ──────────────────────────────────────────

log "${APP_DIR} 준비"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
$SUDO install -d -m 0755 -o "$TARGET_USER" -g "$TARGET_GROUP" "$APP_DIR" "$APP_DIR/deploy" "$APP_DIR/backups"

getent group docker >/dev/null 2>&1 || $SUDO groupadd docker
NEED_RELOGIN=0
if ! id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx docker; then
  log "${TARGET_USER} 사용자를 docker 그룹에 추가"
  $SUDO usermod -aG docker "$TARGET_USER"
  NEED_RELOGIN=1
fi

log "완료"
$SUDO docker --version
$SUDO docker compose version
echo "앱 디렉터리: ${APP_DIR}"
if [ "$NEED_RELOGIN" -eq 1 ]; then
  echo "docker 그룹은 다음 로그인부터 적용됩니다. SSH 접속을 끊었다가 다시 접속하십시오."
fi
