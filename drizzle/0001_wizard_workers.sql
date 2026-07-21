CREATE TABLE "activity_workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" integer NOT NULL,
	"worker_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"work_day_id" integer,
	"phase" text DEFAULT 'idle' NOT NULL,
	"queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "start_time" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "end_time" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "is_full_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "profile_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_workers" ADD CONSTRAINT "activity_workers_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_workers" ADD CONSTRAINT "activity_workers_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state" ADD CONSTRAINT "conversation_state_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_workers_idx" ON "activity_workers" USING btree ("activity_id");