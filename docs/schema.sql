-- SmartLife Support System — PostgreSQL-Schema (Referenz)
-- Maßgebliche Umsetzung erfolgt als Prisma-Migrationen; dieses Skript
-- dokumentiert das Zielschema inkl. P2/P3-Tabellen (markiert).

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- =====================================================================
-- Benutzer & Teams (MVP)
-- =====================================================================

CREATE TYPE user_role AS ENUM ('agent', 'team_lead', 'admin');

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL,
    name            text NOT NULL,
    role            user_role NOT NULL DEFAULT 'agent',
    password_hash   text,                 -- NULL bei SSO (Entra ID)
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE teams (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL UNIQUE,
    email_signature text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);

-- =====================================================================
-- Kunden (MVP)
-- =====================================================================

CREATE TABLE organizations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text NOT NULL,
    domains               text[] NOT NULL DEFAULT '{}',  -- Auto-Zuordnung per E-Mail-Domain
    notes                 text,
    portal_shared_tickets boolean NOT NULL DEFAULT false, -- P2: Kollegen sehen Tickets der Org
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                text NOT NULL,
    name                 text,
    phone                text,
    organization_id      uuid REFERENCES organizations(id) ON DELETE SET NULL,
    portal_password_hash text,            -- P2
    is_blocked           boolean NOT NULL DEFAULT false, -- Spam-Absender
    anonymized_at        timestamptz,     -- DSGVO-Anonymisierung
    custom_fields        jsonb NOT NULL DEFAULT '{}',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contacts_email_key ON contacts (lower(email));

-- =====================================================================
-- Postfächer (MVP)
-- =====================================================================

CREATE TABLE mailboxes (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL,           -- "Support", "Billing"
    address          text NOT NULL UNIQUE,    -- support@smartlife.software
    imap_host        text, imap_port int, imap_user text,
    smtp_host        text, smtp_port int, smtp_user text,
    credentials_ref  text NOT NULL,           -- Verweis auf Secret (ENV/Vault), kein Klartext
    default_team_id  uuid REFERENCES teams(id) ON DELETE SET NULL,
    last_seen_uid    bigint NOT NULL DEFAULT 0,
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Tickets (MVP)
-- =====================================================================

CREATE TYPE ticket_status   AS ENUM ('new', 'open', 'pending_customer', 'pending_internal', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE ticket_channel  AS ENUM ('email', 'portal', 'api', 'manual');

CREATE TABLE ticket_categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL UNIQUE,
    sort_order int NOT NULL DEFAULT 0,
    is_active  boolean NOT NULL DEFAULT true
);

CREATE SEQUENCE ticket_number_seq START 1000;

CREATE TABLE tickets (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number                bigint NOT NULL DEFAULT nextval('ticket_number_seq') UNIQUE,
    -- kurzer Zufalls-Token für Betreff-Threading: [#1000-a3f9c2d1]
    token                 text NOT NULL DEFAULT encode(gen_random_bytes(4), 'hex'),
    subject               text NOT NULL,
    status                ticket_status   NOT NULL DEFAULT 'new',
    priority              ticket_priority NOT NULL DEFAULT 'normal',
    channel               ticket_channel  NOT NULL,
    contact_id            uuid NOT NULL REFERENCES contacts(id),
    organization_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
    assignee_id           uuid REFERENCES users(id) ON DELETE SET NULL,
    team_id               uuid REFERENCES teams(id) ON DELETE SET NULL,
    mailbox_id            uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
    category_id           uuid REFERENCES ticket_categories(id) ON DELETE SET NULL,
    merged_into_id        uuid REFERENCES tickets(id) ON DELETE SET NULL, -- P2: Merge
    custom_fields         jsonb NOT NULL DEFAULT '{}',                    -- P2
    -- SLA (P3)
    sla_policy_id         uuid,            -- FK folgt unten (Tabelle P3)
    first_response_due_at timestamptz,
    resolution_due_at     timestamptz,
    sla_paused_at         timestamptz,
    -- Kennzahlen
    first_replied_at      timestamptz,
    resolved_at           timestamptz,
    closed_at             timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    search_vector         tsvector GENERATED ALWAYS AS (
                              to_tsvector('simple', coalesce(subject, ''))
                          ) STORED
);
CREATE INDEX tickets_inbox_idx    ON tickets (status, team_id, updated_at DESC);
CREATE INDEX tickets_assignee_idx ON tickets (assignee_id, status);
CREATE INDEX tickets_contact_idx  ON tickets (contact_id, created_at DESC);
CREATE INDEX tickets_search_idx   ON tickets USING gin (search_vector);
CREATE INDEX tickets_custom_idx   ON tickets USING gin (custom_fields);

-- =====================================================================
-- Nachrichten & Anhänge (MVP)
-- =====================================================================

CREATE TYPE message_type AS ENUM ('customer', 'agent_reply', 'internal_note', 'system');
CREATE TYPE send_status  AS ENUM ('none', 'pending', 'sent', 'failed');

CREATE TABLE messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    type             message_type NOT NULL,
    user_id          uuid REFERENCES users(id)    ON DELETE SET NULL, -- Agent
    contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL, -- Kunde
    body_html        text,           -- sanitisiert
    body_text        text NOT NULL,
    -- E-Mail-Metadaten
    email_message_id text,           -- Message-ID (ein- UND ausgehend), Threading + Idempotenz
    in_reply_to      text,
    email_from       text,
    email_to         text[],
    email_cc         text[],
    raw_eml_key      text,           -- S3-Key des Originals (90 Tage)
    send_status      send_status NOT NULL DEFAULT 'none',
    send_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    search_vector    tsvector GENERATED ALWAYS AS (
                         to_tsvector('simple', coalesce(body_text, ''))
                     ) STORED,
    CHECK (num_nonnulls(user_id, contact_id) <= 1)
);
CREATE UNIQUE INDEX messages_email_mid_key ON messages (email_message_id) WHERE email_message_id IS NOT NULL;
CREATE INDEX messages_ticket_idx ON messages (ticket_id, created_at);
CREATE INDEX messages_search_idx ON messages USING gin (search_vector);

CREATE TABLE attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name    text NOT NULL,
    content_type text NOT NULL,
    size_bytes   bigint NOT NULL,
    storage_key  text NOT NULL,      -- S3
    is_inline    boolean NOT NULL DEFAULT false,
    content_id   text                -- für Inline-Bilder (cid:)
);

-- =====================================================================
-- Tags, Audit, Textbausteine (MVP)
-- =====================================================================

CREATE TABLE tags (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name  text NOT NULL UNIQUE,
    color text
);

CREATE TABLE ticket_tags (
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tag_id    uuid NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    PRIMARY KEY (ticket_id, tag_id)
);

CREATE TABLE ticket_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id        uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    event_type       text NOT NULL,   -- created | status_changed | assigned | priority_changed | ...
    actor_user_id    uuid REFERENCES users(id)    ON DELETE SET NULL,
    actor_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    payload          jsonb NOT NULL DEFAULT '{}', -- { "from": "...", "to": "..." }
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, created_at);

CREATE TABLE canned_responses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title      text NOT NULL,
    body       text NOT NULL,        -- Platzhalter: {{ticket.number}}, {{contact.first_name}}, ...
    team_id    uuid REFERENCES teams(id) ON DELETE CASCADE, -- NULL = global
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- P2: Ansichten, Custom Fields, Wissensdatenbank
-- =====================================================================

CREATE TABLE saved_views (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name     text NOT NULL,
    user_id  uuid REFERENCES users(id) ON DELETE CASCADE, -- NULL = teamweit
    team_id  uuid REFERENCES teams(id) ON DELETE CASCADE,
    filter   jsonb NOT NULL,
    position int NOT NULL DEFAULT 0
);

CREATE TABLE custom_field_definitions (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity   text NOT NULL CHECK (entity IN ('ticket', 'contact', 'organization')),
    key      text NOT NULL,
    label    text NOT NULL,
    type     text NOT NULL CHECK (type IN ('text', 'number', 'select', 'multiselect', 'date', 'boolean')),
    options  jsonb,                  -- für select/multiselect
    required boolean NOT NULL DEFAULT false,
    UNIQUE (entity, key)
);

CREATE TABLE kb_categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  uuid REFERENCES kb_categories(id) ON DELETE CASCADE,
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE kb_articles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id   uuid REFERENCES kb_categories(id) ON DELETE SET NULL,
    title         text NOT NULL,
    slug          text NOT NULL UNIQUE,
    body_markdown text NOT NULL,
    status        text NOT NULL DEFAULT 'draft'  CHECK (status IN ('draft', 'published', 'archived')),
    visibility    text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'customers', 'internal')),
    author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    published_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
                      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_markdown, ''))
                  ) STORED
);
CREATE INDEX kb_articles_search_idx ON kb_articles USING gin (search_vector);

-- =====================================================================
-- P3: SLA, Automatisierung, CSAT, Webhooks
-- =====================================================================

CREATE TABLE business_hours (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name     text NOT NULL,
    timezone text NOT NULL DEFAULT 'Europe/Vienna',
    schedule jsonb NOT NULL,   -- { "mon": [["09:00","17:00"]], ... }
    holidays date[] NOT NULL DEFAULT '{}'
);

CREATE TABLE sla_policies (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL,
    conditions        jsonb NOT NULL DEFAULT '{}', -- { "priority": ["urgent"], "organization_ids": [...] }
    targets           jsonb NOT NULL,              -- { "urgent": {"first_response_min":60,"resolution_min":480}, ... }
    business_hours_id uuid REFERENCES business_hours(id),
    position          int NOT NULL DEFAULT 0,      -- erste passende Policy gewinnt
    is_active         boolean NOT NULL DEFAULT true
);
ALTER TABLE tickets
    ADD CONSTRAINT tickets_sla_policy_fkey
    FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(id) ON DELETE SET NULL;

CREATE TABLE sla_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    target     text NOT NULL CHECK (target IN ('first_response', 'resolution')),
    outcome    text NOT NULL CHECK (outcome IN ('met', 'breached')),
    due_at     timestamptz NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE automation_rules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    trigger    text NOT NULL CHECK (trigger IN ('ticket_created', 'ticket_updated', 'time_based')),
    conditions jsonb NOT NULL DEFAULT '[]',
    actions    jsonb NOT NULL DEFAULT '[]',
    position   int NOT NULL DEFAULT 0,
    is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE csat_surveys (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    token      text NOT NULL UNIQUE,
    rating     int CHECK (rating BETWEEN 1 AND 5),
    comment    text,
    sent_at    timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz
);

CREATE TABLE webhooks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url           text NOT NULL,
    events        text[] NOT NULL,   -- { "ticket.created", "ticket.resolved", ... }
    secret        text NOT NULL,     -- HMAC-Signatur der Payload
    is_active     boolean NOT NULL DEFAULT true,
    failure_count int NOT NULL DEFAULT 0
);
