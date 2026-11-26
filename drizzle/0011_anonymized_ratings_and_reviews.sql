-- Migration 0011 — anonymized ratings and reviews
--
-- Reversible: the rollback drops the two `anonymized_at` columns and restores
-- the previous target constraints and the NOT NULL constraint of `user_id`.
-- Neither can be restored while an anonymized row exists — the rollback must
-- delete those rows first, and the ratings and reviews they hold are lost.

ALTER TABLE "ratings" DROP CONSTRAINT "ck_ratings_target";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "ck_reviews_target";--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ck_ratings_target" CHECK ((
        ("ratings"."drama_id" is not null and "ratings"."movie_id" is null) or
        ("ratings"."drama_id" is null and "ratings"."movie_id" is not null) or
        ("ratings"."drama_id" is null and "ratings"."movie_id" is null and "ratings"."anonymized_at" is not null)
      ));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_target" CHECK ((
        ("reviews"."drama_id" is not null and "reviews"."movie_id" is null) or
        ("reviews"."drama_id" is null and "reviews"."movie_id" is not null) or
        ("reviews"."drama_id" is null and "reviews"."movie_id" is null and "reviews"."anonymized_at" is not null)
      ));