export const DEPARTMENTS = [
  { value: "cloud", label: "클라우드보안과", grades: [1, 2, 3], classes: [1, 2] },
  { value: "software", label: "지능형소프트웨어과", grades: [1, 2], classes: [1] },
  { value: "game", label: "메타버스게임과", grades: [1, 2, 3], classes: [1] }
];

export const PERIODS = [
  { no: 1, time: "08:40–09:30" },
  { no: 2, time: "09:40–10:30" },
  { no: 3, time: "10:40–11:30" },
  { no: 4, time: "11:40–12:30" },
  { no: 5, time: "13:30–14:20" },
  { no: 6, time: "14:30–15:20" },
  { no: 7, time: "15:30–16:20" }
];

const SUBJECT_POOLS = {
  cloud: [
    ["통합사회", "김○준", "본관 301"], ["한국사", "박○은", "본관 301"],
    ["통합과학", "이○훈", "과학실"], ["음악", "정○원", "음악실"],
    ["공통수학", "최○서", "본관 301"], ["공통국어", "한○진", "본관 301"],
    ["컴퓨터 시스템 일반", "윤○호", "실습실 2"], ["네트워크 프로그래밍", "오○빈", "실습실 3"],
    ["정보보안 일반", "류○성", "보안실습실"], ["공통영어", "문○아", "본관 301"]
  ],
  software: [
    ["공통국어", "한○진", "본관 201"], ["통합과학", "이○훈", "과학실"],
    ["통합사회", "김○준", "본관 201"], ["공통수학", "최○서", "본관 201"],
    ["인공지능 일반", "서○우", "AI실습실"], ["프로그래밍", "조○혁", "실습실 1"],
    ["응용 프로그래밍", "신○람", "실습실 1"], ["데이터베이스", "백○주", "실습실 4"],
    ["운동과 건강", "강○태", "체육관"], ["일본어 회화", "고○미", "본관 201"]
  ],
  game: [
    ["컴퓨터 그래픽", "장○재", "그래픽실"], ["게임 콘셉트 기획", "배○나", "게임실습실"],
    ["게임 클라이언트 프로그래밍", "이○혁", "게임실습실"], ["캐릭터 제작", "송○민", "그래픽실"],
    ["공통수학", "최○서", "본관 101"], ["한국사", "박○은", "본관 101"],
    ["체육", "강○태", "체육관"], ["공통영어", "문○아", "본관 101"],
    ["게임 디자인", "임○진", "게임실습실"], ["공통국어", "한○진", "본관 101"]
  ]
};

export function makeSchedule(department = "cloud", grade = 1, classNo = 1) {
  const pool = SUBJECT_POOLS[department] || SUBJECT_POOLS.cloud;
  return Array.from({ length: 7 }, (_, periodIndex) =>
    Array.from({ length: 5 }, (_, dayIndex) => {
      const index = (periodIndex * 3 + dayIndex * 2 + Number(grade) + Number(classNo)) % pool.length;
      const [subject, teacher, room] = pool[index];
      return { subject, teacher, room, color: (index + dayIndex) % 4 };
    })
  );
}

export const MEALS = [
  {
    name: "따뜻한 집밥 데이",
    menu: ["혼합잡곡밥", "차돌된장찌개", "순살간장찜닭", "숙주나물", "깍두기", "감귤"],
    kcal: 824,
    nutrients: { 탄수화물: 82, 단백질: 68, 지방: 54 },
    allergens: "알레르기 정보: 5, 6, 10, 13, 15, 16"
  },
  {
    name: "든든한 한식 한상",
    menu: ["현미밥", "소고기미역국", "제육볶음", "달걀말이", "배추김치", "요구르트"],
    kcal: 792,
    nutrients: { 탄수화물: 76, 단백질: 73, 지방: 48 },
    allergens: "알레르기 정보: 1, 2, 5, 6, 10, 13"
  },
  {
    name: "수요일은 면요일",
    menu: ["잔치국수", "미니주먹밥", "닭강정", "오이무침", "배추김치", "샤인머스캣"],
    kcal: 868,
    nutrients: { 탄수화물: 91, 단백질: 62, 지방: 57 },
    allergens: "알레르기 정보: 1, 5, 6, 9, 10, 13, 15"
  },
  {
    name: "오늘은 양식 데이",
    menu: ["토마토스파게티", "크림스프", "치킨텐더", "그린샐러드", "오이피클", "마늘빵"],
    kcal: 901,
    nutrients: { 탄수화물: 88, 단백질: 66, 지방: 71 },
    allergens: "알레르기 정보: 1, 2, 5, 6, 12, 13, 15"
  },
  {
    name: "금요일 특식",
    menu: ["카레라이스", "유부장국", "왕새우튀김", "양배추샐러드", "깍두기", "초코우유"],
    kcal: 936,
    nutrients: { 탄수화물: 94, 단백질: 58, 지방: 75 },
    allergens: "알레르기 정보: 1, 2, 5, 6, 9, 12, 13"
  }
];

export const NOTICES = [
  {
    id: "n1", type: "공지", title: "학교장 재량휴업일 안내(2026.10.06)", date: "09.30", important: true,
    url: "https://hansei.sen.hs.kr/50646/subMenu.do?bbsId=BBSMSTR_000000002873&nttId=27512338"
  },
  {
    id: "n2", type: "학사", title: "2026학년도 2학기 중간(졸업)고사 시험시간표 및 시험범위(공지)", date: "09.21", important: true,
    url: "https://hansei.sen.hs.kr/50646/subMenu.do?bbsId=BBSMSTR_000000002873&nttId=27490558"
  },
  {
    id: "n3", type: "학사", title: "2026년 2학기 학급시간표", date: "08.18", important: false,
    url: "https://hansei.sen.hs.kr/50646/subMenu.do?bbsId=BBSMSTR_000000002873&nttId=27383321"
  },
  {
    id: "n4", type: "공지", title: "2026학년도 1학기 도서구입 목록입니다.", date: "06.17", important: false,
    url: "https://hansei.sen.hs.kr/50646/subMenu.do?bbsId=BBSMSTR_000000002873&nttId=27254094"
  }
];

export const SCHOOL_SERVICES = [
  { id: "calendar", icon: "▣", title: "학사 일정", description: "시험·행사 일정을 확인해요" },
  { id: "suggestion", icon: "✎", title: "학생 건의함", description: "이 기기에 건의를 작성해요" },
  { id: "facility", icon: "⚒", title: "시설 신고", description: "교내 시설 불편을 기록해요" },
  { id: "links", icon: "↗", title: "교내 바로가기", description: "자주 쓰는 링크를 모아봐요" },
  { id: "data", icon: "⇩", title: "내 데이터", description: "로컬 데이터를 백업·복원해요" }
];

export const CALENDAR_EVENTS = [
  { date: "10.21", title: "동아리 활동", type: "교내 행사" },
  { date: "10.24", title: "진로 특강", type: "진로" },
  { date: "10.27", title: "중간고사 시작", type: "학사" },
  { date: "11.03", title: "교내 CTF", type: "대회" }
];
