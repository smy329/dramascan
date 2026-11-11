ALTER TABLE "information_pages" ADD COLUMN "position" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_information_pages_slug_active" ON "information_pages" USING btree ("slug") WHERE "information_pages"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_information_pages_footer" ON "information_pages" USING btree ("position") WHERE "information_pages"."deleted_at" is null and "information_pages"."publication_status" = 'published' and "information_pages"."footer_visible" = true;--> statement-breakpoint
INSERT INTO "information_pages" ("title", "slug", "content", "publication_status", "footer_visible", "position") VALUES
	('Terms of Service', 'terms', 'This page is being prepared.', 'published', true, 1),
	('Privacy Policy', 'privacy', 'This page is being prepared.', 'published', true, 2),
	('Community Guidelines', 'community-guidelines', 'This page is being prepared.', 'published', true, 3),
	('Copyright / DMCA', 'copyright-dmca', 'This page is being prepared.', 'published', true, 4),
	('About', 'about', 'This page is being prepared.', 'published', true, 5),
	('Contact', 'contact', 'This page is being prepared.', 'published', true, 6)
ON CONFLICT ("slug") WHERE "deleted_at" IS NULL DO NOTHING;