#!/usr/bin/env bash
#
# 다이어그램 저장소(app 컨테이너의 /data 볼륨)를 날짜가 붙은 tar.gz로 묶어 둔다.
# 14일이 지난 백업은 지운다.
#
#   /opt/chen-erd/deploy/backup.sh
#
# cron 등록 예시(매일 새벽 4시 10분):
#   10 4 * * * /opt/chen-erd/deploy/backup.sh >> /opt/chen-erd/backups/backup.log 2>&1
#
# 복원 방법은 README의 "데이터 저장과 백업"에 있다.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/chen-erd}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# cron은 PATH가 짧다.
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="${BACKUP_DIR}/erd-data-${stamp}.tar.gz"
tmp="${target}.partial"
trap 'rm -f "$tmp"' EXIT

if [ -n "$(docker compose ps --status running -q app 2>/dev/null)" ]; then
  # 실행 중이면 그 컨테이너 안에서 묶어 표준 출력으로 받는다.
  docker compose exec -T app tar -czf - -C /data . >"$tmp"
else
  # 꺼져 있으면 같은 볼륨을 붙인 일회용 컨테이너로 묶는다.
  docker compose run --rm --no-deps -T --entrypoint tar app -czf - -C /data . >"$tmp"
fi

# 깨진 파일을 정상 백업으로 남기지 않는다(끝까지 읽히는지 확인).
[ -s "$tmp" ] || { echo "오류: 백업 파일이 비어 있습니다." >&2; exit 1; }
tar -tzf "$tmp" >/dev/null
mv "$tmp" "$target"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'erd-data-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

size="$(du -h "$target" | cut -f1)"
count="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'erd-data-*.tar.gz' | wc -l | tr -d ' ')"
echo "$(date '+%Y-%m-%d %H:%M:%S') 백업 완료: ${target} (${size}), 보관 중 ${count}개"
