import { describe, expect, it } from "vitest";
import {
  cleanSubject,
  generateTicketToken,
  parseSubjectTag,
  replySubject,
  subjectTag,
} from "../src/lib/ticket-token";

describe("subjectTag / parseSubjectTag", () => {
  it("ist symmetrisch", () => {
    const token = generateTicketToken();
    const tag = subjectTag(1042, token);
    expect(parseSubjectTag(`Re: Drucker kaputt ${tag}`)).toEqual({ number: 1042, token });
  });

  it("liefert null ohne Tag", () => {
    expect(parseSubjectTag("Re: Drucker kaputt")).toBeNull();
  });

  it("ignoriert ähnliche, aber ungültige Tags", () => {
    expect(parseSubjectTag("Bestellung [#12-zzzz]")).toBeNull();
    expect(parseSubjectTag("[#-a3f9c2d1]")).toBeNull();
  });

  it("parst case-insensitiv", () => {
    expect(parseSubjectTag("AW: Hilfe [#7-A3F9C2D1]")).toEqual({
      number: 7,
      token: "a3f9c2d1",
    });
  });
});

describe("cleanSubject", () => {
  it("entfernt Re:/AW:/Fwd:-Präfixe auch mehrfach", () => {
    expect(cleanSubject("Re: AW: Fwd: Drucker kaputt")).toBe("Drucker kaputt");
    expect(cleanSubject("WG: Re[2]: Frage")).toBe("Frage");
  });

  it("entfernt vorhandene Ticket-Tags", () => {
    expect(cleanSubject("Re: Drucker kaputt [#1042-a3f9c2d1]")).toBe("Drucker kaputt");
  });

  it("lässt normale Betreffe unverändert", () => {
    expect(cleanSubject("Rechnung Februar")).toBe("Rechnung Februar");
  });
});

describe("replySubject", () => {
  it("baut genau einen Re:-Präfix und einen Tag", () => {
    const subject = replySubject("Re: Drucker kaputt [#1042-a3f9c2d1]", 1042, "a3f9c2d1");
    expect(subject).toBe("Re: Drucker kaputt [#1042-a3f9c2d1]");
  });

  it("hat einen Fallback bei leerem Betreff", () => {
    expect(replySubject("", 5, "deadbeef")).toBe("Re: Ihre Anfrage [#5-deadbeef]");
  });
});
