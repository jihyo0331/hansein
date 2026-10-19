/**
 * HANSEI LINK 런타임 설정
 * - neis 모드: 빌드 때 생성한 공개 시간표·NEIS 급식 데이터를 사용합니다.
 * - backend 모드: 추후 자체 API를 연결할 때 사용합니다.
 */
window.HANSEI_CONFIG = {
  mode: "neis",
  neisBaseUrl: "https://open.neis.go.kr/hub",
  neisApiKey: "",
  directNeisFromBrowser: false,
  officeCode: "B10",
  schoolCode: "7010911",
  apiBaseUrl: "",
  timeoutMs: 8000,
  endpoints: {
    timetable: "/api/v1/timetable",
    meals: "/api/v1/meals",
    notices: "/api/v1/notices",
    suggestions: "/api/v1/suggestions"
  }
};
