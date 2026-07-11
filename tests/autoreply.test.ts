import { describe, expect, it } from "vitest";
import { headersFromMap, isAutoSubmitted, isBounce } from "../src/lib/autoreply";

function headers(entries: Record<string, string>) {
  return headersFromMap(new Map(Object.entries(entries)));
}

describe("isAutoSubmitted", () => {
  it("erkennt Auto-Submitted: auto-replied", () => {
    expect(isAutoSubmitted(headers({ "auto-submitted": "auto-replied" }))).toBe(true);
  });

  it("akzeptiert Auto-Submitted: no", () => {
    expect(isAutoSubmitted(headers({ "auto-submitted": "no" }))).toBe(false);
  });

  it("erkennt Precedence: bulk und X-Autoreply", () => {
    expect(isAutoSubmitted(headers({ precedence: "bulk" }))).toBe(true);
    expect(isAutoSubmitted(headers({ "x-autoreply": "yes" }))).toBe(true);
  });

  it("normale Mail ist nicht auto", () => {
    expect(isAutoSubmitted(headers({ subject: "Hallo" }))).toBe(false);
  });
});

describe("isBounce", () => {
  it("erkennt delivery-status-Reports", () => {
    expect(
      isBounce(
        headers({ "content-type": "multipart/report; report-type=delivery-status" }),
        "someone@example.com"
      )
    ).toBe(true);
  });

  it("erkennt MAILER-DAEMON-Absender", () => {
    expect(isBounce(headers({}), "MAILER-DAEMON@mail.example.com")).toBe(true);
    expect(isBounce(headers({}), "postmaster@example.com")).toBe(true);
  });

  it("normale Absender sind kein Bounce", () => {
    expect(isBounce(headers({}), "kunde@example.com")).toBe(false);
  });
});
