# SmartLife Support System

Eigenes, selbst gehostetes Kundensupport-System für **smartlife.software** — funktional angelehnt an [BoldDesk](https://www.bolddesk.com/), aber ohne Lizenzkosten pro Agent, mit voller Datenhoheit (DSGVO) und Anpassbarkeit an die eigenen Produkte.

## Zielbild

Ein Helpdesk mit den Kernfähigkeiten moderner Support-Software:

| Bereich | Kurzbeschreibung |
|---|---|
| **Ticketing** | E-Mails und Portal-Anfragen werden zu Tickets mit Status, Priorität, Zuweisung und vollständigem Verlauf |
| **Multichannel** | E-Mail (IMAP/SMTP), Kundenportal, Web-Formular; später Chat |
| **Kundenportal** | Kunden sehen ihre Tickets, antworten darauf und durchsuchen die Wissensdatenbank |
| **Wissensdatenbank** | Öffentliche und interne Artikel, Kategorien, Volltextsuche |
| **SLA & Automatisierung** | Reaktions-/Lösungsfristen, Eskalationen, Regeln ("wenn X, dann Y"), Textbausteine |
| **Reporting** | Ticketaufkommen, Antwortzeiten, SLA-Einhaltung, Agenten-Auslastung |
| **KI-Unterstützung** | Antwortentwürfe, Zusammenfassungen, automatische Kategorisierung (Phase 4) |

## Dokumentation

Die Planung ist in fünf Dokumente gegliedert — in dieser Reihenfolge lesen:

1. [Anforderungen & Funktionsumfang](docs/01-anforderungen.md) — was das System können muss, inkl. Abgrenzung MVP vs. Ausbaustufen
2. [Architektur & Technologie-Stack](docs/02-architektur.md) — Systemaufbau, Stack-Entscheidung, E-Mail-Pipeline, Deployment
3. [Datenmodell](docs/03-datenmodell.md) — ER-Modell und vollständiges SQL-Schema
4. [API-Spezifikation](docs/04-api-spezifikation.md) — REST-Endpunkte für Agenten-App, Portal und Integrationen
5. [Roadmap & Umsetzungsplan](docs/05-roadmap.md) — Phasen, Aufwandsschätzung, Meilensteine

## Make or Buy — kurz eingeordnet

Bevor gebaut wird, lohnt der ehrliche Blick auf Alternativen:

- **BoldDesk / Zendesk / Freshdesk (SaaS):** schnell startklar, aber laufende Kosten pro Agent, Daten beim Anbieter, begrenzte Anpassbarkeit.
- **Open Source (Zammad, FreeScout, Chatwoot, OTOBO):** kostenlos self-hosted, aber jeweils eigener Stack (Ruby/PHP), Anpassungen bedeuten Fremdcode pflegen.
- **Eigenbau (dieses Projekt):** volle Kontrolle über Stack, Datenmodell und Integrationen in die eigenen SmartLife-Produkte; Aufwand liegt in der Erstellung und Pflege.

Die Entscheidung für den Eigenbau ist dann sinnvoll, wenn tiefe Produktintegration (z. B. Gerätedaten, Kundenkonten, Lizenzstatus direkt im Ticket) und Datenhoheit wichtiger sind als der schnellste Start. Genau darauf ist dieses Design ausgelegt — das MVP ist bewusst schlank gehalten (siehe Roadmap), damit der Erstaufwand überschaubar bleibt.

## Stand der Umsetzung

**Phase 1 (MVP E-Mail-Ticketing) ist implementiert:**

- ✅ E-Mail-Eingang: IMAP-Poller, MIME-Parsing, HTML-Sanitisierung, Anhänge, 3-stufiges Threading (In-Reply-To/References → Betreff-Token → neues Ticket), Idempotenz, Auto-Reply-/Bounce-/Schleifen-Schutz
- ✅ E-Mail-Ausgang: Agentenantworten mit korrekten Threading-Headern, Eingangsbestätigung an Kunden, Agenten-Benachrichtigung, Retry mit Backoff
- ✅ Agenten-UI: Ticketliste mit Filtern & Suche, Ticketdetail mit Verlauf, Antwort/interne Notiz, Anhänge, Status/Priorität/Zuweisung/Kategorie/Tags, manuelles Ticket
- ✅ Verwaltung: Benutzer, Postfächer, Kategorien, Textbausteine (mit Platzhaltern)
- ✅ Audit-Log (`ticket_events`), Integrations-API (`POST /api/v1/tickets`), Docker-Compose-Deployment

**Härtung ist umgesetzt:**

- ✅ **Backups als eine Datei:** täglich automatisch (Worker, `BACKUP_CRON`), manuell unter *Verwaltung → Backups* (inkl. Download); Wiederherstellung aus genau dieser Datei per `npm run backup:restore -- <datei>` — Datenbank **und** Anhänge/Roh-E-Mails zusammen
- ✅ Login-Rate-Limiting, Security-Header, `/api/health` + Docker-Healthcheck, GitHub-Actions-CI

**Phase 2 (Kundenportal + Wissensdatenbank) ist implementiert:**

- ✅ Kundenportal unter `/portal`: passwortloser Login per Magic-Link (30 min gültig, Einmal-Verwendung, nur Hash in der DB), eigene Anfragen einsehen/beantworten/schließen, neue Anfrage per Formular — strikt auf den eigenen Kontakt beschränkt
- ✅ Hilfe-Center unter `/kb`: öffentliche Wissensdatenbank mit Kategorien, Suche und Markdown-Artikeln; Sichtbarkeit pro Artikel (öffentlich / nur Kunden / intern); Pflege unter *Verwaltung → Wissensdatenbank*
- ⬜ Restliche P2-Punkte: Custom Fields, gespeicherte Ansichten, Merge, Kollisionserkennung, Basis-Dashboard, Englisch
- ⬜ Phase 3–4: SLA, Automatisierung, Reporting, KI (siehe Roadmap)

## Entwicklung starten

Voraussetzungen: Node 22, PostgreSQL 16, Redis 7 (oder `docker compose up db redis`).

```bash
cp .env.example .env          # Werte anpassen (mind. SESSION_SECRET)
npm install
npx prisma migrate dev        # Schema anlegen
npm run db:seed               # Admin-Benutzer, Team, Kategorien
npm run dev                   # Web-App auf http://localhost:3000
npm run worker                # E-Mail-Worker (zweites Terminal)
```

Login nach dem Seed: `admin@smartlife.software` / `admin1234` (via `SEED_ADMIN_*` in `.env` änderbar — **vor Produktivbetrieb ändern**).

Postfächer werden unter **Verwaltung → Postfächer** angebunden; das Passwort kommt aus der ENV-Variable, die im Feld `credentialsRef` benannt wird (z. B. `MAILBOX_SUPPORT_PASSWORD`).

**Tests:** `npm test` (Unit-Tests für Threading/Sanitisierung/Auto-Reply-Erkennung) und `npx tsx scripts/smoke-ingest.ts` (End-to-End-Test der E-Mail-Pipeline gegen DB+Redis).

**Produktion:** `docker compose up -d --build` — startet Web, Worker, PostgreSQL und Redis; davor `.env` mit echten Secrets füllen. TLS/Reverse-Proxy (z. B. Caddy) je nach Server-Setup davorschalten.
