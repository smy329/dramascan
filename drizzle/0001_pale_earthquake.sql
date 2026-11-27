CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"ip_address" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_login_attempts_user_id" ON "login_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_login_attempts_created_at" ON "login_attempts" USING btree ("created_at");