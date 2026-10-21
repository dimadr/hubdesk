-- Apply only after the administrator has resolved the reported duplicate names.
-- This procedure never merges, renames or deletes existing products/transactions.
BEGIN;
LOCK TABLE insert_products IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM insert_products GROUP BY lower(btrim(name)) HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate normalized product names remain; administrator decision required';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'uq_insert_products_name_normalized'
          AND i.indrelid = 'insert_products'::regclass
          AND (NOT i.indisunique OR NOT i.indisvalid OR i.indpred IS NOT NULL
               OR i.indnkeyatts <> 1
               OR pg_get_expr(i.indexprs, i.indrelid) IS DISTINCT FROM 'lower(btrim((name)::text))')
    ) THEN
        RAISE EXCEPTION 'Existing product-name index must be inspected before replacement';
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_insert_products_name_normalized
    ON insert_products (lower(btrim(name)));
COMMIT;
