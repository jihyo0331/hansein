import { makeSchedule, MEALS, NOTICES, PERIODS, DEPARTMENTS } from "./data.js";

const CONFIG = window.HANSEI_CONFIG || { mode: "local", apiBaseUrl: "", endpoints: {} };
const PREFIX = "hansei-link:";
const LEGACY_PREFIX = "hsoc-one:";
const COOKIE_PREFIX = "hansei-link-";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SYNCED_DATA_URL = new URL("./data/neis.json", import.meta.url);
let syncedDataPromise;

function isCookieBacked(key) {
  return key === "settings" || key.startsWith("meal-rating:");
}

function cookiePath() {
  const path = location.pathname || "/";
  return path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1) || "/";
}

function decodeCookiePart(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function cookieEntries() {
  return document.cookie.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf("=");
    return {
      name: decodeCookiePart(separator >= 0 ? part.slice(0, separator) : part),
      value: separator >= 0 ? part.slice(separator + 1) : ""
    };
  });
}

function readCookie(key) {
  const item = cookieEntries().find(({ name }) => name === `${COOKIE_PREFIX}${key}`);
  return item ? decodeCookiePart(item.value) : null;
}

function writeCookie(key, value) {
  const serialized = JSON.stringify(value);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(`${COOKIE_PREFIX}${key}`)}=${encodeURIComponent(serialized)}; Max-Age=${COOKIE_MAX_AGE}; Path=${cookiePath()}; SameSite=Lax${secure}`;
  return readCookie(key) === serialized;
}

function removeCookie(key) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(`${COOKIE_PREFIX}${key}`)}=; Max-Age=0; Path=${cookiePath()}; SameSite=Lax${secure}`;
}

// 이전 프로토타입의 설정과 개인 데이터를 현재 저장 영역으로 한 번만 이전합니다.
for (let index = 0; index < localStorage.length; index += 1) {
  const key = localStorage.key(index);
  if (key?.startsWith(LEGACY_PREFIX)) {
    const localKey = key.slice(LEGACY_PREFIX.length);
    if (localKey === "posts") continue;
    const nextKey = PREFIX + localKey;
    if (localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, localStorage.getItem(key));
  }
}

function read(key, fallback) {
  try {
    if (isCookieBacked(key)) {
      const cookieValue = readCookie(key);
      if (cookieValue !== null) return JSON.parse(cookieValue);
    }
    const value = localStorage.getItem(PREFIX + key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    if (isCookieBacked(key) && writeCookie(key, parsed)) localStorage.removeItem(PREFIX + key);
    return parsed;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (isCookieBacked(key) && writeCookie(key, value)) {
    localStorage.removeItem(PREFIX + key);
  } else {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }
  return value;
}

async function request(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs || 8000);
  try {
    const response = await fetch(`${CONFIG.apiBaseUrl}${endpoint}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally {
    clearTimeout(timer);
  }
}

function backendEnabled() {
  return CONFIG.mode === "backend" && Boolean(CONFIG.apiBaseUrl);
}

function compactDate(value) {
  return String(value || "").replaceAll("-", "");
}

function decodeText(value = "") {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function getNeisResult(payload, service) {
  const topResult = payload?.RESULT;
  const result = topResult || payload?.[service]?.[0]?.head?.find((item) => item.RESULT)?.RESULT;
  if (result?.CODE === "INFO-200") return [];
  if (result && !["INFO-000", "INFO-100"].includes(result.CODE)) throw new Error(result.MESSAGE || `NEIS 오류 ${result.CODE}`);
  return payload?.[service]?.[1]?.row || [];
}

async function neisRequest(service, params = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs || 8000);
  const query = new URLSearchParams({
    Type: "json",
    pIndex: "1",
    pSize: CONFIG.neisApiKey ? "1000" : "5",
    ATPT_OFCDC_SC_CODE: CONFIG.officeCode || "B10",
    SD_SCHUL_CODE: CONFIG.schoolCode || "7010911",
    ...params
  });
  if (CONFIG.neisApiKey) query.set("KEY", CONFIG.neisApiKey);
  try {
    const response = await fetch(`${CONFIG.neisBaseUrl || "https://open.neis.go.kr/hub"}/${service}?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`NEIS HTTP ${response.status}`);
    return getNeisResult(await response.json(), service);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("NEIS 응답 시간이 초과되었습니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadSyncedData() {
  if (!syncedDataPromise) {
    const url = new URL(SYNCED_DATA_URL);
    url.searchParams.set("v", String(Math.floor(Date.now() / 300_000)));
    const pending = fetch(url, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`동기화 파일 HTTP ${response.status}`);
        return response.json();
      })
      .catch(() => null);
    syncedDataPromise = pending;
    pending.finally(() => {
      // 같은 화면의 시간표·급식 요청은 공유하되, 재시도 시에는 새 파일을 읽습니다.
      if (syncedDataPromise === pending) syncedDataPromise = undefined;
    });
  }
  return syncedDataPromise;
}

async function getSyncedWeek(from) {
  const data = await loadSyncedData();
  const week = data?.weeks?.[String(from)];
  if (!week) return null;
  return { week, range: data.range || null, updatedAt: data.generatedAt ? Date.parse(data.generatedAt) : Date.now() };
}

function cacheRead(key) {
  const cached = read(`cache:${key}`, null);
  if (!cached?.value) return null;
  return { ...cached.value, cachedAt: cached.savedAt };
}

function cacheWrite(key, value) {
  write(`cache:${key}`, { savedAt: Date.now(), value });
}

function blankClass() {
  return { subject: "수업 없음", teacher: "", room: "" };
}

export function normalizeTimetable(rows, dates) {
  const schedule = Array.from({ length: PERIODS.length }, () => Array.from({ length: 5 }, blankClass));
  const dateIndex = new Map(dates.map((date, index) => [compactDate(date), index]));
  rows.forEach((row) => {
    const day = dateIndex.get(compactDate(row.ALL_TI_YMD));
    const period = Number(row.PERIO) - 1;
    if (day === undefined || period < 0 || period >= PERIODS.length) return;
    schedule[period][day] = {
      subject: decodeText(row.ITRT_CNTNT) || "수업 없음",
      teacher: row.DDDEP_NM || "",
      room: row.CLRM_NM ? `${decodeText(row.CLRM_NM)}반` : ""
    };
  });
  return schedule;
}

function parseNutrition(value = "") {
  const targets = { 탄수화물: 130, 단백질: 55, 지방: 50 };
  const nutrients = { 탄수화물: 0, 단백질: 0, 지방: 0 };
  decodeText(value).split("\n").forEach((line) => {
    const match = line.match(/^([^(:]+)(?:\([^)]*\))?\s*:\s*([\d.]+)/);
    if (!match) return;
    const name = match[1].trim();
    if (targets[name]) nutrients[name] = Math.min(100, Math.round((Number(match[2]) / targets[name]) * 100));
  });
  return nutrients;
}

export function normalizeMeals(rows, dates) {
  const byDate = new Map(rows.map((row) => [compactDate(row.MLSV_YMD), row]));
  return dates.map((date) => {
    const row = byDate.get(compactDate(date));
    if (!row) return {
      name: "급식 정보 없음", menu: ["등록된 급식이 없습니다"], kcal: 0,
      nutrients: { 탄수화물: 0, 단백질: 0, 지방: 0 }, allergens: "급식이 제공되지 않거나 아직 등록되지 않았습니다."
    };
    const rawMenu = decodeText(row.DDISH_NM).split("\n").filter(Boolean);
    const allergenNumbers = [...new Set(rawMenu.flatMap((item) => item.match(/\d+/g) || []))].sort((a, b) => Number(a) - Number(b));
    const menu = rawMenu.map((item) => item.replace(/\s*\(?\d+(?:\.\d+)*\.?\)?\s*$/g, "").trim()).filter(Boolean);
    return {
      name: `${decodeText(row.MMEAL_SC_NM) || "중식"} 식단`,
      menu,
      kcal: Math.round(Number.parseFloat(row.CAL_INFO) || 0),
      nutrients: parseNutrition(row.NTR_INFO),
      allergens: allergenNumbers.length ? `알레르기 유발 식재료 번호: ${allergenNumbers.join(", ")}` : "알레르기 정보 없음"
    };
  });
}

async function getNeisTimetable(params) {
  const from = compactDate(params.from);
  const to = compactDate(params.to);
  const dates = params.dates || [];
  const department = DEPARTMENTS.find((item) => item.value === params.department)?.label || "";
  const cacheKey = `timetable:${department}:${params.grade}:${params.classNo}:${from}:${to}`;
  const common = {
    GRADE: String(params.grade), CLASS_NM: String(params.classNo), DDDEP_NM: department,
    TI_FROM_YMD: from, TI_TO_YMD: to
  };
  const synced = await getSyncedWeek(params.from);
  const syncedRows = synced?.week?.timetables?.[`${params.department}:${params.grade}:${params.classNo}`];
  if (Array.isArray(syncedRows)) {
    const value = { source: "sync", schedule: normalizeTimetable(syncedRows, dates), range: synced.range, updatedAt: synced.updatedAt };
    cacheWrite(cacheKey, value);
    return value;
  }
  if (!CONFIG.directNeisFromBrowser) {
    const cached = cacheRead(cacheKey);
    if (cached) return { ...cached, source: "cache" };
    throw new Error("동기화 파일에 이번 주 시간표가 없습니다. node scripts/sync-neis.mjs 를 실행해 주세요.");
  }
  try {
    let rows;
    if (CONFIG.neisApiKey) {
      rows = await neisRequest("hisTimetable", common);
    } else {
      const chunks = await Promise.all(PERIODS.map((period) => neisRequest("hisTimetable", { ...common, PERIO: String(period.no) })));
      rows = chunks.flat();
    }
    const value = { source: "neis", schedule: normalizeTimetable(rows, dates), updatedAt: Date.now() };
    cacheWrite(cacheKey, value);
    return value;
  } catch (error) {
    const cached = cacheRead(cacheKey);
    if (cached) return { ...cached, source: "cache", error: error.message };
    throw new Error(`실제 시간표를 불러오지 못했습니다. ${error.message}`);
  }
}

async function getNeisMeals(params) {
  const from = compactDate(params.from);
  const to = compactDate(params.to);
  const dates = params.dates || [];
  const cacheKey = `meals:${from}:${to}`;
  const synced = await getSyncedWeek(params.from);
  if (Array.isArray(synced?.week?.meals)) {
    const value = { source: "sync", meals: normalizeMeals(synced.week.meals, dates), range: synced.range, updatedAt: synced.updatedAt };
    cacheWrite(cacheKey, value);
    return value;
  }
  if (!CONFIG.directNeisFromBrowser) {
    const cached = cacheRead(cacheKey);
    if (cached) return { ...cached, source: "cache" };
    throw new Error("동기화 파일에 이번 주 급식이 없습니다. node scripts/sync-neis.mjs 를 실행해 주세요.");
  }
  try {
    const rows = await neisRequest("mealServiceDietInfo", { MLSV_FROM_YMD: from, MLSV_TO_YMD: to });
    const value = { source: "neis", meals: normalizeMeals(rows, dates), updatedAt: Date.now() };
    cacheWrite(cacheKey, value);
    return value;
  } catch (error) {
    const cached = cacheRead(cacheKey);
    if (cached) return { ...cached, source: "cache", error: error.message };
    throw new Error(`실제 급식을 불러오지 못했습니다. ${error.message}`);
  }
}

export const storage = {
  get: read,
  set: write,
  hasCookie(key) {
    return readCookie(key) !== null;
  },
  remove(key) {
    localStorage.removeItem(PREFIX + key);
    if (isCookieBacked(key)) removeCookie(key);
  },
  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const localKey = key?.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
      if (localKey && localKey !== "posts") data[localKey] = JSON.parse(localStorage.getItem(key));
    }
    cookieEntries().forEach(({ name, value }) => {
      if (!name.startsWith(COOKIE_PREFIX)) return;
      const localKey = name.slice(COOKIE_PREFIX.length);
      if (isCookieBacked(localKey)) data[localKey] = JSON.parse(decodeCookiePart(value));
    });
    return { version: 1, exportedAt: new Date().toISOString(), data };
  },
  importAll(payload) {
    if (!payload || payload.version !== 1 || typeof payload.data !== "object") throw new Error("지원하지 않는 백업 파일입니다.");
    Object.entries(payload.data).forEach(([key, value]) => { if (key !== "posts") write(key, value); });
  }
};

export const api = {
  mode: backendEnabled() ? "backend" : CONFIG.mode === "neis" ? "neis" : "local",

  async getTimetable(params) {
    if (backendEnabled()) {
      const query = new URLSearchParams(params).toString();
      return request(`${CONFIG.endpoints.timetable}?${query}`);
    }
    if (CONFIG.mode === "neis") return getNeisTimetable(params);
    return { source: "demo", schedule: makeSchedule(params.department, params.grade, params.classNo) };
  },

  async getMeals(params = {}) {
    if (backendEnabled()) {
      const query = new URLSearchParams(params).toString();
      return request(`${CONFIG.endpoints.meals}?${query}`);
    }
    if (CONFIG.mode === "neis") return getNeisMeals(params);
    return { source: "demo", meals: MEALS };
  },

  async getNotices() {
    if (backendEnabled()) return request(CONFIG.endpoints.notices);
    return { source: "demo", notices: NOTICES };
  },

  async submitSuggestion(suggestion) {
    if (backendEnabled()) return request(CONFIG.endpoints.suggestions, { method: "POST", body: JSON.stringify(suggestion) });
    const suggestions = read("suggestions", []);
    const created = { id: crypto.randomUUID(), createdAt: Date.now(), status: "로컬 저장", ...suggestion };
    write("suggestions", [created, ...suggestions]);
    return created;
  }
};
