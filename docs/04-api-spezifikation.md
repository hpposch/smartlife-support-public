# 04 — API-Spezifikation (REST, v1)

Eine API für drei Konsumenten: **Agenten-UI**, **Kundenportal** und **externe Integrationen** (SmartLife-Produkte, Skripte). Basis-URL: `/api/v1`.

## 1. Authentifizierung & Autorisierung

| Konsument | Verfahren | Kontext |
|---|---|---|
| Agenten-UI | Session-Cookie (Auth.js; Passwort oder Entra-ID-SSO) | `user` mit Rolle |
| Kundenportal | Separates Session-Cookie (Passwort/Magic-Link) | `contact` |
| Integrationen | `Authorization: Bearer <api_key>` (pro Key: Scopes, z. B. `tickets:write`) | Service |

Grundsätze:

- Jede Route deklariert, welche Kontexte zugelassen sind; Portal-Routen filtern **serverseitig** immer auf den eingeloggten Contact (bzw. dessen Organisation, wenn `portal_shared_tickets` aktiv).
- Fehlerformat einheitlich: `{ "error": { "code": "not_found", "message": "..." } }` mit passendem HTTP-Status.
- Listen: Cursor-Pagination (`?cursor=...&limit=50`), Antwort `{ "data": [...], "next_cursor": "..." }`.
- Schreiben: Validierung mit Zod, `422` mit Feldfehlern.
- Rate-Limiting: Portal & API-Keys via Redis (z. B. 60 req/min), Agenten-UI großzügiger.

## 2. Endpunkte — Agenten-Kontext (MVP)

### Tickets

```
GET    /tickets                 Liste; Filter: status, priority, assignee_id, team_id,
                                tag, category_id, contact_id, organization_id, mailbox_id,
                                q (Volltext), sort (updated_at|created_at|priority)
POST   /tickets                 Manuell anlegen { subject, contact_id|contact_email, body, ... }
GET    /tickets/:id             Detail inkl. Contact, Zuweisung, Tags, SLA-Status
PATCH  /tickets/:id             Status, Priorität, Kategorie, assignee_id, team_id, custom_fields
POST   /tickets/:id/tags        { tag: "billing" }        DELETE /tickets/:id/tags/:tag
POST   /tickets/:id/merge      (P2) { source_ticket_ids: [...] }
GET    /tickets/:id/events      Audit-Verlauf
```

### Konversation

```
GET    /tickets/:id/messages    Verlauf (Nachrichten + interne Notizen)
POST   /tickets/:id/messages    { type: "agent_reply" | "internal_note",
                                  body_html, attachment_ids: [...] }
                                → agent_reply stößt E-Mail-Versand-Job an
POST   /attachments             Multipart-Upload → { id, storage_key } (vor dem Senden)
GET    /attachments/:id/url     Kurzlebige signierte Download-URL
```

Statuslogik serverseitig: `agent_reply` setzt Status automatisch auf `pending_customer` (überschreibbar per `set_status` im Body); eingehende Kundenantwort setzt `open`.

### Stammdaten & Produktivität

```
GET/POST/PATCH /contacts, /organizations
GET/POST/PATCH/DELETE /canned-responses     (Platzhalter werden clientseitig aufgelöst per
GET    /tickets/:id/render-template?id=...   serverseitigem Render-Endpunkt)
GET    /users, /teams                        (Verwaltung: nur admin)
GET/POST/PATCH /mailboxes                    (nur admin; Credentials nur schreibbar, nie lesbar)
GET/POST /ticket-categories, /tags
```

## 3. Endpunkte — Portal-Kontext (P2)

```
POST   /portal/auth/login | /portal/auth/magic-link
GET    /portal/tickets              nur eigene (bzw. Organisations-)Tickets
POST   /portal/tickets              { subject, body, category_id?, attachments }
GET    /portal/tickets/:id          nur öffentliche Nachrichten (type != internal_note/system)
POST   /portal/tickets/:id/messages Kundenantwort → Ticket auf "open"
POST   /portal/tickets/:id/close
GET    /portal/kb/categories, /portal/kb/articles?q=...   nur visibility public/customers
```

## 4. Endpunkte — Integrations-Kontext (API-Key)

```
POST   /tickets                 wie Agenten-Route, channel = "api"
GET    /tickets?external_ref=   Abfrage per eigener Referenz
POST   /webhooks (P3)           Verwaltung ausgehender Webhooks
```

**Ausgehende Webhooks (P3):** `POST` an konfigurierte URL mit Body `{ event, ticket, timestamp }` und Header `X-Signature: hmac-sha256(secret, body)`; Retry 3× mit Backoff, Deaktivierung nach 20 Fehlversuchen in Folge.

## 5. Reporting (P2/P3)

```
GET /reports/overview?from=&to=       Kernzahlen (erstellt, gelöst, offen, ø Erstreaktion)
GET /reports/tickets-over-time?bucket=day|week
GET /reports/agents?from=&to=         gelöste Tickets, ø Antwortzeit je Agent
GET /reports/sla?from=&to=      (P3)  met/breached je Ziel und Priorität
GET /reports/csat?from=&to=     (P3)
Alle mit &format=csv für Export.
```

## 6. Realtime-Updates (P2)

Server-Sent Events für das Agenten-UI: `GET /events/stream` → `ticket.updated`, `message.created`, `presence` (Kollisionserkennung: "X tippt in Ticket Y"). SSE statt WebSocket, weil nur Server→Client benötigt wird und es hinter jedem Proxy trivial läuft. MVP kommt ohne aus (Polling der Ticketliste alle 30 s).
