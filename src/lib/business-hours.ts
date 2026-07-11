// Geschäftszeiten-Arithmetik für SLA-Fristen: Minuten werden nur innerhalb
// der konfigurierten Zeitfenster gezählt (zeitzonen- und DST-korrekt über
// Intl). Ohne Kalender (schedule = null) gilt 24/7.

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** { mon: [["09:00","17:00"]], ... } — fehlender Tag = arbeitsfrei */
export type Schedule = Partial<Record<WeekdayKey, [string, string][]>>;

export interface BusinessCalendar {
  timezone: string;
  schedule: Schedule | null;
  holidays: string[]; // "YYYY-MM-DD"
}

const WEEKDAYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: WeekdayKey;
  dateStr: string;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    fmtCache.set(tz, fmt);
  }
  return fmt;
}

/** Wanduhrzeit eines UTC-Zeitpunkts in der Ziel-Zeitzone. */
export function wallTime(date: Date, tz: string): Wall {
  const parts = Object.fromEntries(
    formatter(tz).formatToParts(date).map((p) => [p.type, p.value])
  );
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday as string
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  return {
    y,
    m,
    d,
    hh: Number(parts.hour) % 24, // Intl liefert für Mitternacht "24"
    mm: Number(parts.minute),
    weekday: WEEKDAYS[weekdayIndex],
    dateStr: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  };
}

/** UTC-Zeitpunkt einer Wanduhrzeit in der Ziel-Zeitzone (Zwei-Pass-Korrektur). */
export function fromWall(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 3; i++) {
    const wall = wallTime(guess, tz);
    const diffMin =
      (Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm)) /
      60000;
    if (diffMin === 0) return guess;
    guess = new Date(guess.getTime() + diffMin * 60000);
  }
  return guess;
}

function parseHHMM(value: string): { hh: number; mm: number } {
  const [hh, mm] = value.split(":").map(Number);
  return { hh: hh || 0, mm: mm || 0 };
}

/** Arbeitsfenster (UTC-Intervalle) des Kalendertags, in den `at` fällt. */
function windowsOfDay(at: Date, cal: BusinessCalendar): { start: Date; end: Date }[] {
  const wall = wallTime(at, cal.timezone);
  if (cal.holidays.includes(wall.dateStr)) return [];
  const ranges = cal.schedule?.[wall.weekday] ?? [];
  return ranges
    .map(([from, to]) => {
      const f = parseHHMM(from);
      const t = parseHHMM(to);
      return {
        start: fromWall(wall.y, wall.m, wall.d, f.hh, f.mm, cal.timezone),
        end: fromWall(wall.y, wall.m, wall.d, t.hh, t.mm, cal.timezone),
      };
    })
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Nächster Kalendertag, 00:00 Wanduhrzeit (Date.UTC normalisiert Monatsüberläufe). */
function nextDayStart(at: Date, tz: string): Date {
  const wall = wallTime(at, tz);
  return fromWall(wall.y, wall.m, wall.d + 1, 0, 0, tz);
}

const MAX_DAYS = 730;

/** Frist: `start` + `minutes` Geschäftsminuten. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!cal.schedule) return new Date(start.getTime() + minutes * 60000);

  let remaining = minutes;
  let cursor = start;
  for (let day = 0; day < MAX_DAYS; day++) {
    for (const window of windowsOfDay(cursor, cal)) {
      if (cursor >= window.end) continue;
      const effectiveStart = cursor > window.start ? cursor : window.start;
      const available = (window.end.getTime() - effectiveStart.getTime()) / 60000;
      if (available >= remaining) {
        return new Date(effectiveStart.getTime() + remaining * 60000);
      }
      remaining -= available;
      cursor = window.end;
    }
    cursor = nextDayStart(cursor, cal.timezone);
  }
  return cursor; // Kalender ohne nutzbare Fenster — Obergrenze erreicht
}

/** Geschäftsminuten zwischen zwei Zeitpunkten (für SLA-Pausen). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  if (to <= from) return 0;
  if (!cal.schedule) return (to.getTime() - from.getTime()) / 60000;

  let total = 0;
  let cursor = from;
  for (let day = 0; day < MAX_DAYS && cursor < to; day++) {
    for (const window of windowsOfDay(cursor, cal)) {
      const start = cursor > window.start ? cursor : window.start;
      const end = to < window.end ? to : window.end;
      if (end > start) total += (end.getTime() - start.getTime()) / 60000;
    }
    cursor = nextDayStart(cursor, cal.timezone);
  }
  return total;
}
