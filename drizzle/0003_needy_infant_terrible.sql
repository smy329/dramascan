-- Migration 0003 — active-user listing index
--
-- Reversible: the rollback drops the index. No row is rewritten.

CREATE INDEX "idx_users_active_created_at" ON "users" USING btree ("created_at" DESC NULLS LAST) WHERE "users"."deleted_at" is null;