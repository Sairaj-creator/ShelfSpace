-- Add generated search_vector column and GIN index
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('english', coalesce("name", '') || ' ' || coalesce("sku", ''))
) STORED;

CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");