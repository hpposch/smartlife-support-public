-- Volltextsuche für die Wissensdatenbank: generierte tsvector-Spalte
-- (deutsch + englisch gemischt — die importierte Doku ist englisch,
-- Kunden suchen häufig deutsch) mit GIN-Index.
ALTER TABLE "kb_articles" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('german',  coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('german',  left(coalesce("body_markdown", ''), 200000)), 'B') ||
    setweight(to_tsvector('english', left(coalesce("body_markdown", ''), 200000)), 'B')
  ) STORED;

CREATE INDEX "kb_articles_search_tsv_idx" ON "kb_articles" USING GIN ("search_tsv");

-- Optionale semantische Suche (nur mit OpenAI-kompatiblem Provider):
-- normalisierter Float32-Vektor + Zeitstempel für Re-Indexierung
ALTER TABLE "kb_articles" ADD COLUMN "embedding" BYTEA;
ALTER TABLE "kb_articles" ADD COLUMN "embedded_at" TIMESTAMP(3);
