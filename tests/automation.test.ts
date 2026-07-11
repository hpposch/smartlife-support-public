import { describe, expect, it } from "vitest";
import type { Ticket } from "@prisma/client";
import { creationRuleMatches } from "../src/server/automation";
import { policyMatches } from "../src/server/sla";

const ticket = (overrides: Partial<Ticket> = {}): Ticket =>
  ({
    id: "t1",
    channel: "email",
    priority: "normal",
    categoryId: "cat-billing",
    organizationId: "org-1",
    subject: "Frage zur Rechnung Juli",
    status: "new",
    ...overrides,
  }) as Ticket;

describe("creationRuleMatches", () => {
  it("leere Bedingungen passen immer", () => {
    expect(creationRuleMatches({}, ticket())).toBe(true);
  });

  it("prüft Kanal, Priorität und Kategorie", () => {
    expect(creationRuleMatches({ channels: ["email"] }, ticket())).toBe(true);
    expect(creationRuleMatches({ channels: ["portal"] }, ticket())).toBe(false);
    expect(creationRuleMatches({ priorities: ["urgent"] }, ticket())).toBe(false);
    expect(creationRuleMatches({ categoryIds: ["cat-billing"] }, ticket())).toBe(true);
    expect(creationRuleMatches({ categoryIds: ["cat-x"] }, ticket({ categoryId: null }))).toBe(false);
  });

  it("Betreff-Suche ist case-insensitiv", () => {
    expect(creationRuleMatches({ subjectContains: "RECHNUNG" }, ticket())).toBe(true);
    expect(creationRuleMatches({ subjectContains: "Mahnung" }, ticket())).toBe(false);
  });
});

describe("policyMatches (SLA)", () => {
  it("leere Bedingungen passen immer", () => {
    expect(policyMatches({}, ticket())).toBe(true);
  });

  it("prüft Kanal, Kategorie und Organisation", () => {
    expect(policyMatches({ channels: ["email", "portal"] }, ticket())).toBe(true);
    expect(policyMatches({ categoryIds: ["cat-billing"] }, ticket())).toBe(true);
    expect(policyMatches({ organizationIds: ["org-2"] }, ticket())).toBe(false);
    expect(policyMatches({ organizationIds: ["org-1"] }, ticket({ organizationId: null }))).toBe(false);
  });
});
