# 01 — Anforderungen & Funktionsumfang

Dieses Dokument beschreibt, was das Support-System können muss. Als Referenz dient der Funktionsumfang von BoldDesk; jede Funktion ist einer Ausbaustufe zugeordnet (**MVP**, **P2**, **P3**, **P4** — siehe [Roadmap](05-roadmap.md)).

## 1. Rollen

| Rolle | Beschreibung |
|---|---|
| **Kunde (Contact)** | Erstellt Anfragen per E-Mail oder Portal, sieht nur eigene Tickets |
| **Agent** | Bearbeitet Tickets, antwortet Kunden, schreibt interne Notizen |
| **Teamleiter** | Zusätzlich: Zuweisung, SLA-Überwachung, Reports des eigenen Teams |
| **Admin** | Systemkonfiguration: Postfächer, Regeln, SLA-Richtlinien, Benutzer, Textbausteine |

## 2. Ticketing (Kern) — MVP

- **Ticket-Erstellung** aus eingehender E-Mail (automatisch) und über das Agenten-UI (manuell, z. B. nach Telefonat)
- **Ticket-Eigenschaften:** fortlaufende Nummer, Betreff, Status, Priorität, Kategorie, zugewiesener Agent, Team, Tags, Kunde (Contact) und Organisation
- **Status-Workflow:** `Neu → Offen → Wartet auf Kunde → Wartet intern → Gelöst → Geschlossen` (konfigurierbar, P3)
- **Prioritäten:** Niedrig, Normal, Hoch, Dringend
- **Konversationsverlauf:** chronologisch, mit Unterscheidung **öffentliche Antwort** (geht per E-Mail an den Kunden) vs. **interne Notiz** (nur für Agenten sichtbar)
- **E-Mail-Threading:** Antworten des Kunden auf die Benachrichtigungs-Mail landen im richtigen Ticket (via `Message-ID`/`References`-Header + Ticket-Token im Betreff als Fallback)
- **Anhänge** an Nachrichten (Upload im UI, Übernahme aus E-Mails), Größen-/Typ-Limits konfigurierbar
- **Zuweisung** an Agent und/oder Team; unzugewiesene Tickets in gemeinsamer Eingangsansicht
- **Ticket-Listen/Ansichten:** filterbar nach Status, Priorität, Agent, Team, Tag, Kunde; gespeicherte Ansichten (P2)
- **Volltextsuche** über Betreff, Nachrichten, Kundenname (MVP: einfache Suche; P3: Postgres-Volltext)
- **Kollisionserkennung** ("Agent X tippt gerade in diesem Ticket") — P2
- **Ticket-Aktionen:** zusammenführen (Merge), aufteilen (Split), weiterleiten — P2

## 3. Multichannel-Eingang

| Kanal | Stufe | Beschreibung |
|---|---|---|
| E-Mail (IMAP-Abruf oder Weiterleitung an Inbound-Webhook) | **MVP** | Mehrere Support-Postfächer (z. B. support@, billing@), jedes Postfach kann Standard-Team/Kategorie setzen |
| Kundenportal / Web-Formular | **P2** | Anfrage-Formular mit Pflichtfeldern, ggf. produktspezifische Custom Fields |
| REST-API | **MVP** (Basis) | Tickets programmatisch erstellen — Grundlage für Integrationen aus SmartLife-Produkten |
| Live-Chat / WhatsApp | **P4** | Optional, erst bei Bedarf |

## 4. Kundenportal — P2

- Login für Kunden (E-Mail + Passwort oder Magic-Link)
- Eigene Tickets einsehen, beantworten, schließen; Ticket-Historie der eigenen Organisation (optional, pro Organisation aktivierbar)
- Neues Ticket per Formular erstellen
- Zugang zur öffentlichen Wissensdatenbank inkl. Suche
- Branding: Logo, Farben, eigene Domain (z. B. `support.smartlife.software`)

## 5. Wissensdatenbank — P2

- Artikel mit Rich-Text/Markdown, Bildern, Anhängen
- Kategorien/Ordner-Hierarchie, Sortierung
- Sichtbarkeit: öffentlich / nur eingeloggte Kunden / nur intern (Agenten)
- Entwurf → Veröffentlicht-Workflow, Autor + Änderungsdatum
- Volltextsuche; Artikel-Vorschläge beim Ticket-Erstellen ("Das könnte helfen") — P3
- Feedback pro Artikel ("War das hilfreich?") — P3

## 6. SLA-Management — P3

- SLA-Richtlinien mit Bedingungen (Priorität, Organisation, Kategorie) und Zielen:
  - **Erste Reaktion** (z. B. Dringend: 1 h, Normal: 8 h)
  - **Lösung** (z. B. Dringend: 8 h, Normal: 3 Werktage)
- **Geschäftszeiten-Kalender** (Werktage, Feiertage) — SLA-Uhren laufen nur innerhalb der Geschäftszeiten
- Pausieren der SLA-Uhr bei Status "Wartet auf Kunde"
- Eskalationen bei (drohender) Verletzung: Benachrichtigung, Prioritätserhöhung, Umverteilung
- SLA-Status sichtbar in Ticketliste und Ticketdetail (Restzeit-Anzeige)

## 7. Automatisierung & Produktivität

| Funktion | Stufe | Beschreibung |
|---|---|---|
| **Textbausteine (Canned Responses)** | **MVP** | Vordefinierte Antworten mit Platzhaltern (`{{ticket.number}}`, `{{contact.first_name}}`) |
| **E-Mail-Benachrichtigungen** | **MVP** | An Kunde (Ticket erstellt, Antwort erhalten) und Agent (zugewiesen, Kundenantwort) |
| **Erstellungsregeln** | P3 | Bei Ticketeingang: Bedingungen prüfen → Kategorie/Priorität/Team setzen, Tags vergeben, Auto-Antwort senden |
| **Zeitgesteuerte Regeln** | P3 | z. B. "Gelöst + 5 Tage ohne Antwort → automatisch schließen", Erinnerungen |
| **Round-Robin-/Lastverteilungs-Zuweisung** | P3 | Automatische Verteilung neuer Tickets im Team |
| **Makros** | P3 | Mehrere Aktionen mit einem Klick (Antwort + Status + Tag) |
| **Zufriedenheitsumfrage (CSAT)** | P3 | Bewertungslink in der Lösungs-Mail, Auswertung im Reporting |

## 8. Reporting — P3 (Basis-Dashboard bereits P2)

- Dashboard: offene Tickets, heute eingegangen/gelöst, durchschnittliche Erstreaktionszeit, SLA-Verletzungen
- Berichte: Ticketaufkommen über Zeit, nach Kategorie/Kanal/Organisation, Agenten-Leistung, CSAT
- Export als CSV

## 9. KI-Unterstützung — P4

- **Antwortentwurf:** Vorschlag auf Basis von Ticketverlauf + Wissensdatenbank (Claude API)
- **Zusammenfassung** langer Ticketverläufe auf Knopfdruck
- **Auto-Kategorisierung & Prioritätsvorschlag** bei Eingang
- **Stimmungs-Erkennung** (verärgerter Kunde → Kennzeichnung)

## 10. Administration & Querschnitt

- **Benutzer- & Teamverwaltung**, Rollen/Rechte (MVP: die 4 Rollen aus Abschnitt 1; feingranular P3)
- **Custom Fields** für Tickets/Kontakte/Organisationen (P2) — wichtig für Produktbezug (z. B. Seriennummer, Produktversion)
- **Audit-Log** aller Ticket-Änderungen (MVP: Statuswechsel/Zuweisung; vollständig P2)
- **Mehrsprachigkeit** der Oberflächen: Deutsch zuerst, Englisch P2
- **Webhooks** für ausgehende Ereignisse (Ticket erstellt/gelöst) — P3

## 11. Nicht-funktionale Anforderungen

| Anforderung | Ziel |
|---|---|
| **DSGVO** | Hosting in EU, Löschkonzept (Kunde + Tickets anonymisierbar), AV-fähig, Datenexport |
| **Sicherheit** | Verschlüsselte Verbindungen, gehashte Passwörter (argon2), Rollenprüfung serverseitig, Rate-Limiting am Portal |
| **Performance** | Ticketliste < 500 ms bei 100 000 Tickets; E-Mail-Eingang → Ticket sichtbar < 60 s |
| **Verfügbarkeit** | Single-Node ausreichend (interner Betrieb); tägliche Backups (DB + Anhänge), getestete Wiederherstellung |
| **Skalierung** | Ausgelegt auf ~5–20 Agenten, ~50–500 Tickets/Woche; Architektur erlaubt horizontales Wachstum |
| **Mandanten** | Ein Mandant (SmartLife). Keine Multi-Tenancy — vereinfacht Datenmodell und Betrieb erheblich |
