CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"work_front" text,
	"activity_type" text,
	"description" text NOT NULL,
	"worker_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"worker_id" integer NOT NULL,
	"entry_time" text,
	"exit_time" text,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"day_fraction" real DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"work_front" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"raw_message_id" integer,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"type" text DEFAULT 'مشکل' NOT NULL,
	"description" text NOT NULL,
	"impact" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"name" text DEFAULT 'کارگاه' NOT NULL,
	"report_prefix" text DEFAULT 'RN' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "raw_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"telegram_message_id" bigint,
	"kind" text NOT NULL,
	"text" text,
	"transcript" text,
	"telegram_file_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reworks" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_day_id" integer NOT NULL,
	"work_front" text,
	"amount" text,
	"cause" text,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"jalali_date" text NOT NULL,
	"date_label" text NOT NULL,
	"report_no" text,
	"status" text DEFAULT 'open' NOT NULL,
	"weather" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trade" text,
	"contractor" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_events" ADD CONSTRAINT "extracted_events_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_events" ADD CONSTRAINT "extracted_events_raw_message_id_raw_messages_id_fk" FOREIGN KEY ("raw_message_id") REFERENCES "public"."raw_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_messages" ADD CONSTRAINT "raw_messages_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_work_day_id_work_days_id_fk" FOREIGN KEY ("work_day_id") REFERENCES "public"."work_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_days" ADD CONSTRAINT "work_days_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_day_idx" ON "activities" USING btree ("work_day_id");--> statement-breakpoint
CREATE INDEX "attendance_day_idx" ON "attendance" USING btree ("work_day_id");--> statement-breakpoint
CREATE INDEX "events_day_idx" ON "extracted_events" USING btree ("work_day_id","type");--> statement-breakpoint
CREATE INDEX "issues_day_idx" ON "issues" USING btree ("work_day_id");--> statement-breakpoint
CREATE INDEX "raw_messages_day_idx" ON "raw_messages" USING btree ("work_day_id");--> statement-breakpoint
CREATE INDEX "reworks_day_idx" ON "reworks" USING btree ("work_day_id");--> statement-breakpoint
CREATE INDEX "work_days_project_idx" ON "work_days" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "workers_project_idx" ON "workers" USING btree ("project_id");