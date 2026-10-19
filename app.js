import { api, storage } from "./api.js";
import { DEPARTMENTS, PERIODS, MEALS, NOTICES, SCHOOL_SERVICES, CALENDAR_EVENTS } from "./data.js";
import { currentSchoolPeriodIndex, getSchoolCountdown, seoulTimeParts } from "./clock.js";

const main = document.querySelector("#main-content");
const dialog = document.querySelector("#app-dialog");
const dialogContent = document.querySelector("#dialog-content");
const titleElement = document.querySelector("#page-title");
const todayLabel = document.querySelector("#today-label");
const palette = document.querySelector("#command-palette");
const paletteInput = document.querySelector("#command-input");
const paletteResults = document.querySelector("#command-results");

const DEFAULT_SETTINGS = { name: "한세인", department: "cloud", grade: "1", classNo: "1" };
const savedSettings = storage.get("settings", {});
const shouldPromptForProfile = !storage.hasCookie("settings");
let clockOffsetMs = 0;
const state = {
  settings: { ...DEFAULT_SETTINGS, ...savedSettings },
  selectedMealDay: Math.min(Math.max(new Date().getDay() - 1, 0), 4),
  weekOffset: 0
};
const initialDepartment = DEPARTMENTS.find((item) => item.value === state.settings.department) || DEPARTMENTS[0];
if (!initialDepartment.grades.map(String).includes(state.settings.grade)) state.settings.grade = String(initialDepartment.grades[0]);
if (!initialDepartment.classes.map(String).includes(state.settings.classNo)) state.settings.classNo = String(initialDepartment.classes[0]);

const ROUTES = {
  home: { title: "오늘의 한세" },
  timetable: { title: "시간표" },
  meal: { title: "오늘의 급식" },
  intranet: { title: "교내 인트라넷" }
};

const pad = (value) => String(value).padStart(2, "0");
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function getRoute() {
  const route = location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
  return ROUTES[route] ? route : "home";
}

function startOfWeek(date = new Date(), offset = 0) {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  result.setHours(12, 0, 0, 0);
  return result;
}

function weekdayDates(offset = 0) {
  const monday = startOfWeek(new Date(), offset);
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

function relativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

function schoolNow() {
  return new Date(Date.now() + clockOffsetMs);
}

function updateCountdown() {
  const card = document.querySelector("[data-countdown]");
  if (!card) return;
  const countdown = getSchoolCountdown(schoolNow());
  const label = card.querySelector("[data-countdown-label]");
  const time = card.querySelector("[data-countdown-time]");
  const detail = card.querySelector("[data-countdown-detail]");
  label.textContent = countdown.label;
  time.textContent = countdown.time;
  detail.textContent = countdown.detail;
  card.dataset.phase = countdown.phase;
  card.setAttribute("aria-label", `${countdown.label} ${countdown.time}. ${countdown.detail}`);
  document.querySelectorAll(".schedule-row[data-period-index]").forEach((row) => {
    row.classList.toggle("current", Number(row.dataset.periodIndex) === countdown.periodIndex);
  });
}

async function syncClock() {
  if (!location.protocol.startsWith("http") || !navigator.onLine) return;
  const startedAt = Date.now();
  try {
    const response = await fetch(`./?clock-sync=${startedAt}`, { method: "HEAD", cache: "no-store" });
    const finishedAt = Date.now();
    const serverDate = Date.parse(response.headers.get("Date") || "");
    if (!response.ok || !Number.isFinite(serverDate)) throw new Error("시간 응답 없음");
    clockOffsetMs = serverDate + (finishedAt - startedAt) / 2 - finishedAt;
    updateCountdown();
  } catch {
    clockOffsetMs = 0;
  }
}

function departmentLabel(value = state.settings.department) {
  return DEPARTMENTS.find((item) => item.value === value)?.label || DEPARTMENTS[0].label;
}

function honorificName(value = "") {
  const name = String(value).trim() || "한세인";
  return name.endsWith("님") ? name : `${name}님`;
}

function settingOptions(prefix = "setting") {
  const department = DEPARTMENTS.find((item) => item.value === state.settings.department) || DEPARTMENTS[0];
  return `
    <div class="field"><label for="${prefix}-department">학과</label><select id="${prefix}-department" name="department">${DEPARTMENTS.map((item) => `<option value="${item.value}" ${item.value === state.settings.department ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
    <div class="field"><label for="${prefix}-grade">학년</label><select id="${prefix}-grade" name="grade">${department.grades.map((value) => `<option value="${value}" ${String(value) === state.settings.grade ? "selected" : ""}>${value}학년</option>`).join("")}</select></div>
    <div class="field"><label for="${prefix}-class">반</label><select id="${prefix}-class" name="classNo">${department.classes.map((value) => `<option value="${value}" ${String(value) === state.settings.classNo ? "selected" : ""}>${value}반</option>`).join("")}</select></div>`;
}

function dataNote(source = "demo", kind = "데이터", updatedAt) {
  if (source === "sync") return `<div class="demo-note live"><span aria-hidden="true">●</span><span>${kind} 데이터는 공개 자료에서 동기화한 실제 정보입니다.${updatedAt ? ` · ${new Date(updatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 기준` : ""}</span></div>`;
  if (source === "neis") return `<div class="demo-note live"><span aria-hidden="true">●</span><span>${kind} 데이터는 NEIS 교육정보 개방 포털의 실제 정보입니다.${updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신` : ""}</span></div>`;
  if (source === "cache") return `<div class="demo-note cache"><span aria-hidden="true">◷</span><span>네트워크 문제로 마지막으로 저장된 ${kind}를 표시하고 있습니다.</span></div>`;
  if (source === "backend") return "";
  return `<div class="demo-note"><span aria-hidden="true">ⓘ</span><span>현재 표시된 ${kind} 정보는 화면 확인용 샘플입니다. 실제 학교 데이터가 아닙니다.</span></div>`;
}

function weekQuery(offset = 0) {
  const dates = weekdayDates(offset);
  return { dates: dates.map(ymd), from: ymd(dates[0]), to: ymd(dates[4]) };
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  document.querySelector("#toast-region").append(element);
  setTimeout(() => element.remove(), 2700);
}

function updateChrome(route) {
  titleElement.textContent = ROUTES[route].title;
  const now = schoolNow();
  todayLabel.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === route));
  document.querySelector("#profile-initial").textContent = state.settings.name.trim().charAt(0) || "나";
}

function renderScheduleList(schedule) {
  const todayIndex = Math.min(Math.max(seoulTimeParts(schoolNow()).day - 1, 0), 4);
  const current = currentSchoolPeriodIndex(schoolNow());
  return `<div class="schedule-list">${PERIODS.slice(0, 6).map((period, index) => {
    const item = schedule[index][todayIndex];
    return `<div class="schedule-row ${current === index ? "current" : ""}" data-period-index="${index}">
      <span class="period">${period.no}</span>
      <div><strong>${escapeHTML(item.subject)}</strong><small>${[item.teacher, item.room].filter(Boolean).map(escapeHTML).join(" · ") || "교실 정보 없음"}</small></div>
      <span class="time">${period.time}</span>
    </div>`;
  }).join("")}</div>`;
}

async function renderHome() {
  main.innerHTML = `<div class="empty-state"><span>◌</span><strong>오늘 정보를 불러오는 중...</strong></div>`;
  const query = weekQuery(0);
  const [timetableResult, mealResult, noticeResult] = await Promise.all([
    api.getTimetable({ ...state.settings, ...query }), api.getMeals(query), api.getNotices()
  ]);
  const { schedule } = timetableResult;
  const { meals } = mealResult;
  const { notices } = noticeResult;
  const countdown = getSchoolCountdown(schoolNow());
  const dayIndex = Math.min(Math.max(seoulTimeParts(schoolNow()).day - 1, 0), 4);
  const meal = meals[dayIndex];
  main.innerHTML = `
    <div class="page">
      <section class="hero">
        <div class="hero-copy">
          <span class="tag">${state.settings.grade}학년 ${state.settings.classNo}반 · ${departmentLabel()}</span>
          <h2>${escapeHTML(honorificName(state.settings.name))},<br>오늘도 좋은 하루를 시작해요.</h2>
          <p>시간표부터 급식, 학교 소식까지 한눈에 확인하세요.</p>
        </div>
        <div class="hero-visual">
          <div class="countdown" data-countdown data-phase="${countdown.phase}" role="timer" aria-live="off" aria-label="${escapeHTML(`${countdown.label} ${countdown.time}. ${countdown.detail}`)}"><small data-countdown-label>${countdown.label}</small><strong data-countdown-time>${countdown.time}</strong><span data-countdown-detail>${countdown.detail}</span></div>
        </div>
      </section>

      ${dataNote(timetableResult.source === "sync" && mealResult.source === "sync" ? "sync" : timetableResult.source === "neis" && mealResult.source === "neis" ? "neis" : timetableResult.source === "cache" || mealResult.source === "cache" ? "cache" : timetableResult.source, "시간표와 급식", Math.min(timetableResult.updatedAt || Date.now(), mealResult.updatedAt || Date.now()))}
      <div class="grid home-grid">
        <div class="stack">
          <section class="card card-pad">
            <header class="card-head"><div><h2>오늘의 시간표</h2><p>${departmentLabel()} ${state.settings.grade}학년 ${state.settings.classNo}반</p></div><a class="card-link" href="#/timetable">전체 보기 →</a></header>
            ${renderScheduleList(schedule)}
          </section>
          <section class="card card-pad">
            <header class="card-head"><div><h2>학교 소식</h2><p>중요한 공지를 놓치지 마세요</p></div><span class="tag lime">${notices.length}건</span></header>
            <div class="notice-list">${notices.map((notice) => `<a class="notice-item" href="${escapeHTML(notice.url || "https://hansei.sen.hs.kr/50646/subMenu.do")}" target="_blank" rel="noopener noreferrer"><span class="notice-icon">${notice.important ? "!" : "·"}</span><div><strong>${escapeHTML(notice.title)}</strong><small>${escapeHTML(notice.type)}</small></div><small>${escapeHTML(notice.date)}</small></a>`).join("")}</div>
          </section>
        </div>

        <div class="stack">
          <a href="#/meal" class="card meal-feature">
            <span class="tag">TODAY'S LUNCH</span>
            <h3>${escapeHTML(meal.name)}</h3><span class="kcal">${meal.kcal} kcal</span>
            <div class="meal-menu">${meal.menu.slice(0,5).map((item) => `<span>${escapeHTML(item)}</span>`).join("")}</div>
            <p class="allergy-note">${escapeHTML(meal.allergens)}</p>
          </a>
          <section class="card card-pad">
            <header class="card-head"><div><h3>빠른 실행</h3><p>자주 쓰는 기능</p></div></header>
            <div class="quick-grid">
              <a class="quick-item" href="#/timetable"><span>▦</span><b>주간 시간표</b></a>
              <button class="quick-item" type="button" data-service="calendar"><span>▣</span><b>학사 일정</b></button>
              <a class="quick-item" href="#/intranet"><span>◇</span><b>교내 도구</b></a>
              <button class="quick-item" type="button" data-service="suggestion"><span>✎</span><b>건의하기</b></button>
            </div>
          </section>
        </div>
      </div>
    </div>`;
}

async function renderTimetable() {
  const dates = weekdayDates(state.weekOffset);
  const result = await api.getTimetable({ ...state.settings, ...weekQuery(state.weekOffset) });
  const { schedule } = result;
  const today = ymd(new Date());
  const previousLimit = result.range?.previousWeeks ?? 1;
  const nextLimit = result.range?.nextWeeks ?? 1;
  const range = `${dates[0].getMonth()+1}.${pad(dates[0].getDate())} — ${dates[4].getMonth()+1}.${pad(dates[4].getDate())}`;
  main.innerHTML = `<div class="page">
    <div class="filterbar">
      ${settingOptions("filter")}
      <button class="primary-button" type="button" data-save-class>내 반으로 저장</button>
    </div>
    ${dataNote(result.source, "시간표", result.updatedAt)}
    <section class="card card-pad">
      <div class="week-heading">
        <div><button class="mini-button" type="button" data-week="-1" aria-label="이전 주" ${api.mode === "neis" && state.weekOffset <= -previousLimit ? "disabled" : ""}>←</button><button class="mini-button" type="button" data-week="1" aria-label="다음 주" ${api.mode === "neis" && state.weekOffset >= nextLimit ? "disabled" : ""}>→</button><h2>${range}</h2></div>
        <button class="ghost-button" type="button" data-week="today">이번 주</button>
      </div>
      <div class="timetable-wrap">
        <div class="timetable">
          <div class="table-head">교시</div>${dates.map((date, index) => `<div class="table-head ${ymd(date) === today ? "today" : ""}">${["월","화","수","목","금"][index]} · ${date.getDate()}일</div>`).join("")}
          ${PERIODS.map((period, periodIndex) => `<div class="period-label">${period.no}<small>${period.time.slice(0,5)}</small></div>${schedule[periodIndex].map((item) => `<div class="class-cell"><i class="dot"></i><strong>${escapeHTML(item.subject)}</strong><small>${[item.teacher, item.room].filter(Boolean).map(escapeHTML).join("<br>") || "—"}</small></div>`).join("")}`).join("")}
        </div>
      </div>
    </section>
  </div>`;
}

async function renderMeal() {
  const dates = weekdayDates(state.weekOffset);
  const result = await api.getMeals(weekQuery(state.weekOffset));
  const { meals } = result;
  const previousLimit = result.range?.previousWeeks ?? 1;
  const nextLimit = result.range?.nextWeeks ?? 1;
  const meal = meals[state.selectedMealDay];
  const rating = storage.get(`meal-rating:${ymd(dates[state.selectedMealDay])}`, 0);
  main.innerHTML = `<div class="page">
    ${dataNote(result.source, "급식", result.updatedAt)}
    <div class="week-heading"><div><button class="mini-button" type="button" data-meal-week="-1" ${api.mode === "neis" && state.weekOffset <= -previousLimit ? "disabled" : ""}>←</button><button class="mini-button" type="button" data-meal-week="1" ${api.mode === "neis" && state.weekOffset >= nextLimit ? "disabled" : ""}>→</button><h2>${dates[0].getMonth()+1}월 ${dates[0].getDate()}일 주간</h2></div><button class="ghost-button" type="button" data-meal-week="today">오늘</button></div>
    <div class="date-strip">${dates.map((date, index) => `<button class="date-button ${index === state.selectedMealDay ? "active" : ""}" type="button" data-meal-day="${index}"><strong>${date.getDate()}</strong><small>${["월","화","수","목","금"][index]}요일</small></button>`).join("")}</div>
    <div class="meal-layout">
      <section class="card meal-big">
        <span class="tag orange">LUNCH · ${meal.kcal} KCAL</span>
        <h2>${escapeHTML(meal.name)}</h2>
        <p class="eyebrow">${dates[state.selectedMealDay].getMonth()+1}월 ${dates[state.selectedMealDay].getDate()}일 ${["월","화","수","목","금"][state.selectedMealDay]}요일</p>
        <div class="menu-lines">${meal.menu.map((item) => `<div class="menu-line"><i></i>${escapeHTML(item)}</div>`).join("")}</div>
        <p class="allergy-note" style="color:var(--muted)">${escapeHTML(meal.allergens)}</p>
        <div class="rating"><strong>오늘 급식은?</strong>${["😕","🙂","😋"].map((emoji, index) => `<button class="${rating === index+1 ? "active" : ""}" type="button" data-meal-rating="${index+1}" aria-label="${index+1}점">${emoji}</button>`).join("")}<small>평가는 이 기기에 저장돼요.</small></div>
      </section>
      <div class="stack">
        <section class="card card-pad">
          <header class="card-head"><div><h3>영양 정보</h3><p>1인 제공량 기준</p></div></header>
          ${Object.entries(meal.nutrients).map(([name, value]) => `<div class="nutrition-row"><span>${name}</span><b>${value}%</b><div><i style="width:${value}%"></i></div></div>`).join("")}
        </section>
        <section class="card card-pad">
          <header class="card-head"><div><h3>이번 주 식단</h3><p>요일별 대표 메뉴</p></div></header>
          <div class="notice-list">${meals.map((item, index) => `<button class="notice-item" style="border-width:0 0 1px;background:none;text-align:left;width:100%" type="button" data-meal-day="${index}"><span class="notice-icon">${["월","화","수","목","금"][index]}</span><div><strong>${escapeHTML(item.menu[2])}</strong><small>${escapeHTML(item.name)}</small></div><span>›</span></button>`).join("")}</div>
        </section>
      </div>
    </div>
  </div>`;
}

function renderTasks() {
  const tasks = storage.get("tasks", []);
  if (!tasks.length) return `<div class="empty-state"><span>✓</span><strong>할 일이 없어요</strong><p>오늘 해야 할 일을 가볍게 적어 보세요.</p></div>`;
  return `<div class="task-list">${tasks.map((task) => `<div class="task-item ${task.done ? "done" : ""}"><input type="checkbox" data-task-toggle="${task.id}" ${task.done ? "checked" : ""} aria-label="완료 표시"><span>${escapeHTML(task.text)}</span><button type="button" data-task-delete="${task.id}" aria-label="삭제">×</button></div>`).join("")}</div>`;
}

function renderIntranet() {
  main.innerHTML = `<div class="page">
    <section class="intranet-hero"><div><span class="tag">SCHOOL INTRANET · LOCAL</span><h2>학교생활에 필요한 도구를 한곳에.</h2><p>백엔드 연결 전에도 개인 도구와 바로가기는 모두 사용할 수 있어요.</p></div><span class="shield" aria-hidden="true">◇</span></section>
    <div class="grid home-grid">
      <section class="card card-pad">
        <header class="card-head"><div><h2>교내 서비스</h2><p>기능별로 빠르게 이동하세요</p></div></header>
        <div class="service-grid">${SCHOOL_SERVICES.map((service) => `<button class="service-card" type="button" data-service="${service.id}"><span>${service.icon}</span><strong>${service.title}</strong><small>${service.description}</small></button>`).join("")}</div>
      </section>
      <div class="stack">
        <section class="card card-pad">
          <header class="card-head"><div><h3>나의 할 일</h3><p>이 기기에 안전하게 저장돼요</p></div></header>
          <form class="task-form" id="task-form"><input class="input" name="task" maxlength="60" placeholder="할 일을 입력하세요" required /><button class="secondary-button" type="submit">추가</button></form>
          <div id="task-list">${renderTasks()}</div>
        </section>
        <section class="card card-pad">
          <header class="card-head"><div><h3>다가오는 일정</h3><p>샘플 학사 일정</p></div><button class="card-link" type="button" data-service="calendar">전체 보기</button></header>
          <div class="notice-list">${CALENDAR_EVENTS.slice(0,3).map((event) => `<div class="notice-item"><span class="notice-icon">${event.date.split(".")[1]}</span><div><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(event.type)}</small></div><small>${event.date}</small></div>`).join("")}</div>
        </section>
      </div>
    </div>
  </div>`;
}

async function render() {
  const route = getRoute();
  updateChrome(route);
  try {
    if (route === "home") await renderHome();
    if (route === "timetable") await renderTimetable();
    if (route === "meal") await renderMeal();
    if (route === "intranet") renderIntranet();
  } catch (error) {
    const needsSync = error.message.includes("동기화 파일");
    main.innerHTML = `<div class="empty-state"><span>!</span><strong>정보를 불러오지 못했어요</strong><p>${escapeHTML(error.message)}${needsSync ? "" : " · 잠시 후 다시 시도해 주세요."}</p>${needsSync ? "<p>동기화가 끝난 뒤 아래 버튼을 누르면 새 파일을 다시 확인합니다.</p>" : ""}<br><button class="primary-button" type="button" data-retry>다시 시도</button></div>`;
  }
}

function dialogShell(title, body) {
  dialogContent.innerHTML = `<header class="dialog-head"><h2>${escapeHTML(title)}</h2><button class="dialog-close" type="button" data-close-dialog aria-label="닫기">×</button></header><div class="dialog-body">${body}</div>`;
  dialog.showModal();
}

function openSettings(options = {}) {
  const firstVisit = options.firstVisit === true;
  const intro = firstVisit ? '<p class="demo-note">저장된 사용자 정보가 없습니다. 이름과 학과·학년·반을 등록해 주세요.</p>' : "";
  const name = firstVisit ? "" : state.settings.name;
  dialogShell(firstVisit ? "이름을 등록해 주세요" : "내 정보 설정", `${intro}<form id="settings-form"><div class="form-grid"><div class="field wide"><label for="setting-name">표시 이름</label><input class="input" id="setting-name" name="name" maxlength="15" value="${escapeHTML(name)}" placeholder="이름을 입력하세요" autocomplete="name" required /></div>${settingOptions()}</div><div class="form-actions"><button class="ghost-button" type="button" data-close-dialog>취소</button><button class="primary-button" type="submit">저장하기</button></div></form>`);
}

function openService(id) {
  if (id === "calendar") {
    dialogShell("학사 일정", `${dataNote("demo", "학사 일정")}<div class="notice-list">${CALENDAR_EVENTS.map((event) => `<div class="notice-item"><span class="notice-icon">${event.date.split(".")[1]}</span><div><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(event.type)}</small></div><b>${event.date}</b></div>`).join("")}</div>`);
  }
  if (id === "suggestion" || id === "facility") {
    const title = id === "facility" ? "시설 불편 신고" : "학생 건의함";
    dialogShell(title, `${api.mode !== "backend" ? `<p class="demo-note">현재 제출 내용은 이 기기에만 저장됩니다. 백엔드 연결 후 담당 부서로 전달할 수 있어요.</p>` : ""}<form id="suggestion-form" data-kind="${id}"><div class="field"><label for="suggestion-title">제목</label><input class="input" id="suggestion-title" name="title" maxlength="60" required /></div><div class="field" style="margin-top:12px"><label for="suggestion-content">내용</label><textarea id="suggestion-content" name="content" maxlength="1000" required></textarea></div><label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:11px"><input type="checkbox" name="anonymous" /> 익명으로 기록하기</label><div class="form-actions"><button class="primary-button" type="submit">${api.mode === "backend" ? "제출하기" : "로컬에 저장"}</button></div></form>`);
  }
  if (id === "links") {
    dialogShell("교내 바로가기", `<div class="service-grid"><a class="service-card" href="https://hansei.sen.hs.kr" target="_blank" rel="noreferrer"><span>↗</span><strong>학교 홈페이지</strong><small>새 창에서 열기</small></a><a class="service-card" href="https://www.neis.go.kr" target="_blank" rel="noreferrer"><span>↗</span><strong>나이스</strong><small>교육행정정보시스템</small></a><a class="service-card" href="https://www.schoolinfo.go.kr" target="_blank" rel="noreferrer"><span>↗</span><strong>학교알리미</strong><small>학교 공시정보</small></a></div>`);
  }
  if (id === "data") openDataManager();
}

function openDataManager() {
  const suggestions = storage.get("suggestions", []);
  dialogShell("내 데이터 관리", `<p class="demo-note">설정, 할 일, 급식 평가, 접수 내역을 JSON 파일로 백업하거나 다시 불러올 수 있습니다.</p><div class="button-row"><button class="primary-button" type="button" data-export>백업 파일 받기</button><label class="ghost-button" for="import-file">백업 불러오기</label><input id="import-file" type="file" accept="application/json" hidden /></div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><h3 style="font-size:14px">로컬 접수 내역 <span class="tag">${suggestions.length}건</span></h3>${suggestions.length ? `<div class="notice-list">${suggestions.map((item) => `<div class="notice-item"><span class="notice-icon">${item.kind === "facility" ? "⚒" : "✎"}</span><div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.status)}</small></div><small>${relativeTime(item.createdAt)}</small></div>`).join("")}</div>` : `<div class="empty-state"><span>◇</span><strong>저장된 접수 내역이 없어요</strong></div>`}`);
}

function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  renderPaletteResults("");
  setTimeout(() => paletteInput.focus(), 30);
}

function closePalette() { palette.hidden = true; }

function renderPaletteResults(query) {
  const items = [
    { icon: "⌂", title: "오늘의 한세", desc: "홈 대시보드", href: "#/home" },
    { icon: "▦", title: "주간 시간표", desc: `${state.settings.grade}학년 ${state.settings.classNo}반`, href: "#/timetable" },
    { icon: "♨", title: "오늘의 급식", desc: "주간 식단과 영양 정보", href: "#/meal" },
    { icon: "◇", title: "교내 인트라넷", desc: "학사 일정과 개인 도구", href: "#/intranet" }
  ];
  const filtered = items.filter((item) => `${item.title} ${item.desc}`.includes(query));
  paletteResults.innerHTML = filtered.map((item) => `<button class="command-result" type="button" data-command-href="${item.href}"><span>${item.icon}</span><span><strong>${item.title}</strong><small>${item.desc}</small></span><span>↵</span></button>`).join("") || `<div class="empty-state"><strong>검색 결과가 없어요</strong></div>`;
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a, label");
  if (!target) return;
  if (target.matches("[data-close-dialog]")) dialog.close();
  if (target.matches("[data-retry]")) render();
  if (target.matches("[data-save-class]")) {
    state.settings.department = document.querySelector("#filter-department").value;
    state.settings.grade = document.querySelector("#filter-grade").value;
    state.settings.classNo = document.querySelector("#filter-class").value;
    storage.set("settings", state.settings); toast("내 반 정보가 저장되었습니다."); render();
  }
  if (target.dataset.week) { state.weekOffset = target.dataset.week === "today" ? 0 : state.weekOffset + Number(target.dataset.week); renderTimetable(); }
  if (target.dataset.mealWeek) { state.weekOffset = target.dataset.mealWeek === "today" ? 0 : state.weekOffset + Number(target.dataset.mealWeek); renderMeal(); }
  if (target.dataset.mealDay !== undefined) { state.selectedMealDay = Number(target.dataset.mealDay); renderMeal(); }
  if (target.dataset.mealRating) {
    const date = weekdayDates(state.weekOffset)[state.selectedMealDay];
    storage.set(`meal-rating:${ymd(date)}`, Number(target.dataset.mealRating)); toast("급식 평가를 저장했습니다."); renderMeal();
  }
  if (target.dataset.service) openService(target.dataset.service);
  if (target.dataset.taskToggle) {
    const tasks = storage.get("tasks", []).map((task) => task.id === target.dataset.taskToggle ? { ...task, done: !task.done } : task);
    storage.set("tasks", tasks); document.querySelector("#task-list").innerHTML = renderTasks();
  }
  if (target.dataset.taskDelete) {
    storage.set("tasks", storage.get("tasks", []).filter((task) => task.id !== target.dataset.taskDelete)); document.querySelector("#task-list").innerHTML = renderTasks();
  }
  if (target.matches("[data-export]")) {
    const blob = new Blob([JSON.stringify(storage.exportAll(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `hansei-link-backup-${ymd(new Date())}.json`; link.click(); URL.revokeObjectURL(url); toast("백업 파일을 만들었습니다.");
  }
  if (target.dataset.commandHref) { location.hash = target.dataset.commandHref; closePalette(); }
  if (target.matches("[data-close-palette]")) closePalette();
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === "settings-form") {
    state.settings = { ...state.settings, ...data }; storage.set("settings", state.settings); dialog.close(); toast("내 정보가 저장되었습니다."); render();
  }
  if (form.id === "task-form") {
    const tasks = storage.get("tasks", []); tasks.push({ id: crypto.randomUUID(), text: data.task, done: false }); storage.set("tasks", tasks); form.reset(); document.querySelector("#task-list").innerHTML = renderTasks();
  }
  if (form.id === "suggestion-form") {
    await api.submitSuggestion({ ...data, anonymous: data.anonymous === "on", kind: form.dataset.kind }); dialog.close(); toast(api.mode === "backend" ? "접수되었습니다." : "이 기기에 접수 내용을 저장했습니다.");
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "filter-department" || event.target.id === "setting-department") {
    const prefix = event.target.id.startsWith("filter") ? "filter" : "setting";
    const gradeSelect = document.querySelector(`#${prefix}-grade`);
    const classSelect = document.querySelector(`#${prefix}-class`);
    const department = DEPARTMENTS.find((item) => item.value === event.target.value) || DEPARTMENTS[0];
    gradeSelect.innerHTML = department.grades.map((value) => `<option value="${value}">${value}학년</option>`).join("");
    classSelect.innerHTML = department.classes.map((value) => `<option value="${value}">${value}반</option>`).join("");
  }
  if (event.target.dataset.taskToggle) {
    const tasks = storage.get("tasks", []).map((task) => task.id === event.target.dataset.taskToggle ? { ...task, done: event.target.checked } : task);
    storage.set("tasks", tasks); document.querySelector("#task-list").innerHTML = renderTasks();
  }
  if (event.target.id === "import-file" && event.target.files[0]) {
    try { storage.importAll(JSON.parse(await event.target.files[0].text())); toast("백업을 복원했습니다. 페이지를 새로고침합니다."); setTimeout(() => location.reload(), 800); }
    catch (error) { toast(error.message); }
  }
});

document.querySelector("#open-settings").addEventListener("click", () => openSettings());
document.querySelector("#profile-button").addEventListener("click", () => openSettings());
document.querySelector("#command-button").addEventListener("click", openPalette);
paletteInput.addEventListener("input", (event) => renderPaletteResults(event.target.value.trim()));
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener("hashchange", render);
window.addEventListener("online", () => { updateConnection(); syncClock(); });
window.addEventListener("offline", updateConnection);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { updateCountdown(); syncClock(); }
});
window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); }
  if (event.key === "Escape" && !palette.hidden) closePalette();
});

function updateConnection() {
  const element = document.querySelector("#connection-status");
  element.classList.toggle("offline", !navigator.onLine);
  element.querySelector("span").textContent = navigator.onLine ? "온라인" : "오프라인";
}

if (api.mode === "neis") {
  document.querySelector(".local-badge strong").textContent = "학교 정보 연동";
  document.querySelector(".local-badge small").textContent = "공개 데이터 + 캐시";
} else if (api.mode === "backend") {
  document.querySelector(".local-badge strong").textContent = "서버 연결";
  document.querySelector(".local-badge small").textContent = "실시간 데이터 사용 중";
}
updateConnection();
syncClock();
setInterval(updateCountdown, 1000);
setInterval(syncClock, 10 * 60 * 1000);
render().then(() => {
  if (shouldPromptForProfile) openSettings({ firstVisit: true });
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
