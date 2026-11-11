# modelll

Chen 표기법의 ER 다이어그램과 EER 다이어그램을 여러 사람이 한 화면에서 동시에 그리는 웹 도구입니다. 대학 데이터베이스 수업의 설계 과제는 Chen 표기법으로 ERD를 그려 제출하는데, 널리 쓰이는 ERD 도구는 대부분 까마귀발 표기법만 지원하고 범용 그림 도구는 이중 마름모나 점선 밑줄 같은 도형을 매번 손으로 만들어야 합니다. 팀원이 각자 그린 그림을 합치는 수고를 없애고 수업에서 배운 표기 그대로 함께 그릴 수 있도록 이 도구를 만들었습니다.

방을 만들면 주소가 하나 생기고 그 주소를 받은 사람은 로그인 없이 이름만 정하고 들어와 같은 다이어그램을 편집합니다. 다른 사람이 옮기는 도형과 마우스 포인터가 바로 보이며 변경 내용은 서버에 자동으로 저장됩니다. 30일 동안 아무도 열지 않은 다이어그램은 서버에서 자동으로 삭제됩니다. 화면은 한국어와 영어를 포함한 10개 언어로 볼 수 있습니다. 다이어그램을 좌표 없는 글로 읽고 쓸 수 있어서 Claude나 ChatGPT 같은 AI에게 그리기와 고치기를 맡길 수도 있습니다.

## 주요 기능

1. 수업에서 쓰는 Chen 표기법 도형을 팔레트에서 골라 캔버스에 놓고 도형의 연결 점을 끌어 선으로 잇습니다.
2. 같은 방에 있는 사람의 이름과 색, 마우스 포인터, 선택한 도형이 실시간으로 보입니다.
3. 연결이 끊긴 동안 그린 내용은 다시 연결되면 다른 사람의 변경과 자동으로 합쳐집니다.
4. 선을 선택하면 카디널리티와 단선 또는 이중선, 역할 이름을 오른쪽 패널에서 바꿀 수 있습니다.
5. 검증 패널이 키 속성이 없는 엔티티나 카디널리티가 빠진 선처럼 표기법에 어긋난 부분을 찾아 알려 줍니다.
6. 도형을 옮길 때 다른 도형과 줄이 맞으면 정렬 안내선이 나타나고 격자와 미니맵, 확대와 축소를 지원합니다.
7. 완성한 다이어그램은 PNG와 SVG 그림으로 저장하거나 PNG로 복사해 문서에 바로 붙여 넣을 수 있습니다.
8. 다이어그램을 JSON 파일로 내려받아 보관하고 나중에 다시 불러올 수 있습니다.
9. 실행 취소와 다시 실행, 복사와 붙여넣기, 복제를 단축키와 우클릭 메뉴로 사용할 수 있습니다.
10. AI가 명령줄 도구나 MCP로 다이어그램을 만들고 고치며, 그 과정이 방을 열어 둔 사람의 화면에 실시간으로 보입니다.

## AI와 함께 사용하기

다이어그램은 좌표가 없는 글로 읽고 쓸 수 있습니다. AI가 이 글을 고쳐 방에 반영하면 방을 열어 둔 사람의 화면에 바뀐 내용이 바로 나타납니다. 새로 생긴 도형은 자동으로 배치되고 사람이 옮겨 둔 도형은 제자리에 남습니다. AI를 연결하는 방법은 CLI와 MCP 두 가지이며, 방 화면 상단의 `AI로 편집` 버튼을 누르면 그 방의 주소가 들어간 지시문과 MCP 주소를 바로 복사할 수 있습니다.

### CLI로 사용하기

Claude Code, Cursor, Codex처럼 명령을 실행할 수 있는 AI에게는 `npx -y modelll` 명령을 쓰도록 지시합니다. 이미 있는 방을 고칠 때는 다음과 같이 적고 마지막 줄에 바꿀 내용을 이어서 씁니다.

```text
이 modelll ER 다이어그램을 고쳐 주세요. 방 주소는 https://modelll.app/r/abc123 입니다.
먼저 `npx -y modelll syntax`를 실행해 텍스트 형식을 읽어 주세요.
그다음 `npx -y modelll pull https://modelll.app/r/abc123 -o model.mdl`로 현재 다이어그램을 받아 파일을 고치고, `npx -y modelll push https://modelll.app/r/abc123 model.mdl`로 방에 반영해 주세요.
바꿀 내용: 교수 엔티티를 추가하고 과목과 강의 관계로 이어 주세요.
```

명령은 다음과 같습니다. `<방>` 자리에는 방 주소나 방 코드를 적습니다.

| 명령 | 하는 일 |
|---|---|
| `npx -y modelll new [파일]` | 모델 파일로 새 방을 만들고 방 주소를 출력합니다. 파일을 생략하면 빈 방을 만듭니다. |
| `npx -y modelll pull <방> [-o 파일]` | 방의 다이어그램을 글로 출력하거나 파일에 씁니다. |
| `npx -y modelll push <방> <파일>` | 방의 다이어그램을 모델 파일과 같게 만듭니다. 그대로 남는 도형은 자리를 유지하며 `--relayout`을 붙이면 전체를 다시 배치합니다. |
| `npx -y modelll validate <파일>` | 방에 반영하지 않고 모델 파일의 문법과 표기법만 확인합니다. |
| `npx -y modelll syntax` | 텍스트 형식의 설명을 출력합니다. |

### MCP로 연결하기

claude.ai, ChatGPT, Cursor처럼 원격 MCP 서버를 지원하는 AI 도구에서는 아래 주소를 원격 MCP 서버나 커넥터로 추가합니다. 설치할 것이 없고, 추가한 뒤에는 "쇼핑몰 주문 ERD를 그려 주세요"처럼 말하는 것만으로 다이어그램을 만들고 고칩니다.

```text
https://modelll.app/mcp
```

AI가 사용하는 도구는 `create_diagram`, `read_diagram`, `update_diagram`, `validate_diagram`, `diagram_syntax` 다섯 가지입니다.

명령으로 등록하는 클라이언트에서는 같은 주소를 명령에 적습니다. Claude Code에서는 다음과 같습니다.

```bash
claude mcp add --transport http modelll https://modelll.app/mcp
```

### 텍스트 형식

한 줄에 문장 하나를 적으며 도형의 위치는 적지 않습니다.

```text
entity Student {
  id key
  name
  phone multi
}
entity Course { code key, title }
relationship Enrolls (Student M total, Course N) { grade }
```

이 예시는 식별자 `id`와 다중값 속성 `phone`을 가진 `Student` 엔티티, `Course` 엔티티, 두 엔티티를 M 대 N으로 잇고 `Student` 쪽이 전체 참여인 `Enrolls` 관계를 나타냅니다. 이 밖에 `weak entity`와 `identifying relationship`, 재귀 관계에서 역할 이름을 적는 `as`, `specialization Employee disjoint total { Secretary, Engineer }` 형태의 특수화, `name { first, last }` 형태의 복합 속성, `note "…"` 메모를 쓸 수 있습니다. 전체 설명은 `npx -y modelll syntax`로 확인합니다.

### 지시 예시

1. "도서관 대출 관리 ERD를 그려 주세요. 회원은 책을 여러 권 빌릴 수 있고 대출마다 대출일과 반납일이 있습니다."
2. "https://modelll.app/r/abc123 다이어그램에서 식별자가 없는 엔티티를 찾아 알맞은 키 속성을 추가해 주세요."

## 지원 표기법

선에는 화살표가 없으며 모든 도형은 검은 선과 흰 채움으로 그립니다.

| 요소 | 모양 |
|---|---|
| 엔티티 타입 | 직사각형 |
| 약한 엔티티 타입 | 이중 직사각형 |
| 관계 타입 | 마름모 |
| 식별 관계 타입 | 이중 마름모 |
| 속성 | 타원 |
| 다중값 속성 | 이중 타원 |
| 식별자 | 타원 안 글자에 밑줄 |
| 부분 키 | 타원 안 글자에 점선 밑줄 |
| 복합 속성 | 속성 타원에 하위 속성 타원을 선으로 연결 |
| 카디널리티 | 엔티티와 관계를 잇는 선 옆의 1, M, N |
| 전체 참여 | 이중선 |
| 부분 참여 | 단선 |
| 특수화 | 슈퍼타입과 서브타입 사이에 d 또는 o가 적힌 작은 원 |
| 전체 특수화 | 슈퍼타입과 원 사이를 이중선으로 연결 |
| 재귀 관계 | 같은 엔티티와 관계를 선 두 개로 잇고 역할 이름을 표기 |
| 메모 | 다이어그램에 덧붙이는 설명 글 |

## 로컬 실행

Node.js 22와 npm이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5180 을 엽니다. 개발 모드에서는 화면을 제공하는 Vite 개발 서버가 5180번 포트에서 돌고 협업 서버가 8787번 포트에서 함께 돌며, 화면에서 보내는 API 요청과 웹소켓 연결은 개발 서버가 협업 서버로 넘겨 줍니다.

운영 환경과 같은 방식으로 확인할 때는 빌드한 뒤 서버 하나만 실행합니다.

```bash
npm run build
npm start
```

이때는 http://localhost:8787 하나의 포트에서 화면과 API, 웹소켓을 모두 제공합니다. 서버는 다음 환경 변수를 읽습니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | 서버가 여는 포트 |
| `HOST` | `0.0.0.0` | 서버가 받는 주소 |
| `DATA_DIR` | `./data` | 다이어그램을 저장하는 폴더 |
| `STATIC_DIR` | `dist/client` | 빌드된 화면 파일이 있는 폴더 |

## 테스트

```bash
npm run typecheck
npm test
```

`npm run typecheck`는 타입 검사를 하고 `npm test`는 Vitest로 단위 테스트를 실행합니다. 테스트 파일은 대상 파일 옆에 `*.test.ts` 또는 `*.test.tsx`라는 이름으로 둡니다. 브라우저를 띄워 확인하는 테스트는 `e2e` 폴더에 두고 `npm run e2e`로 실행하며, 처음 실행하기 전에 `npx playwright install chromium`으로 브라우저를 설치합니다.

저장소에 코드를 올리면 GitHub Actions의 CI 워크플로가 타입 검사와 테스트, 빌드, 컨테이너 이미지 빌드를 차례로 확인합니다.

## 폴더 구조

```text
src/
  shared/          클라이언트와 서버가 함께 쓰는 타입과 도형 계산, 표기법 규칙
  client/
    canvas/        캔버스와 도형 그리기, 마우스 조작, 단축키
    collab/        실시간 문서 연결과 문서 읽기 쓰기
    presence/      접속자 표시와 원격 포인터
    ui/            상단 바와 도구 팔레트, 속성 패널, 검증 패널
    export/        그림 내보내기와 JSON 저장, 불러오기
    pages/         첫 화면과 방 화면
    state/         화면 상태
  server/          HTTP와 웹소켓 서버, 파일 저장
  cli/             명령줄 도구
  mcp/             AI가 사용하는 MCP 도구
e2e/               브라우저 테스트
deploy/            서버 설정 스크립트와 배포 스크립트, 백업 스크립트, Caddy 설정
.github/workflows/ CI와 배포 워크플로
Dockerfile         컨테이너 이미지 정의
docker-compose.yml 서버에서 쓰는 실행 구성
```

## 단축키

단축키는 한글 입력 상태에서도 동작하며 글자를 입력하는 중에는 동작하지 않습니다. macOS에서는 Ctrl 대신 Cmd를 누릅니다. 방 화면에서 `?`를 누르면 전체 목록을 볼 수 있습니다.

| 키 | 동작 |
|---|---|
| `V` | 선택 도구 |
| `H` | 손 도구 |
| `L` | 단선 연결 도구 |
| `Shift` `L` | 이중선 연결 도구 |
| `E` | 엔티티 |
| `W` | 약한 엔티티 |
| `R` | 관계 |
| `I` | 식별 관계 |
| `A` | 속성 |
| `K` | 식별자 |
| `P` | 부분 키 |
| `M` | 다중값 속성 |
| `T` | 메모 |
| `Enter` 또는 `F2` | 선택한 도형의 글자 편집 |
| `Shift` `Enter` | 글자 편집 중 줄바꿈 |
| `Esc` | 취소와 선택 해제 |
| `Delete` 또는 `Backspace` | 삭제 |
| `Ctrl` `Z` | 실행 취소 |
| `Ctrl` `Shift` `Z` | 다시 실행 |
| `Ctrl` `C` | 복사 |
| `Ctrl` `X` | 잘라내기 |
| `Ctrl` `V` | 붙여넣기 |
| `Ctrl` `D` | 복제 |
| `Ctrl` `A` | 모두 선택 |
| 방향키 | 1px 이동 |
| `Shift` 방향키 | 10px 이동 |
| `Space`를 누른 채 끌기 | 화면 이동 |
| `Ctrl` 휠 | 확대와 축소 |
| `Ctrl` `0` | 100%로 보기 |
| `Shift` `1` | 전체 보기 |
| `G` | 격자 켜기와 끄기 |

## 데이터 저장과 백업

서버는 방마다 다이어그램 전체를 `DATA_DIR` 아래에 `<방 코드>.bin` 파일 하나로 저장합니다. 편집 내용은 잠시 모았다가 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 저장하므로 저장 도중 서버가 꺼져도 기존 파일은 온전하게 남습니다. 서버는 변경이 있는 방의 사본을 `DATA_DIR/backups/<방 코드>` 폴더에 10분 간격으로 남기고 방마다 최근 50개를 보관하며, 저장 파일이 깨져 있으면 가장 최근의 정상 사본으로 되살립니다.

컨테이너로 실행할 때 `DATA_DIR`은 `/data`이고 `chen-erd-data`라는 Docker 볼륨에 연결됩니다. 이 볼륨을 지우면 모든 방의 내용이 사라지므로 서버 밖에도 사본을 남기는 편이 안전합니다. `deploy/backup.sh`는 `/data` 전체를 `/opt/chen-erd/backups/erd-data-<날짜와 시각>.tar.gz`로 묶고 14일이 지난 묶음을 지웁니다.

```bash
/opt/chen-erd/deploy/backup.sh
```

매일 자동으로 실행하도록 서버에서 `crontab -e`를 열어 아래 줄을 추가합니다. 이 예시는 매일 새벽 4시 10분에 백업하고 결과를 로그 파일에 남깁니다.

```cron
10 4 * * * /opt/chen-erd/deploy/backup.sh >> /opt/chen-erd/backups/backup.log 2>&1
```

백업 묶음으로 되돌릴 때는 앱을 멈추고 볼륨의 내용을 묶음의 내용으로 바꾼 다음 다시 시작합니다. 아래 명령은 현재 볼륨의 내용을 모두 지우므로 실행하기 전에 `backup.sh`로 현재 상태를 한 번 더 묶어 둡니다.

```bash
cd /opt/chen-erd
docker compose stop app
docker compose run --rm --no-deps -T --user root --entrypoint sh app \
  -c 'find /data -mindepth 1 -delete && tar -xzf - -C /data && chown -R node:node /data' \
  < backups/erd-data-20261111-041000.tar.gz
docker compose start app
```

방 하나만 따로 보관할 때는 방 화면의 내보내기 메뉴에서 JSON 백업을 저장하고, 같은 메뉴의 JSON 불러오기로 다시 넣습니다.

## 라이선스

MIT 라이선스로 배포합니다. 전문은 [LICENSE](LICENSE) 파일에 있습니다.
