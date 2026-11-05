CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY,
	"user_id" integer,
	"place_id" integer NOT NULL,
	"kind" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"time_slot" text,
	"guests" integer NOT NULL,
	"rooms" integer DEFAULT 1 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_kind_check" CHECK ("kind" IN ('hotel','restaurant'))
);
--> statement-breakpoint
CREATE TABLE "challenge_progress" (
	"user_id" integer PRIMARY KEY,
	"trails_done" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" integer,
	"user_id" integer,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_pkey" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups_" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"trail_id" integer NOT NULL,
	"host_id" integer NOT NULL,
	"starts_at" text NOT NULL,
	"meeting_point" text NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "groups_capacity_check" CHECK ("capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "hikes" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"trail_id" integer,
	"name" text NOT NULL,
	"distance_km" double precision NOT NULL,
	"elevation_m" integer NOT NULL,
	"duration_s" integer NOT NULL,
	"completed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" serial PRIMARY KEY,
	"trail_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"distance_km" double precision NOT NULL,
	"rating" double precision NOT NULL,
	"reviews" integer NOT NULL,
	"price" integer,
	"amenities" text DEFAULT '' NOT NULL,
	"rooms_total" integer DEFAULT 0 NOT NULL,
	"image" text,
	"cuisine" text,
	"price_level" text,
	"slots" text DEFAULT '' NOT NULL,
	"hours" text,
	"notes" text,
	CONSTRAINT "places_kind_check" CHECK ("kind" IN ('hotel','restaurant','church'))
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" integer,
	"user_id" integer,
	CONSTRAINT "post_likes_pkey" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY,
	"user_id" integer NOT NULL,
	"group_id" integer,
	"body" text NOT NULL,
	"image" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_hits" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reset_tokens" (
	"token_hash" text PRIMARY KEY,
	"user_id" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_trails" (
	"user_id" integer,
	"trail_id" integer,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_trails_pkey" PRIMARY KEY("user_id","trail_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"user_id" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trails" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"difficulty" text NOT NULL,
	"distance_km" double precision NOT NULL,
	"elevation_m" integer NOT NULL,
	"duration_h" double precision NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"featured" integer DEFAULT 0 NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"image" text,
	"weather" text DEFAULT '{}' NOT NULL,
	"weather_updated" bigint DEFAULT 0 NOT NULL,
	"owner_id" integer,
	"shared" integer DEFAULT 1 NOT NULL,
	"is_new" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trails_difficulty_check" CHECK ("difficulty" IN ('Easy','Moderate','Hard'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"surname" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"handle" text NOT NULL UNIQUE,
	"pass_salt" text,
	"pass_hash" text,
	"bio" text DEFAULT '' NOT NULL,
	"avatar" text,
	"level" integer DEFAULT 1 NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_bookings_place" ON "bookings" ("place_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_messages_group" ON "messages" ("group_id","id");--> statement-breakpoint
CREATE INDEX "idx_places_trail" ON "places" ("trail_id","kind");--> statement-breakpoint
CREATE INDEX "idx_rate_hits_key" ON "rate_hits" ("key","at");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" ("user_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_place_id_places_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups__id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups_"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups_" ADD CONSTRAINT "groups__trail_id_trails_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "groups_" ADD CONSTRAINT "groups__host_id_users_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "hikes" ADD CONSTRAINT "hikes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hikes" ADD CONSTRAINT "hikes_trail_id_trails_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups__id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups_"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_trail_id_trails_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_groups__id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups_"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reset_tokens" ADD CONSTRAINT "reset_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_trails" ADD CONSTRAINT "saved_trails_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "saved_trails" ADD CONSTRAINT "saved_trails_trail_id_trails_id_fkey" FOREIGN KEY ("trail_id") REFERENCES "trails"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trails" ADD CONSTRAINT "trails_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL;