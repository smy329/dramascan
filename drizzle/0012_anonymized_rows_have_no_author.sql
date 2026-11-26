-- Migration 0012 — an anonymized row has no author
--
-- Reversible: the rollback drops the two constraints. No row is rewritten.

ALTER TABLE "ratings" ADD CONSTRAINT "ck_ratings_anonymized_author" CHECK ("ratings"."anonymized_at" is null or "ratings"."user_id" is null);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_anonymized_author" CHECK ("reviews"."anonymized_at" is null or "reviews"."user_id" is null);