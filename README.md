# HANSEI LINK

한세사이버보안고등학교 학생을 위한 정적 학생 포털입니다. 시간표·급식·교내 인트라넷을 하나의 반응형 화면에 담았으며, 백엔드 없이 GitHub Pages에서 바로 동작합니다.

## 현재 동작하는 기능

- 오늘 대시보드, 수업/점심·종례 카운트다운
- `time.hsoc.kr` 공개 조회 기반 실제 주간 시간표 및 내 반 저장
- NEIS Open API 기반 실제 주간 급식, 영양 정보, 기기별 급식 평가
- 공식 학교 소식 바로가기, 학사 일정, 학생 건의함, 시설 신고, 개인 할 일, 교내 링크
- 통합 검색, 오프라인 캐시(PWA), JSON 백업/복원
- 모바일 하단 내비게이션과 데스크톱 사이드바

시간표와 급식은 동기화 스크립트가 공개 데이터를 `data/neis.json`으로 내려받고, 웹사이트가 이 정적 파일을 읽습니다. 인증키가 없을 때는 이번 주 시간표를 `time.hsoc.kr`의 공개 조회 화면에서, 급식을 NEIS Open API 공개 조회에서 가져옵니다. 브라우저에서 외부 사이트를 직접 호출하지 않으므로 CORS 오류 없이 GitHub Pages에서 동작합니다. 마지막 성공 결과는 오프라인용으로도 저장됩니다. 내 학과·학년·반 설정과 급식 평가는 1년 유효한 자사 쿠키에 저장되고, 저장된 설정 쿠키가 없는 첫 방문에는 이름과 반을 등록하는 창이 자동으로 열립니다. 할 일과 접수 내역처럼 크기가 큰 내용은 브라우저 `localStorage`에 저장됩니다. 학교 소식은 한세사이버보안고등학교 공식 홈페이지 게시글로 연결됩니다. 학사 일정은 아직 화면 확인용 샘플입니다.

NEIS 인증키는 선택 사항입니다. 유효한 키를 등록하면 NEIS에서 여러 주차를 직접 동기화하고, 키가 없거나 조회에 실패하면 자동으로 이번 주 공개 조회 모드로 전환합니다. 인증키는 소스나 정적 파일에 기록하지 않습니다.

## 로컬 실행

빌드 과정이나 패키지 설치가 필요 없습니다.

```bash
node scripts/sync-neis.mjs
python3 -m http.server 4173
```

동기화가 끝나면 `http://localhost:4173`을 엽니다. ES Modules와 서비스 워커 때문에 `index.html` 파일을 직접 여는 대신 HTTP 서버를 사용해야 합니다. 공개 조회 모드는 인증키 없이 이번 주 실제 시간표와 급식을 생성합니다.

지난주·이번 주·다음 주를 모두 생성하려면 유효한 인증키를 입력한 상태에서 다음 순서로 실행합니다.

```bash
read -s "NEIS_API_KEY?NEIS 인증키: "
export NEIS_API_KEY
echo
NEIS_WEEK_OFFSETS=-1,0,1 node scripts/sync-neis.mjs
unset NEIS_API_KEY
```

인증키가 동작하지 않으면 스크립트는 오류로 끝나지 않고 공개 조회로 전환해 이번 주만 생성합니다. 더 넓은 범위가 필요하면 환경 변수의 주차 범위를 확장하거나 추후 백엔드 조회를 연결할 수 있습니다.

## 데이터 모드

기본 설정은 빌드 시 생성된 실제 학교 데이터 조회 모드입니다.

```js
window.HANSEI_CONFIG = {
  mode: "neis",
  officeCode: "B10",
  schoolCode: "7010911",
  neisApiKey: "",
  directNeisFromBrowser: false
};
```

`mode: "local"`로 변경하면 개발용 샘플 데이터만 사용합니다.

## 추후 백엔드 연결

[`config.js`](./config.js)에서 다음 두 값을 바꿉니다.

```js
window.HANSEI_CONFIG = {
  mode: "backend",
  apiBaseUrl: "https://api.example.com",
  // ...
};
```

프론트엔드의 요청 처리는 [`api.js`](./api.js)에 격리되어 있습니다. 기본 엔드포인트는 다음과 같습니다.

| Method | Endpoint | 용도 |
| --- | --- | --- |
| GET | `/api/v1/timetable?department=&grade=&classNo=` | 시간표 조회 |
| GET | `/api/v1/meals?date=` | 급식 조회 |
| GET | `/api/v1/notices` | 공지 조회 |
| POST | `/api/v1/suggestions` | 건의·시설 신고 접수 |

실제 인증이 붙으면 토큰을 `localStorage`에 장기 보관하지 말고, Secure/HttpOnly 쿠키 기반 세션 또는 짧은 수명의 토큰을 권장합니다. NEIS API 키도 정적 프론트엔드에 포함하지 말고 백엔드 환경 변수로 관리하세요.

## GitHub Pages 배포

저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 선택하고 `main` 브랜치에 푸시하면 워크플로가 실제 데이터를 동기화한 후 사이트를 배포합니다. `NEIS_API_KEY` Repository secret은 선택 사항이며, 등록하지 않아도 공개 조회 모드로 이번 주 데이터가 생성됩니다. 같은 워크플로가 매일 오전 6시(KST)에 다시 실행되어 정적 데이터를 갱신합니다.

## 데이터 출처 연결 시 참고

현재 시간표는 `time.hsoc.kr`의 공개 조회 결과, 급식은 교육정보 개방 포털의 NEIS Open API를 빌드 시점에 동기화합니다. 참고 사이트의 화면 구조가 바뀌면 시간표 파서를 함께 수정해야 합니다. 추후 백엔드를 연결하면 지원 범위를 벗어난 주차도 즉시 조회할 수 있습니다.
