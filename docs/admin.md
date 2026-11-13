# 관리자 페이지(서비스 지표) 운영 메모

관리자 페이지는 서버 안 `127.0.0.1:9000`에만 열린다. 인터넷(Caddy, 8787)에는 관리자 경로가 없고, AWS Session Manager 포트 포워딩으로만 본다. 서버의 22번(SSH) 포트는 닫혀 있고 배포도 Session Manager로 한다.

## 처음 한 번 설정

1. 내 컴퓨터에서 비밀번호 해시를 만든다(입력한 글자는 화면에 보이지 않는다, 12자 이상).

   ```sh
   node scripts/admin-password.mjs
   ```

2. 서버의 `/opt/chen-erd/.env`에 두 줄을 넣는다(`aws ssm start-session --target <인스턴스>`로 서버에 들어간다). 해시에는 `$`가 있으니 작은따옴표로 감싼다.

   ```sh
   ADMIN_PASSWORD_HASH='scrypt$32768$8$1$...$...'
   STATS_SALT=<openssl rand -hex 32 의 결과>
   ```

   `STATS_SALT`를 비워 두면 서버가 처음 켤 때 만들어 데이터 볼륨(`/data/stats/salt`, 0600)에 둔다. 한 번 정하면 바꾸지 않는다(바꾸면 사람 구분이 끊긴다).

3. 새 `docker-compose.yml`로 컨테이너를 다시 띄운다. 관리자 포트는 `127.0.0.1:9000:9000`으로만 묶여 있다. 보안 그룹에서 9000을 열지 않는다.

## 보기

```sh
scripts/admin-tunnel.sh                                  # 기본 인스턴스
MODELLL_INSTANCE_ID=i-xxxxxxxx scripts/admin-tunnel.sh   # 다른 인스턴스
```

필요한 것: 이 계정으로 로그인된 AWS CLI와 `session-manager-plugin`(`brew install --cask session-manager-plugin`).

터널을 열고 `http://localhost:9000`을 브라우저로 연다. 로컬 포트는 9000 그대로 쓴다(관리자 페이지가 Host를 `localhost:9000`으로만 받는다). 다른 포트로 이어야 하면 서버에 `ADMIN_PUBLIC_PORT`를 그 포트로 준다.

## 환경변수

| 이름 | 기본 | 뜻 |
| --- | --- | --- |
| `STATS` | on | `off`면 지표를 모으지 않고 관리자 페이지도 열지 않는다 |
| `STATS_SALT` | 자동 생성 | 익명 ID와 방 id를 해시하는 비밀 값(32자 이상) |
| `TELEMETRY_REQUESTS_PER_MINUTE` | 120 | 한 주소가 1분에 보낼 수 있는 지표 이벤트 수 |
| `ADMIN_PORT` | 9000 | 0이면 관리자 페이지를 열지 않는다 |
| `ADMIN_HOST` | 127.0.0.1 | 컨테이너 안에서는 0.0.0.0(compose가 넣는다) |
| `ADMIN_PASSWORD_HASH` | 없음 | 없으면 아무도 로그인할 수 없다 |

## 저장 위치

`DATA_DIR/stats/`: `daily.jsonl`(확정된 하루 집계, 숫자만), `today.json`(오늘 진행 중, 1분마다), `users.json`(해시 → 첫·마지막 방문일), `rooms.json`, `salt`. 이름, 이메일, IP, 방 내용, User-Agent 원문은 저장하지 않는다. 백업(`deploy/backup.sh`)은 데이터 볼륨째 담으므로 따로 할 일이 없다.
