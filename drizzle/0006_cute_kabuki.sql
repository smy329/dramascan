ALTER TABLE "ratings" ALTER COLUMN "drama_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "drama_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "movies" ADD COLUMN "converted_from_drama_id" uuid;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "movie_id" uuid;--> statement-breakpoint
ALTER TABLE "movies" ADD CONSTRAINT "fk_movies_converted_from_drama_id" FOREIGN KEY ("converted_from_drama_id") REFERENCES "public"."dramas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_movies_converted_from_drama_id" ON "movies" USING btree ("converted_from_drama_id") WHERE "movies"."converted_from_drama_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ratings_user_id_drama_id_active" ON "ratings" USING btree ("user_id","drama_id") WHERE "ratings"."deleted_at" is null and "ratings"."drama_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ratings_user_id_movie_id_active" ON "ratings" USING btree ("user_id","movie_id") WHERE "ratings"."deleted_at" is null and "ratings"."movie_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_ratings_drama_id" ON "ratings" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_ratings_movie_id" ON "ratings" USING btree ("movie_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reviews_user_id_drama_id" ON "reviews" USING btree ("user_id","drama_id") WHERE "reviews"."drama_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reviews_user_id_movie_id" ON "reviews" USING btree ("user_id","movie_id") WHERE "reviews"."movie_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_reviews_drama_id" ON "reviews" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_movie_id" ON "reviews" USING btree ("movie_id");--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ck_ratings_target" CHECK (("ratings"."drama_id" is not null and "ratings"."movie_id" is null) or ("ratings"."drama_id" is null and "ratings"."movie_id" is not null));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "ck_reviews_target" CHECK (("reviews"."drama_id" is not null and "reviews"."movie_id" is null) or ("reviews"."drama_id" is null and "reviews"."movie_id" is not null));--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "fk_ratings_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "fk_ratings_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "fk_reviews_drama_id" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "fk_reviews_movie_id" FOREIGN KEY ("movie_id") REFERENCES "public"."movies"("id") ON DELETE no action ON UPDATE no action;
