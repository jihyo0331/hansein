import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";

const NEIS_BASE_URL = "https://open.neis.go.kr/hub";
const TIMETABLE_REFERENCE_URL = "https://time.hsoc.kr/";
const OFFICE_CODE = "B10";
const SCHOOL_CODE = "7010911";
const API_KEY = (process.env.NEIS_API_KEY || "").trim();
const REQUESTED_WEEK_OFFSETS = (process.env.NEIS_WEEK_OFFSETS || "0")
  .split(",").map((value) => Number(value.trim())).filter(Number.isInteger);
const DEPARTMENTS = [
  { value: "cloud", label: "클라우드보안과", grades: [1, 2, 3], classes: [1, 2] },
  { value: "software", label: "지능형소프트웨어과", grades: [1, 2], classes: [1] },
  { value: "game", label: "메타버스게임과", grades: [1, 2, 3], classes: [1] }
];

let activeApiKey = "";
let timetableSession = null;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const pad = (value) => String(value).padStart(2, "0");
const formatDate = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const compactDate = (date) => formatDate(date).replaceAll("-", "");

function getKoreanToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  return new Date(`${parts}T12:00:00Z`);
}

function getMonday(offset = 0) {
  const today = getKoreanToday();
  const daysFromMonday = (today.getUTCDay() + 6) % 7;
  today.setUTCDate(today.getUTCDate() - daysFromMonday + offset * 7);
  return today;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function resultRows(payload, service) {
  const result = payload?.RESULT || payload?.[service]?.[0]?.head?.find((item) => item.RESULT)?.RESULT;
  if (result?.CODE === "INFO-200") return [];
  if (result && !["INFO-000", "INFO-100"].includes(result.CODE)) {
    throw new Error(`${service}: ${result.MESSAGE || result.CODE}`);
  }
  return payload?.[service]?.[1]?.row || [];
}

function responseSummary(body) {
  return String(body || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function requestText(url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const body = options.body || "";
    const request = httpsRequest(url, {
      method: options.method || "GET",
      headers: {
        Accept: options.accept || "application/json",
        "Accept-Encoding": "identity",
        Connection: "close",
        "User-Agent": "HANSEI-LINK/1.0",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        const status = response.statusCode || 0;
        resolvePromise({
          ok: status >= 200 && status < 300,
          status,
          body: responseBody,
          headers: response.headers
        });
      });
    });
    request.setTimeout(20_000, () => request.destroy(new Error("데이터 제공 사이트의 응답 시간이 초과되었습니다.")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function curlGet(url, apiKey = "") {
  return new Promise((resolvePromise, reject) => {
    const args = [
      "--silent", "--show-error", "--location", "--max-time", "20",
      "--write-out", "\n%{http_code}"
    ];
    if (apiKey) args.push("--get", "--data-urlencode", "KEY@-");
    args.push(String(url));
    const child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const errors = [];
    let outputSize = 0;
    child.stdout.on("data", (chunk) => {
      outputSize += chunk.length;
      if (outputSize > 20 * 1024 * 1024) {
        child.kill();
        reject(new Error("NEIS 응답이 허용 크기를 초과했습니다."));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString("utf8").trim() || `curl 종료 코드 ${code}`));
        return;
      }
      const raw = Buffer.concat(output).toString("utf8");
      const separator = raw.lastIndexOf("\n");
      const status = Number(raw.slice(separator + 1));
      const body = separator >= 0 ? raw.slice(0, separator) : raw;
      resolvePromise({ ok: status >= 200 && status < 300, status, body, headers: {} });
    });
    child.stdin.end(apiKey);
  });
}

async function requestRows(service, params, options = {}, attempt = 1) {
  const apiKey = options.apiKey ?? activeApiKey;
  const query = new URLSearchParams({
    Type: "json",
    pIndex: "1",
    pSize: apiKey ? "100" : "5",
    ATPT_OFCDC_SC_CODE: OFFICE_CODE,
    SD_SCHUL_CODE: SCHOOL_CODE,
    ...params
  });
  const context = Object.entries(params).map(([key, value]) => `${key}=${value}`).join(", ");
  try {
    const response = await curlGet(`${NEIS_BASE_URL}/${service}?${query}`, apiKey);
    let payload = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      // 일부 장애 응답은 HTML 또는 일반 텍스트로 반환됩니다.
    }
    if (payload) {
      try {
        const rows = resultRows(payload, service);
        if (response.ok) return rows;
      } catch (error) {
        throw new Error(`${error.message}${context ? ` (${context})` : ""}`);
      }
    }
    if (!response.ok) {
      const detail = responseSummary(response.body);
      throw new Error(`${service} HTTP ${response.status}${detail ? `: ${detail}` : ""}${context ? ` (${context})` : ""}`);
    }
    throw new Error(`${service}: JSON이 아닌 응답을 받았습니다.${context ? ` (${context})` : ""}`);
  } catch (error) {
    if (attempt >= 3) throw error;
    await sleep(1200 * attempt);
    return requestRows(service, params, options, attempt + 1);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function decodeHTML(value = "") {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] || "";
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      return String.fromCodePoint(Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10));
    })
    .replace(/\s+/g, " ")
    .trim();
}

function readInputValue(html, name) {
  const input = [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => new RegExp(`name=["']${name}["']`, "i").test(tag));
  return input?.match(/value=["']([^"']*)["']/i)?.[1] || "";
}

async function createTimetableSession() {
  const response = await requestText(TIMETABLE_REFERENCE_URL, { accept: "text/html" });
  if (!response.ok) throw new Error(`시간표 참고 사이트 HTTP ${response.status}`);
  const csrfToken = readInputValue(response.body, "csrfmiddlewaretoken");
  const setCookies = response.headers["set-cookie"] || [];
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!csrfToken || !cookie) throw new Error("시간표 참고 사이트의 조회 세션을 만들지 못했습니다.");
  return { csrfToken, cookie };
}

function parseReferenceTimetable(html, combination, from) {
  const thead = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || "";
  const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((match) => decodeHTML(match[1]))
    .slice(-5);
  const expectedHeaders = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(from, index);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  });
  if (headers.length !== 5 || !expectedHeaders.every((value, index) => headers[index]?.includes(value))) {
    throw new Error(`시간표 참고 사이트가 ${formatDate(from)} 주간 데이터를 제공하지 않습니다.`);
  }

  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  const rows = [];
  for (const rowMatch of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => decodeHTML(match[1]));
    const period = Number.parseInt(cells[0], 10);
    if (!Number.isInteger(period)) continue;
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const subject = cells[dayIndex + 1] || "";
      if (!subject || subject === "-") continue;
      rows.push({
        ALL_TI_YMD: compactDate(addDays(from, dayIndex)),
        DDDEP_NM: combination.department.label,
        GRADE: String(combination.grade),
        CLASS_NM: String(combination.classNo),
        PERIO: String(period),
        ITRT_CNTNT: subject
      });
    }
  }
  return rows;
}

async function fetchReferenceTimetable(combination, from) {
  const form = new URLSearchParams({
    csrfmiddlewaretoken: timetableSession.csrfToken,
    section: `${combination.department.label}|${combination.grade}|${combination.classNo}`
  }).toString();
  let response = await requestText(new URL("/search/", TIMETABLE_REFERENCE_URL), {
    method: "POST",
    accept: "text/html",
    body: form,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: timetableSession.cookie,
      Origin: new URL(TIMETABLE_REFERENCE_URL).origin,
      Referer: TIMETABLE_REFERENCE_URL
    }
  });
  if ([301, 302, 303].includes(response.status) && response.headers.location) {
    response = await requestText(new URL(response.headers.location, TIMETABLE_REFERENCE_URL), {
      accept: "text/html",
      headers: { Cookie: timetableSession.cookie, Referer: TIMETABLE_REFERENCE_URL }
    });
  }
  if (!response.ok) throw new Error(`시간표 참고 사이트 HTTP ${response.status}`);
  return parseReferenceTimetable(response.body, combination, from);
}

async function fetchTimetable(combination, from, to) {
  if (!activeApiKey) return fetchReferenceTimetable(combination, from);
  return requestRows("hisTimetable", {
    GRADE: String(combination.grade),
    CLASS_NM: String(combination.classNo),
    DDDEP_NM: combination.department.label,
    TI_FROM_YMD: compactDate(from),
    TI_TO_YMD: compactDate(to)
  });
}

async function fetchWeek(offset) {
  const from = getMonday(offset);
  const to = addDays(from, 4);
  const key = formatDate(from);
  const combinations = DEPARTMENTS.flatMap((department) =>
    department.grades.flatMap((grade) => department.classes.map((classNo) => ({ department, grade, classNo })))
  );
  process.stdout.write(`\n[${key} 주간] 동기화 시작 (${combinations.length}개 학급)\n`);
  const warnings = [];
  let meals = [];
  try {
    meals = await requestRows("mealServiceDietInfo", {
      MLSV_FROM_YMD: compactDate(from), MLSV_TO_YMD: compactDate(to)
    });
    process.stdout.write(`  ✓ 급식 ${meals.length}일\n`);
  } catch (error) {
    warnings.push(error.message);
    process.stderr.write(`  ⚠ 급식 건너뜀: ${error.message}\n`);
  }
  let completed = 0;
  const timetableResults = await mapLimit(combinations, 2, async (combination) => {
    const label = `${combination.department.label} ${combination.grade}학년 ${combination.classNo}반`;
    try {
      const result = {
        key: `${combination.department.value}:${combination.grade}:${combination.classNo}`,
        rows: await fetchTimetable(combination, from, to)
      };
      completed += 1;
      process.stdout.write(`  ✓ [${completed}/${combinations.length}] ${label} · ${result.rows.length}개 수업\n`);
      return result;
    } catch (error) {
      warnings.push(`${label}: ${error.message}`);
      completed += 1;
      process.stderr.write(`  ⚠ [${completed}/${combinations.length}] ${label} 건너뜀: ${error.message}\n`);
      return { key: `${combination.department.value}:${combination.grade}:${combination.classNo}`, rows: [] };
    }
  });
  return [key, {
    from: formatDate(from),
    to: formatDate(to),
    meals,
    timetables: Object.fromEntries(timetableResults.map((item) => [item.key, item.rows])),
    warnings
  }];
}

async function selectDataMode() {
  if (API_KEY) {
    process.stdout.write("등록된 인증키로 NEIS 연결을 확인합니다.\n");
    try {
      const schoolRows = await requestRows("schoolInfo", {}, { apiKey: API_KEY });
      if (!schoolRows.length) throw new Error("학교 기본정보가 없습니다.");
      activeApiKey = API_KEY;
      process.stdout.write(`인증키 연결 확인 완료: ${schoolRows[0].SCHUL_NM || "한세사이버보안고등학교"}\n`);
      return "authenticated";
    } catch (error) {
      process.stderr.write(`⚠ 등록된 인증키 조회 실패: ${error.message}\n`);
      process.stderr.write("공개 조회 모드로 자동 전환합니다.\n");
    }
  }

  activeApiKey = "";
  const schoolRows = await requestRows("schoolInfo", {}, { apiKey: "" });
  if (!schoolRows.length) throw new Error("NEIS 공개 조회에서 학교 기본정보를 찾지 못했습니다.");
  timetableSession = await createTimetableSession();
  process.stdout.write("공개 조회 연결 완료: 시간표 time.hsoc.kr · 급식 NEIS Open API\n");
  return "public";
}

async function main() {
  if (!REQUESTED_WEEK_OFFSETS.length) throw new Error("NEIS_WEEK_OFFSETS 값이 올바르지 않습니다.");
  process.stdout.write(`동기화를 시작합니다. 요청 주차: ${REQUESTED_WEEK_OFFSETS.join(", ")}\n`);
  const mode = await selectDataMode();
  const weekOffsets = mode === "authenticated" ? REQUESTED_WEEK_OFFSETS : [0];
  if (mode === "public" && (REQUESTED_WEEK_OFFSETS.length !== 1 || REQUESTED_WEEK_OFFSETS[0] !== 0)) {
    process.stderr.write("⚠ 공개 시간표는 이번 주만 제공되어 주차 범위를 0으로 조정했습니다.\n");
  }

  const weeks = Object.fromEntries(await mapLimit(weekOffsets, 1, fetchWeek));
  const previousWeeks = Math.max(0, ...weekOffsets.filter((value) => value < 0).map(Math.abs));
  const nextWeeks = Math.max(0, ...weekOffsets.filter((value) => value > 0));
  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    school: { name: "한세사이버보안고등학교", officeCode: OFFICE_CODE, schoolCode: SCHOOL_CODE },
    source: {
      mode,
      timetable: mode === "authenticated" ? "NEIS Open API" : "time.hsoc.kr 공개 조회",
      meals: "NEIS Open API"
    },
    range: { previousWeeks, nextWeeks },
    weeks
  };
  const mealRowCount = Object.values(weeks).reduce((sum, week) => sum + week.meals.length, 0);
  const timetableRowCount = Object.values(weeks).reduce((sum, week) => sum + Object.values(week.timetables).reduce((subtotal, rows) => subtotal + rows.length, 0), 0);
  const rowCount = mealRowCount + timetableRowCount;
  const warnings = Object.values(weeks).flatMap((week) => week.warnings || []);
  if (timetableRowCount === 0) {
    throw new Error(`시간표 요청이 모두 실패하거나 데이터가 없습니다.${warnings[0] ? ` 첫 오류: ${warnings[0]}` : ""}`);
  }
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outputDirectory = resolve(projectRoot, "data");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "neis.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`동기화 완료: ${Object.keys(weeks).join(", ")} / ${rowCount}개 행\n`);
  if (warnings.length) {
    process.stderr.write(`일부 요청 건너뜀: ${warnings.length}건\n${warnings.slice(0, 5).map((warning) => `- ${warning}`).join("\n")}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`동기화 실패: ${error.message}\n`);
  process.exitCode = 1;
});
