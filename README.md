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

## Nächste Schritte

1. Review dieses Designs (insb. Stack-Entscheidung in Dokument 02 und MVP-Zuschnitt in Dokument 05)
2. Freigabe → Start der Implementierung von Phase 1 (E-Mail-Ticketing + Agenten-Oberfläche)
