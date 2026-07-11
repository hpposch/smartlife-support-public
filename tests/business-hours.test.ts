import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  fromWall,
  wallTime,
  type BusinessCalendar,
} from "../src/lib/business-hours";

// Mo–Fr 09:00–17:00, Europe/Vienna
const CAL: BusinessCalendar = {
  timezone: "Europe/Vienna",
  schedule: {
    mon: [["09:00", "17:00"]],
    tue: [["09:00", "17:00"]],
    wed: [["09:00", "17:00"]],
    thu: [["09:00", "17:00"]],
    fri: [["09:00", "17:00"]],
  },
  holidays: ["2026-07-14"], // Dienstag als Feiertag
};

const vienna = (y: number, m: number, d: number, hh: number, mm = 0) =>
  fromWall(y, m, d, hh, mm, "Europe/Vienna");

describe("wallTime/fromWall", () => {
  it("sind invers zueinander (Sommerzeit)", () => {
    const date = vienna(2026, 7, 10, 14, 30); // Juli = CEST (UTC+2)
    expect(date.toISOString()).toBe("2026-07-10T12:30:00.000Z");
    const wall = wallTime(date, "Europe/Vienna");
    expect([wall.hh, wall.mm, wall.weekday]).toEqual([14, 30, "fri"]);
  });

  it("sind invers zueinander (Winterzeit)", () => {
    const date = vienna(2026, 1, 15, 14, 30); // Januar = CET (UTC+1)
    expect(date.toISOString()).toBe("2026-01-15T13:30:00.000Z");
  });
});

describe("addBusinessMinutes", () => {
  it("bleibt im selben Fenster", () => {
    // Freitag 10:00 + 2h = Freitag 12:00
    expect(addBusinessMinutes(vienna(2026, 7, 10, 10), 120, CAL)).toEqual(
      vienna(2026, 7, 10, 12)
    );
  });

  it("läuft über das Tagesende ins nächste Fenster", () => {
    // Freitag 16:00 + 2h = 1h heute + 1h Montag → Montag 10:00
    expect(addBusinessMinutes(vienna(2026, 7, 10, 16), 120, CAL)).toEqual(
      vienna(2026, 7, 13, 10)
    );
  });

  it("startet außerhalb der Zeiten am Fensterbeginn", () => {
    // Samstag + 1h → Montag 10:00
    expect(addBusinessMinutes(vienna(2026, 7, 11, 12), 60, CAL)).toEqual(
      vienna(2026, 7, 13, 10)
    );
  });

  it("überspringt Feiertage", () => {
    // Montag 16:00 + 2h: 1h Montag, Dienstag (14.7.) ist Feiertag → Mittwoch 10:00
    expect(addBusinessMinutes(vienna(2026, 7, 13, 16), 120, CAL)).toEqual(
      vienna(2026, 7, 15, 10)
    );
  });

  it("ist über die Sommerzeit-Umstellung stabil", () => {
    // Fr 27.03.2026 16:00 + 2h → Mo 30.03. 10:00 Wanduhrzeit (Umstellung am 29.03.)
    const due = addBusinessMinutes(vienna(2026, 3, 27, 16), 120, CAL);
    const wall = wallTime(due, "Europe/Vienna");
    expect([wall.dateStr, wall.hh, wall.mm]).toEqual(["2026-03-30", 10, 0]);
  });

  it("24/7 ohne Kalender", () => {
    const cal: BusinessCalendar = { timezone: "Europe/Vienna", schedule: null, holidays: [] };
    const start = new Date("2026-07-11T10:00:00Z");
    expect(addBusinessMinutes(start, 90, cal)).toEqual(new Date("2026-07-11T11:30:00Z"));
  });
});

describe("businessMinutesBetween", () => {
  it("zählt nur Geschäftszeit", () => {
    // Freitag 16:00 bis Montag 10:00 = 1h + 1h
    expect(
      businessMinutesBetween(vienna(2026, 7, 10, 16), vienna(2026, 7, 13, 10), CAL)
    ).toBe(120);
  });

  it("Wochenende zählt nicht", () => {
    expect(
      businessMinutesBetween(vienna(2026, 7, 11, 8), vienna(2026, 7, 12, 20), CAL)
    ).toBe(0);
  });

  it("ist konsistent mit addBusinessMinutes", () => {
    const start = vienna(2026, 7, 10, 15, 30);
    const due = addBusinessMinutes(start, 300, CAL);
    expect(Math.round(businessMinutesBetween(start, due, CAL))).toBe(300);
  });
});
