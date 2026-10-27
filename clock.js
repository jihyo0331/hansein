import { PERIODS } from "./data.js?v=16";

const SEOUL_TIME_ZONE = "Asia/Seoul";
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const SEOUL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function timeToSeconds(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60;
}

const PERIOD_WINDOWS = PERIODS.map((period, index) => {
  const [startLabel, endLabel] = period.time.split("–");
  return {
    ...period,
    index,
    startLabel,
    endLabel,
    start: timeToSeconds(startLabel),
    end: timeToSeconds(endLabel)
  };
});

export function seoulTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    SEOUL_CLOCK.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    day: WEEKDAYS[parts.weekday],
    hour,
    minute,
    second,
    seconds: hour * 3600 + minute * 60 + second
  };
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function countdownTo(targetSeconds, currentSeconds, milliseconds) {
  return formatRemaining((targetSeconds - currentSeconds) * 1000 - milliseconds);
}

export function currentSchoolPeriodIndex(date = new Date()) {
  const { day, seconds } = seoulTimeParts(date);
  if (day === 0 || day === 6) return -1;
  return PERIOD_WINDOWS.findIndex(({ start, end }) => seconds >= start && seconds < end);
}

export function getSchoolCountdown(date = new Date()) {
  const { day, seconds } = seoulTimeParts(date);
  const milliseconds = date.getMilliseconds();
  if (day === 0 || day === 6) {
    return { label: "오늘은 주말", time: "충전 중", detail: "다음 등교일을 준비해요", phase: "weekend", periodIndex: -1 };
  }

  const first = PERIOD_WINDOWS[0];
  const last = PERIOD_WINDOWS.at(-1);
  if (seconds < first.start) {
    return {
      label: "1교시 시작까지",
      time: countdownTo(first.start, seconds, milliseconds),
      detail: `${first.startLabel} 시작 · 한국 표준시`,
      phase: "before",
      periodIndex: -1
    };
  }

  for (const period of PERIOD_WINDOWS) {
    if (seconds >= period.start && seconds < period.end) {
      return {
        label: `${period.no}교시 종료까지`,
        time: countdownTo(period.end, seconds, milliseconds),
        detail: `${period.time} · 수업 중`,
        phase: "class",
        periodIndex: period.index
      };
    }

    const next = PERIOD_WINDOWS[period.index + 1];
    if (next && seconds >= period.end && seconds < next.start) {
      const lunch = period.no === 4;
      return {
        label: lunch ? "점심시간 남은 시간" : `${next.no}교시 시작까지`,
        time: countdownTo(next.start, seconds, milliseconds),
        detail: lunch ? `${next.startLabel} 5교시 시작` : `${next.startLabel} 시작 · 쉬는 시간`,
        phase: lunch ? "lunch" : "break",
        periodIndex: -1
      };
    }
  }

  if (seconds >= last.end) {
    return { label: "오늘 수업 종료", time: "수고했어요", detail: "내일도 좋은 하루 보내요", phase: "after", periodIndex: -1 };
  }

  return { label: "학교 시간 확인 중", time: "--:--", detail: "한국 표준시로 맞추고 있어요", phase: "sync", periodIndex: -1 };
}

