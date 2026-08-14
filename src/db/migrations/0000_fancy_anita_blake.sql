CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blackout_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"manager_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"workday_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "employees_org_id_email_unique" UNIQUE("org_id","email"),
	CONSTRAINT "employees_role_check" CHECK ("employees"."role" IN ('employee','manager','admin'))
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"name" text NOT NULL,
	"region" text
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "leave_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leave_entry_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"portion" text NOT NULL,
	"consumes_balance" boolean NOT NULL,
	"slot_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_days_leave_entry_id_on_date_unique" UNIQUE("leave_entry_id","on_date")
);
--> statement-breakpoint
CREATE TABLE "leave_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"status" text NOT NULL,
	"immutable_at" timestamp with time zone,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"portion" text NOT NULL,
	"custom_minutes" integer,
	"total_minutes" integer NOT NULL,
	"note" text,
	"admin_note" text,
	"import_batch_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_entries_intent_check" CHECK ("leave_entries"."intent" IN ('log','request')),
	CONSTRAINT "leave_entries_status_check" CHECK ("leave_entries"."status" IN ('draft','pending','approved','rejected','cancelled')),
	CONSTRAINT "leave_entries_portion_check" CHECK ("leave_entries"."portion" IN ('full','am','pm','custom')),
	CONSTRAINT "leave_entries_date_range" CHECK ("leave_entries"."end_date" >= "leave_entries"."start_date")
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"consumes_balance" boolean NOT NULL,
	"unlimited" boolean DEFAULT false NOT NULL,
	"legal_unit" text DEFAULT 'hours' NOT NULL,
	"visible_on_team_calendar" boolean DEFAULT true NOT NULL,
	"min_increment_minutes" integer,
	"color" text,
	CONSTRAINT "leave_types_org_id_code_unique" UNIQUE("org_id","code"),
	CONSTRAINT "leave_types_legal_unit_check" CHECK ("leave_types"."legal_unit" IN ('hours','days'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"minutes" integer NOT NULL,
	"effective_on" date NOT NULL,
	"period_year" integer NOT NULL,
	"leave_entry_id" uuid,
	"leave_day_id" uuid,
	"reverses_id" uuid,
	"reversed_at" timestamp with time zone,
	"import_batch_id" uuid,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ledger_entries_kind_check" CHECK ("ledger_entries"."kind" IN ('grant_lump','accrual','carryover','usage','adjustment','forfeit','reversal'))
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"app_readonly" boolean DEFAULT false NOT NULL,
	"self_log_enabled" boolean DEFAULT true NOT NULL,
	"requests_enabled" boolean DEFAULT true NOT NULL,
	"team_calendar_enabled" boolean DEFAULT false NOT NULL,
	"accrual_job_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"standard_workday_minutes" integer NOT NULL,
	"weekend_days" integer[] DEFAULT '{6,7}' NOT NULL,
	"team_calendar_show_type" boolean DEFAULT false NOT NULL,
	"year_anchor" text DEFAULT 'calendar' NOT NULL,
	"edit_window_days" integer DEFAULT 7 NOT NULL,
	"force_explicit_type" boolean DEFAULT true NOT NULL,
	CONSTRAINT "organizations_timezone_nonempty" CHECK ("organizations"."timezone" <> ''),
	CONSTRAINT "organizations_workday_positive" CHECK ("organizations"."standard_workday_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period" text DEFAULT 'calendar_year' NOT NULL,
	"grant_mode" text NOT NULL,
	"grant_minutes" integer,
	"periodic_cadence" text,
	"periodic_minutes" integer,
	"accrual_stop_minutes" integer,
	"take_ceiling_minutes" integer,
	"carryover_max_minutes" integer,
	"allow_forfeit" boolean DEFAULT false NOT NULL,
	"negative_allowed" boolean DEFAULT false NOT NULL,
	"negative_floor_minutes" integer,
	"waiting_period_days" integer DEFAULT 0 NOT NULL,
	"approval_for_request" text DEFAULT 'admin' NOT NULL,
	"approval_for_log" text DEFAULT 'none' NOT NULL,
	"notice_days" integer,
	"min_increment_minutes" integer DEFAULT 60 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "policies_period_check" CHECK ("policies"."period" IN ('calendar_year','anniversary')),
	CONSTRAINT "policies_grant_mode_check" CHECK ("policies"."grant_mode" IN ('lump_sum','periodic','hourly_worked','none'))
);
--> statement-breakpoint
CREATE TABLE "policy_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "policy_periods" (
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "policy_periods_org_id_year_pk" PRIMARY KEY("org_id","year"),
	CONSTRAINT "policy_periods_status_check" CHECK ("policy_periods"."status" IN ('future','open','closing','closed'))
);
--> statement-breakpoint
CREATE TABLE "policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_tenure_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"min_years" integer NOT NULL,
	"max_years" integer,
	"grant_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"sha256" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "year_end_snapshots_org_id_year_unique" UNIQUE("org_id","year")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackout_dates" ADD CONSTRAINT "blackout_dates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_leave_entry_id_leave_entries_id_fk" FOREIGN KEY ("leave_entry_id") REFERENCES "public"."leave_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_entries" ADD CONSTRAINT "leave_entries_updated_by_employees_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_leave_entry_id_leave_entries_id_fk" FOREIGN KEY ("leave_entry_id") REFERENCES "public"."leave_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_leave_day_id_leave_days_id_fk" FOREIGN KEY ("leave_day_id") REFERENCES "public"."leave_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_periods" ADD CONSTRAINT "policy_periods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_periods" ADD CONSTRAINT "policy_periods_closed_by_employees_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_tenure_bands" ADD CONSTRAINT "policy_tenure_bands_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_snapshots" ADD CONSTRAINT "year_end_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_org_date_region" ON "holidays" USING btree ("org_id","on_date",COALESCE("region", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "leave_days_consuming_portion" ON "leave_days" USING btree ("employee_id","on_date","portion") WHERE "leave_days"."consumes_balance" = true AND "leave_days"."slot_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_grant_once" ON "ledger_entries" USING btree ("employee_id","leave_type_id","kind","period_year","effective_on") WHERE "ledger_entries"."kind" IN ('grant_lump','accrual','carryover') AND "ledger_entries"."reversed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ledger_balance_idx" ON "ledger_entries" USING btree ("employee_id","leave_type_id","effective_on");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_assignments_one" ON "policy_assignments" USING btree ("employee_id","leave_type_id");