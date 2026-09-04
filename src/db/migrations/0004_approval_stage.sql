ALTER TABLE "leave_entries" ADD COLUMN "approval_stage" text;
--> statement-breakpoint
ALTER TABLE "leave_entries" ADD COLUMN "documentation_may_be_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "probation_end_date" date;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "notice_period_start_date" date;
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "notification_outbox_kind_source" UNIQUE("kind","source_id")
);
--> statement-breakpoint
CREATE TABLE "makeup_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"missed_date" text NOT NULL,
	"makeup_date" text NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"manager_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "makeup_entries" ADD CONSTRAINT "makeup_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "makeup_entries" ADD CONSTRAINT "makeup_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "makeup_entries" ADD CONSTRAINT "makeup_entries_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "makeup_entries" ADD CONSTRAINT "makeup_entries_decided_by_employees_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
