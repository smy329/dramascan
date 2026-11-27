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