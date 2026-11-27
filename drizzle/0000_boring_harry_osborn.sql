CREATE TABLE "analytics_daily_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" text NOT NULL,
	"content_id" uuid,
	"content_type" text,
	"unique_visitors" integer DEFAULT 0,
	"total_views" integer DEFAULT 0,
	"total_playback_events" integer DEFAULT 0,
	"completion_events" integer DEFAULT 0,
	"total_watch_duration_seconds" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_view_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"guest_session_id" uuid,
	"content_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_hour_bucket" text
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" text NOT NULL,
	"user_id" uuid,
	"ip_hash" text,
	"user_agent" text,
	"country_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playback_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"guest_session_id" uuid,
	"content_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"event_type" text NOT NULL,
	"position_seconds" integer,
	"watch_duration_seconds" integer,
	"completion_threshold_met" boolean DEFAULT false,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_hour_bucket" text
);
--> statement-breakpoint
CREATE TABLE "search_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"guest_session_id" uuid,
	"user_id" uuid,
	"query_text" text NOT NULL,
	"result_count" integer DEFAULT 0,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_hour_bucket" text
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_accounts_provider_id_account_id" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sessions_token" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'viewer',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_users_email" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"role_id" uuid NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_permissions_role_id_resource_action" UNIQUE("role_id","resource","action"),
	CONSTRAINT "ck_permissions_permission_key" CHECK (("permissions"."resource" || '.' || "permissions"."action") in ('drama.create', 'drama.read', 'drama.update', 'drama.delete', 'drama.manage', 'movie.create', 'movie.read', 'movie.update', 'movie.delete', 'movie.manage', 'episode.create', 'episode.read', 'episode.update', 'episode.delete', 'episode.manage', 'category.create', 'category.read', 'category.update', 'category.delete', 'category.manage', 'platform.create', 'platform.read', 'platform.update', 'platform.delete', 'platform.manage', 'user.read', 'user.manage', 'review.create', 'review.read', 'review.delete', 'review.manage', 'rating.read', 'rating.manage', 'analytics.read', 'analytics.manage', 'settings.read', 'settings.manage', 'admin.manage'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_roles_name" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_roles" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"visibility" text,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_type" text,
	"content_id" uuid NOT NULL,
	"asset_type" text,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_seo" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_type" text,
	"content_id" uuid NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"content_type" text,
	"content_id" uuid NOT NULL,
	"old_slug" text NOT NULL,
	"new_slug" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drama_categories" (
	"drama_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "pk_drama_categories" PRIMARY KEY("drama_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "drama_platforms" (
	"drama_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	CONSTRAINT "pk_drama_platforms" PRIMARY KEY("drama_id","platform_id")
);
--> statement-breakpoint
CREATE TABLE "dramas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"poster" text,
	"banner" text,
	"status" text,
	"publication_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"drama_id" uuid NOT NULL,
	"season_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"episode_number" integer,
	"position" integer,
	"publication_status" text,
	"video_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "information_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"publication_status" text,
	"preview" text,
	"footer_visible" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "movie_categories" (
	"movie_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "pk_movie_categories" PRIMARY KEY("movie_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "movie_platforms" (
	"movie_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	CONSTRAINT "pk_movie_platforms" PRIMARY KEY("movie_id","platform_id")
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"poster" text,
	"banner" text,
	"publication_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"drama_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer,
	"publication_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "similar_dramas" (
	"drama_id" uuid NOT NULL,
	"similar_drama_id" uuid NOT NULL,
	"position" integer,
	CONSTRAINT "pk_similar_dramas" PRIMARY KEY("drama_id","similar_drama_id")
);
--> statement-breakpoint
CREATE TABLE "sitemap_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"path" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"audience" text DEFAULT 'all',
	"content_id" uuid,
	"content_type" text,
	"is_resolved" boolean DEFAULT false,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid NOT NULL,
	"publication_status" text DEFAULT 'draft',
	"expires_at" timestamp with time zone,
	"trigger_event_types" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"success" boolean DEFAULT false,
	"error_message" text,
	"delivered_at" timestamp with time zone,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"new_episode" boolean DEFAULT true,
	"new_drama_season" boolean DEFAULT true,
	"website_announcement" boolean DEFAULT true,
	"account_security" boolean DEFAULT true,
	"global_in_app" boolean DEFAULT true,
	"global_push" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"event_type" text NOT NULL,
	"content_id" uuid,
	"content_type" text,
	"link" text,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp with time zone,
	"delivered" boolean DEFAULT false,
	"delivery_timestamp" timestamp with time zone,
	"priority" text DEFAULT 'normal',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text,
	"auth" text,
	"browser" text,
	"user_agent" text,
	"position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"drama_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_reactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"drama_id" uuid NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text DEFAULT 'drama' NOT NULL,
	"content_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playback_progress" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text DEFAULT 'drama' NOT NULL,
	"content_id" uuid NOT NULL,
	"episode_id" uuid,
	"position" integer,
	"duration" integer,
	"last_watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "watch_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text DEFAULT 'drama' NOT NULL,
	"content_id" uuid NOT NULL,
	"episode_id" uuid,
	"watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"watch_duration" integer,
	"session_id" text
);
--> statement-breakpoint
CREATE TABLE "watched_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"content_type" text DEFAULT 'drama' NOT NULL,
	"content_id" uuid NOT NULL,
	"episode_id" uuid,
	"watched_minutes" integer DEFAULT 0,
	"threshold_met" boolean DEFAULT false,
	"last_watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_at_reset_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "fk_permissions_role_id" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_role_id" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_user_id" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_verifications_identifier" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_user_roles_role_id" ON "user_roles" USING btree ("role_id");