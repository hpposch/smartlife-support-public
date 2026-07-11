# 05 — Roadmap & Umsetzungsplan

Grundsatz: **so früh wie möglich produktiv gehen.** Das MVP ersetzt das gemeinsame Support-Postfach — alles Weitere baut im laufenden Betrieb darauf auf. Aufwände sind Schätzungen für eine erfahrene Vollzeit-Entwicklungskraft; bei Teilzeit entsprechend strecken.

## Phase 1 — MVP: E-Mail-Ticketing (ca. 4–6 Wochen)

**Ziel:** Support-Postfach läuft vollständig über das System; kein Kunde merkt die Umstellung.

| Woche | Inhalt |
|---|---|
| 1 | Projekt-Setup (Next.js, Prisma, Docker Compose, CI), Schema-Migrationen für alle MVP-Tabellen, Auth für Agenten (Passwort; SSO optional nachziehen) |
| 2 | E-Mail-Eingang: IMAP-Poller, Parser, Threading, Contact-Zuordnung, Idempotenz, Loop-Schutz |
| 3 | E-Mail-Ausgang: Antworten mit korrektem Threading, Benachrichtigungs-Mails, Textbausteine |
| 4 | Agenten-UI: Ticketliste mit Filtern, Ticketdetail mit Verlauf, Antwort-/Notiz-Editor, Anhänge, Zuweisung, Status/Priorität/Tags |
| 5 | Verwaltung (Benutzer, Teams, Postfächer, Kategorien), Audit-Log, einfache Suche, Seed-Daten |
| 6 | Härtung: Parallelbetrieb mit echtem Postfach (Staging), Edge-Cases (Auto-Replies, Bounces, große Anhänge, kaputte MIME), Backups, Go-Live |

**Abnahmekriterien:**
- E-Mail an support@ → Ticket in < 60 s sichtbar, Kunde erhält Bestätigung mit Ticketnummer
- Agentenantwort kommt beim Kunden als saubere Antwort im selben Thread an; Kundenantwort landet im richtigen Ticket
- Kein Duplikat bei doppeltem Abruf, keine Endlosschleife mit Abwesenheitsnotizen
- Restore-Test des Backups erfolgreich

## Phase 2 — Portal & Wissensdatenbank (ca. 3–4 Wochen)

- Kundenportal: Login (Passwort + Magic-Link), eigene Tickets, Antwort, neues Ticket per Formular
- Wissensdatenbank: Editor, Kategorien, öffentliche Ansicht unter `support.smartlife.software`, Suche
- Custom Fields (Ticket/Contact), gespeicherte Ansichten, Merge, Kollisionserkennung (SSE)
- Basis-Dashboard (offene Tickets, Eingang/Woche, ø Erstreaktion), Englisch als zweite Sprache

## Phase 3 — SLA, Automatisierung, Reporting (ca. 3–4 Wochen)

- Geschäftszeiten + SLA-Richtlinien, Fristenberechnung, Pausierung, Eskalations-Benachrichtigungen
- Regel-Engine (Erstellungs- + zeitgesteuerte Regeln), Auto-Schließen, Round-Robin-Zuweisung, Makros
- CSAT-Umfragen, vollständiges Reporting mit CSV-Export, ausgehende Webhooks

## Phase 4 — KI & Erweiterungen (fortlaufend)

- Claude-API-Integration: Antwortentwürfe (Ticketverlauf + KB als Kontext), Zusammenfassungen, Auto-Kategorisierung, Stimmungs-Kennzeichnung
- Optional nach Bedarf: Live-Chat-Widget, WhatsApp, tiefere Produkt-Integrationen (Kundendaten aus SmartLife-Systemen im Ticket-Seitenpanel)

## Risiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| E-Mail-Edge-Cases (Encodings, kaputte MIME, exotische Clients) | Rohdaten 90 Tage aufheben → Re-Processing; Woche 6 explizit für Härtung reserviert; Parallelbetrieb vor Go-Live |
| Zustellbarkeit ausgehender Mails (Spam-Ordner) | SPF/DKIM/DMARC korrekt setzen; Versand über bestehendes M365-Postfach oder Transaktionsdienst |
| Scope Creep vor Go-Live | Striktes MVP: alles außerhalb Phase 1 wird notiert, nicht gebaut |
| Ein-Personen-Wissen | Dieses Docs-Verzeichnis aktuell halten; Setup vollständig in Docker Compose + README |

## Offene Entscheidungen (vor Phase 1 zu klären)

1. **Stack bestätigen:** TypeScript/Next.js wie empfohlen — oder .NET, falls das Team dort stärker ist? (Design bleibt gültig)
2. **E-Mail-Anbindung:** IMAP-Polling gegen bestehendes M365-Postfach (einfachster Start) oder Inbound-Dienst wie Postmark?
3. **Hosting:** eigener VPS (z. B. Hetzner, EU) vorhanden oder neu aufsetzen?
4. **Agenten-Login:** direkt Microsoft-Entra-SSO im MVP oder erst Passwort-Login?
