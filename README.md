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

- ✅ Kundenportal unter `/portal`: Login mit dem **Azure-AD-B2C-Kundenkonto** (OpenID Connect, Authorization Code Flow + PKCE); Kontakte werden über die B2C-Objekt-ID stabil verknüpft, bestehende Kontakte per E-Mail-Abgleich übernommen. Ohne B2C-Konfiguration (oder zusätzlich per `PORTAL_MAGIC_LINK=true`): passwortloser Magic-Link-Login. Eigene Anfragen einsehen/beantworten/schließen, neue Anfrage per Formular — strikt auf den eigenen Kontakt beschränkt
- ✅ Hilfe-Center unter `/kb`: öffentliche Wissensdatenbank mit Kategorien, Suche und Markdown-Artikeln; Sichtbarkeit pro Artikel (öffentlich / nur Kunden / intern); Pflege unter *Verwaltung → Wissensdatenbank*
**Phase 3 (SLA, Automatisierung, Reporting) ist implementiert:**

- ✅ **SLA:** Geschäftszeiten-Kalender (Zeitzone, Feiertage), SLA-Richtlinien mit Zielen je Priorität (Erstreaktion/Lösung), Fristen laufen nur in Geschäftszeiten, Uhr pausiert bei „Wartet auf Kunde“, Eskalation bei Verletzung (System-Notiz + E-Mail an Agent/Teamleitung), Anzeige in Liste und Detail
- ✅ **Automatisierung:** Erstellungsregeln (Kanal/Betreff → Priorität, Kategorie, Team, Tags, Zuweisung inkl. Round-Robin) und Zeitregeln (z. B. „Gelöst + 5 Tage → automatisch schließen“)
- ✅ **CSAT:** Bewertungs-Mail (1–5) nach Lösung, öffentliche Bewertungsseite, Auswertung im Reporting (`CSAT_ENABLED=true`)
- ✅ **Reporting** unter `/reports` (Teamleitung/Admin): Kennzahlen, SLA-Quoten, CSAT, nach Kategorie/Agent, Tagesverlauf, CSV-Export
- ✅ **Webhooks:** signierte POSTs (`X-Signature`, HMAC-SHA256) bei `ticket.created/replied/resolved/closed`, Retry + Auto-Deaktivierung
**Phase 4 (KI-Unterstützung) ist implementiert:**

- ✅ **KI-Antwortentwürfe:** „✨ KI-Entwurf“ im Ticket erstellt einen Antwortvorschlag aus dem Ticketverlauf + passenden Wissensdatenbank-Artikeln — der Agent prüft und sendet
- ✅ **Zusammenfassung:** „✨ Zusammenfassen“ hängt eine kompakte Verlaufszusammenfassung als interne Notiz an (praktisch bei Ticket-Übergaben)
- ✅ **Auto-Klassifizierung:** Neue Tickets werden im Worker automatisch klassifiziert — Kategorie (nur wenn leer, Regeln haben Vorrang), Prioritätsanhebung bei Dringlichkeit, Tag „verärgert“ bei negativer Stimmung; jede Änderung im Audit-Log
- ✅ **Chat-Assistent** in Hilfe-Center und Portal: schwebendes Chat-Widget, beantwortet Fragen auf Basis der Wissensdatenbank (mit Artikel-Links) und bietet bei Bedarf die Ticket-Erstellung an — das Ticket enthält den kompletten Chatverlauf (Kanal `chat`); anonyme Besucher geben ihre E-Mail an, eingeloggte Kunden werden übernommen; Rate-Limits gegen Missbrauch
- ✅ **Zwei Provider zur Wahl** (siehe `.env.example`): **Claude API** — `ANTHROPIC_API_KEY` setzen (Modell: `claude-opus-4-8`, via `AI_MODEL` änderbar) — **oder eine beliebige OpenAI-kompatible API** (OpenAI, Azure OpenAI, OpenRouter, LiteLLM, Ollama, vLLM …) über `AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL`. Strukturierte Ausgaben nutzen dort `response_format: json_schema`; Server ohne diesen Support bekommen automatisch einen zweiten Versuch mit Schema im Prompt. Ist keine der Varianten konfiguriert, sind alle KI-Funktionen (inkl. Chat-Widget) ausgeblendet — das System läuft vollständig ohne
- ⬜ Offen: englische Oberfläche (Portal/Agenten-UI sind derzeit deutsch)

## Weitere Funktionen (Ausbaustufe Juli 2026)

**Kunden & Portal**

- **Anhänge**: Datei-Uploads bei neuer Anfrage und Antworten im Portal sowie bei der Ticket-Erstellung aus dem Chat (max. 5 Dateien à 10 MB; ausführbare Dateien werden abgelehnt)
- **Artikel-Feedback & Suchstatistik**: „War dieser Artikel hilfreich?“ (anonym) am Artikelende; alle Hilfe-Center-Suchen werden protokolliert — die Berichte zeigen schlecht bewertete Artikel und die häufigsten **Suchen ohne Treffer** (Doku-Lücken)
- **Bessere Suche**: Postgres-Volltextsuche (deutsch + englisch, Ranking) für Hilfe-Center, Chat-Assistent und KI-Entwürfe; mit OpenAI-kompatiblem Provider zusätzlich **semantische Suche** über Embeddings (`AI_EMBEDDING_MODEL`, Indexierung automatisch im Worker und nach dem Doku-Import)
- **Custom Fields pro Produkt** (*Verwaltung → Produkte → Felder*): Text/Auswahl/Zahl, optional Pflicht — werden im Portal-Formular abgefragt, am Ticket angezeigt und von der API (`custom_fields`) validiert
- **Eigener Login pro Produkt**: generische OIDC-Konfiguration je Produkt (Authority, Client-ID, Secret als ENV-Referenz) für eigenes Azure B2C, Entra ID, Google u. a.; ohne Produkt-Konfiguration gilt das globale Azure B2C

**Kanäle**

- **Einbettbares Kontaktformular**: `<iframe src="https://support.…/embed/form?product=<kürzel>" style="width:100%;height:420px;border:0"></iframe>` — mit Honeypot + Rate-Limit, Bestätigungsmail an den Kunden
- **WhatsApp Business (Cloud API)**: eingehende Nachrichten werden Tickets (Kanal `whatsapp`, Kontakt über Telefonnummer, offene Konversation wird weitergeführt), Agentenantworten gehen als WhatsApp-Nachricht zurück (24-h-Fenster der Cloud API beachten). Einrichtung: Meta-App mit WhatsApp-Produkt, Webhook-URL `https://…/api/whatsapp/webhook` + `WHATSAPP_VERIFY_TOKEN`, dann `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` in der `.env`

**Agenten-Produktivität**

- **Gespeicherte Ansichten** (Filter-Chips über der Ticketliste, pro Agent), **Makros** (*Verwaltung → Makros*: Antwort + Status/Priorität/Tags in einem Klick), **Ticket-Zusammenführen** (nur gleicher Kunde; Quelle wird geschlossen, alles im Audit-Log) und **Kollisionswarnung** (Banner, wenn Kolleg:innen dasselbe Ticket geöffnet haben)
- **✨ KB-Artikel** am Ticket: KI destilliert den gelösten Fall zu einem anonymisierten Wissensdatenbank-Entwurf im Produkt des Tickets

**DSGVO**

- **Datenauskunft** (JSON-Export) und **unwiderrufliche Anonymisierung** pro Kontakt (Ticket-Seitenleiste → „Datenschutz“); **Aufbewahrungsfrist** `RETENTION_ANONYMIZE_DAYS` schwärzt Inhalte lange geschlossener Tickets automatisch

**Betrieb & Sicherheit**

- **Monitoring**: `/api/health` meldet zusätzlich Worker-/Mail-Abruf-Heartbeats (`status: degraded`); bei stehendem Postfach-Abruf geht eine Alert-Mail an `ALERT_EMAIL` (max. alle 6 h)
- **2FA (TOTP)** für Agenten (🔒 im Kopfbereich bzw. *Verwaltung → Sicherheit*): QR-Code für Authenticator-Apps, zweiter Login-Schritt
- **Backup-Upload zu S3-kompatiblem Speicher** (`S3_BACKUP_BUCKET` + Zugangsdaten): jedes Backup wird zusätzlich hochgeladen; lokale Rotation bleibt

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

### Gmail-Postfach anbinden (support@smartlifebi.com)

Gmail erlaubt keine normalen Passwörter für IMAP/SMTP — es braucht ein **App-Passwort**:

1. **2-Faktor-Authentifizierung aktivieren** für das Google-Konto des Postfachs (App-Passwörter gibt es nur mit 2FA; bei Google Workspace darf der Admin sie nicht deaktiviert haben)
2. **App-Passwort erzeugen:** [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → Name z. B. „SmartLife Support“ → das 16-stellige Passwort **ohne Leerzeichen** kopieren
3. **IMAP aktivieren:** Gmail → Zahnrad → *Alle Einstellungen* → *Weiterleitung und POP/IMAP* → IMAP aktivieren
4. **In der `.env`** (bzw. im Deployment): `MAILBOX_SUPPORT_PASSWORD="<app-passwort>"`
5. **Unter Verwaltung → Postfächer anlegen:**
   | Feld | Wert |
   |---|---|
   | Adresse / IMAP-/SMTP-Benutzer | `support@smartlifebi.com` |
   | IMAP | `imap.gmail.com` : `993` |
   | SMTP | `smtp.gmail.com` : `587` |
   | credentialsRef | `MAILBOX_SUPPORT_PASSWORD` |
6. **Anbindung prüfen:** `npm run mailbox:check -- support@smartlifebi.com` — testet IMAP- und SMTP-Login, ohne etwas zu versenden

Hinweise für den Betrieb mit Gmail:
- Der Versand läuft über `smtp.gmail.com` mit erzwungenem TLS; Gmail legt gesendete Mails automatisch im „Gesendet“-Ordner ab
- Gmail-Limit: ca. 500 (Konto) bzw. 2.000 (Workspace) ausgehende Mails/Tag — für Support-Volumen normalerweise unkritisch
- Für die Zustellbarkeit sollten **SPF/DKIM für smartlifebi.com** in Google Workspace eingerichtet sein (Admin-Konsole → Apps → Google Workspace → Gmail → E-Mail-Authentifizierung)
- Ändert Gmail die interne IMAP-Nummerierung (UIDVALIDITY), erkennt der Poller das und beginnt den Abruf neu — Duplikate entstehen dabei nicht (Message-ID-Schutz)

### Mehrere Produkte über ein Portal (Mandanten)

Eine Installation kann den Support für mehrere Produkte übernehmen — z. B. `support.smartlifebi.com` **und** `support.plantbeat.io`. Die aufgerufene **Domain entscheidet**, welches Produkt Kunden sehen: eigener Portalname, eigene Wissensdatenbank, nur die eigenen Anfragen. Tickets, KB-Artikel/-Kategorien und Postfächer hängen an genau einem Produkt; die Agenten-Oberfläche bleibt produktübergreifend (mit Produkt-Badge und -Filter in der Ticketliste).

Einrichtung:

1. **Verwaltung → Produkte:** neues Produkt anlegen (Anzeigename, Kürzel, Portal-Domain, Portal-URL). Ohne Domain-Treffer gilt das Standard-Produkt.
2. **DNS/Reverse-Proxy:** beide Domains auf dieselbe Installation zeigen lassen (der Proxy muss den `Host`-Header durchreichen).
3. **Postfach** des Produkts anbinden (Verwaltung → Postfächer, Produkt wählen) — eingehende Mails an dieses Postfach werden dem Produkt zugeordnet.
4. **Wissensdatenbank** pro Produkt füllen: Import mit `--product <kürzel>` (s. unten), oder Artikel manuell mit Produktauswahl anlegen.

Produktbezogen sind außerdem: Absendername („\<Produkt\> Support") und Signatur in Kunden-Mails, Magic-Link-/CSAT-Links (Portal-URL des Produkts), Chat-Assistent (antwortet nur aus der KB des jeweiligen Produkts, Tickets landen im richtigen Produkt) und `POST /api/v1/tickets` (optionales Feld `product` mit dem Kürzel). Hinweis: Der Azure-B2C-Login ist auf die Redirect-URI der Haupt-Domain registriert — auf weiteren Produkt-Domains steht der Magic-Link-Login zur Verfügung (`PORTAL_MAGIC_LINK=true`, Standard ohne B2C).

**Portal-Branding (einstellbar pro Produkt):** Das Hilfe-Center hat einen farbigen Hero-Bereich mit zentrierter Suche und Kategorie-Karten mit Icons — im Stil gängiger Support-Portale. Unter *Verwaltung → Produkte* lassen sich **Portalfarbe** (Hero-Hintergrund, Buttons, Akzente) und **Logo** (erscheint im Kopfbereich von Hilfe-Center und Portal) je Produkt festlegen; unter *Verwaltung → Wissensdatenbank* bekommt jede Kategorie optional ein eigenes **Icon** (PNG/JPG/SVG/WebP, ohne Icon: neutrales Ordner-Symbol in der Portalfarbe). Ohne Einstellungen gilt das bisherige Blau.

### Help-Portal (Produkt-Doku) — eigenständig auf Port 3001

Die komplette Produktdokumentation (Stil `help.smartlifebi.com/getting-started/`) ist **kein Teil der Support-Wissensdatenbank**, sondern ein eigenständiges, statisches Help-Portal, das **parallel auf einem eigenen Port (3001)** läuft. Die Wissensdatenbank unter `/kb` bleibt dem Support-Portal vorbehalten — für kuratierte Support-Artikel (How-tos, bekannte Probleme, FAQs).

Das Help-Portal wird aus dem [boldbi/bold-bi-docs](https://github.com/boldbi/bold-bi-docs)-Repo generiert: ~890 Seiten mit Original-URL-Struktur (`/getting-started/…`, `/working-with-dashboards/…`), Sidebar-Navigation nach Abschnitten, Titel-Suche, allen Bildern — und durchgängigem Rebranding **„Bold BI" → „smartlife BI"**, **„Syncfusion" → „smartlife"** (Links auf `help.boldbi.com` werden intern, `support.boldbi.com` zeigt auf das Support-Portal).

```bash
# Site bauen (lokal; Ausgabe: ./data/help-site bzw. $HELP_SITE_DIR)
git clone --depth 1 https://github.com/boldbi/bold-bi-docs.git /tmp/bold-bi-docs
npx tsx scripts/build-help-site.ts /tmp/bold-bi-docs

# Server starten (Port per HELP_PORT, Standard 3001)
npx tsx scripts/help-server.ts
```

Einstellbar per Umgebungsvariablen beim Bauen: `HELP_SITE_NAME` (Titel, Standard „smartlife BI Docs“), `HELP_ACCENT` (Akzentfarbe, Standard `#7c3aed`), `HELP_SUPPORT_URL` („Support kontaktieren“-Link, Standard = `APP_URL`). Für Doku-Updates: `git pull` im Docs-Repo, Build erneut ausführen — der Server liefert sofort die neue Site.

**Im All-in-One-Container** läuft der Help-Server automatisch mit (Port 3001 freigeben und das Docs-Repo einhängen, s. „Schnelltest“). Solange die Site noch nicht gebaut wurde, zeigt Port 3001 eine Hinweisseite mit dem Build-Befehl.

**Aufräumen:** Wer die Doku früher in die Wissensdatenbank importiert hat, entfernt diese importierten Artikel (manuell angelegte bleiben unberührt) mit:

```bash
npx tsx scripts/kb-remove-imported.ts --ja            # Standard-Produkt
npx tsx scripts/kb-remove-imported.ts smartlifebi --ja # bestimmtes Produkt
```

### Wissensdatenbank: Bold-BI-Doku importieren (Alternative zum Help-Portal)

Wer die Doku stattdessen (oder zusätzlich) **in** der Support-Wissensdatenbank haben will: Dieser Import bringt alle ~890 Artikel aus [boldbi/bold-bi-docs](https://github.com/boldbi/bold-bi-docs) in das Hilfe-Center — inkl. Bilder, Kategorien und umgeschriebener interner Links. Dabei wird durchgängig **„Bold BI" → „smartlife BI"** und **„Syncfusion" → „smartlife"** ersetzt (anpassbar über die Konstanten am Skriptanfang). Empfehlung: Doku ins Help-Portal (s. oben), KB für eigene Support-Artikel.

Voraussetzung für den lokalen Lauf: eingerichtete Entwicklungsumgebung (`npm install`, `.env` mit `DATABASE_URL`, laufende Datenbank — s. „Entwicklung starten“). Im All-in-One-Container geht es ohne all das mit einem `docker exec` (s. „Schnelltest“).

```bash
git clone --depth 1 https://github.com/boldbi/bold-bi-docs.git /tmp/bold-bi-docs
npx tsx scripts/import-boldbi-docs.ts /tmp/bold-bi-docs
# Mehrprodukt-Betrieb: Ziel-Produkt wählen (Standard: Default-Produkt)
npx tsx scripts/import-boldbi-docs.ts /tmp/bold-bi-docs --product smartlifebi
```

- Bilder (~300 MB) landen in `DATA_DIR/kb-assets` und werden über `/kb-assets/…` ausgeliefert (damit auch im Backup enthalten)
- **Links:** Interne Doku-Verweise und `help.boldbi.com`-Links werden **relativ** auf `/kb/<artikel>` umgeschrieben — sie zeigen damit automatisch auf die Domain, unter der das Hilfe-Center läuft (z. B. `support.smartlifebi.com/kb/…`), ohne dass eine Domain im Skript verdrahtet ist. `www.boldbi.com`/`syncfusion.com` → `www.smartlifebi.com`, `support.boldbi.com` → `/kb`. Nur `cdn.boldbi.com` bleibt (lauffähige SDK-Code-Beispiele).
- **Logo in Screenshots ersetzen** (nach jedem Import ausführen):
  ```bash
  pip install opencv-python-headless numpy pillow   # einmalig
  python3 scripts/replace-logo.py --logo scripts/assets/smartlife-logo.png
  ```
- Voraussetzung: Die Weiterverwendung der Dokumentation sollte durch Ihre OEM-/Reseller-Vereinbarung mit Syncfusion abgedeckt sein

**Doku-Update einspielen** (wenn Bold BI die Dokumentation aktualisiert) — der Import ist idempotent, einfach denselben Ablauf wiederholen:

```bash
cd /tmp/bold-bi-docs && git pull        # oder frisch klonen
cd /pfad/zur/installation
npx tsx scripts/import-boldbi-docs.ts /tmp/bold-bi-docs   # aktualisiert bestehende, legt neue an
python3 scripts/replace-logo.py --logo scripts/assets/smartlife-logo.png
```

Verhalten beim Update:
- Bestehende Artikel werden **aktualisiert** (gleicher Slug), neue angelegt — **Ausgeblendet-Status von Artikeln und Kategorien bleibt erhalten**
- Im Repo **entfernte** Artikel werden gemeldet; mit `--prune` werden sie gelöscht
- ⚠️ Manuelle Textänderungen an *importierten* Artikeln werden beim Update überschrieben — eigene Artikel (ohne Import-Herkunft) sind nie betroffen

### Azure AD B2C für das Kundenportal einrichten

1. Im B2C-Tenant eine **App-Registrierung** (Typ *Web*) anlegen; Redirect-URI: `https://<APP_URL>/portal/auth/b2c/callback`, Client-Secret erzeugen
2. Im **User-Flow** (z. B. `B2C_1_signin`) unter *Anwendungsansprüche* mindestens **Email Addresses** und **Display Name** aktivieren
3. In der `.env` setzen: `AZURE_B2C_TENANT`, `AZURE_B2C_POLICY`, `AZURE_B2C_CLIENT_ID`, `AZURE_B2C_CLIENT_SECRET` (Details in `.env.example`)

Beim ersten Login wird das B2C-Konto über seine Objekt-ID mit dem Support-Kontakt verknüpft; existiert bereits ein Kontakt mit derselben E-Mail (z. B. aus früheren E-Mail-Tickets), wird dieser übernommen — die Ticket-Historie bleibt erhalten. Zum lokalen Testen ohne echten Tenant: `npx tsx scripts/b2c-stub.ts` und `AZURE_B2C_AUTHORITY=http://localhost:4444` (s. Skript-Kommentar).

**Tests:** `npm test` (Unit-Tests für Threading/Sanitisierung/Auto-Reply-Erkennung) und `npx tsx scripts/smoke-ingest.ts` (End-to-End-Test der E-Mail-Pipeline gegen DB+Redis).

**Produktion:** `docker compose up -d --build` — startet Web, Worker, PostgreSQL und Redis; davor `.env` mit echten Secrets füllen. TLS/Reverse-Proxy (z. B. Caddy) je nach Server-Setup davorschalten.

## Schnelltest: alles in einem Container

Zum schnellen Ausprobieren gibt es ein All-in-One-Image (`Dockerfile.all-in-one`), das App, Worker, PostgreSQL 16 und Redis in **einem** Container bündelt — ohne `.env`, ohne Compose:

```bash
docker build -f Dockerfile.all-in-one -t smartlife-support:all-in-one .
docker run -d --name smartlife-support -p 3000:3000 -p 3001:3001 \
  -v smartlife-data:/data smartlife-support:all-in-one
```

Danach läuft alles auf http://localhost:3000 (Support-System) und http://localhost:3001 (Help-Portal, s. u.) — Login: `admin@smartlife.software` / `admin1234`. Beim ersten Start werden Datenbank, Schema und Grunddaten automatisch angelegt; ein `SESSION_SECRET` wird erzeugt und im Volume abgelegt. Alle Daten (Datenbank, Anhänge, Backups) liegen unter `/data` — mit dem Volume überleben sie Container-Neustarts und Image-Updates (`docker stop` fährt Postgres geordnet herunter). Optionale Einstellungen wie `SEED_ADMIN_*`, KI-Variablen oder `POSTGRES_PASSWORD` lassen sich per `-e` mitgeben, z. B.:

```bash
docker run -d --name smartlife-support -p 3000:3000 -p 3001:3001 -v smartlife-data:/data \
  -e SEED_ADMIN_EMAIL=office@smartlife.software -e SEED_ADMIN_PASSWORD=geheim \
  -e AI_BASE_URL=https://api.openai.com/v1 -e AI_API_KEY=sk-… -e AI_MODEL=gpt-4o \
  smartlife-support:all-in-one
```

**Help-Portal im Container bauen:** Das bold-bi-docs-Repo auf dem Host clonen, beim Start read-only einhängen und die Site im Container generieren (Ergebnis liegt im Volume unter `/data/help-site` und überlebt Neustarts):

```bash
git clone https://github.com/boldbi/bold-bi-docs.git
docker run -d --name smartlife-support -p 3000:3000 -p 3001:3001 \
  -v smartlife-data:/data \
  -v ./bold-bi-docs:/import/bold-bi-docs:ro \
  smartlife-support:all-in-one
docker exec smartlife-support bash docker/build-help.sh /import/bold-bi-docs
```

Danach ist die Doku auf http://localhost:3001 erreichbar. Für Doku-Updates später: `git pull` im bold-bi-docs-Ordner, dann denselben `docker exec`-Befehl erneut.

**Alternativ — Doku in die Wissensdatenbank importieren** (s. Abschnitt oben; Logo-Ersetzung in Screenshots läuft automatisch mit, Python/OpenCV ist im Image enthalten):

```bash
docker exec smartlife-support bash docker/import-kb.sh /import/bold-bi-docs
```

Früher importierte Doku-Artikel wieder aus der KB entfernen: `docker exec smartlife-support npx tsx scripts/kb-remove-imported.ts --ja`

Für den Dauerbetrieb ist weiterhin `docker-compose.yml` (getrennte Dienste, getrennte Volumes) die richtige Wahl.
