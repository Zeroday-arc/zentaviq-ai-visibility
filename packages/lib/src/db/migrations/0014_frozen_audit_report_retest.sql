CREATE TYPE "public"."audit_comparison_outcome" AS ENUM('improved', 'unchanged', 'regressed', 'insufficient_evidence', 'pending_human_review');--> statement-breakpoint
CREATE TYPE "public"."retest_decision_state" AS ENUM('approved_remediation', 'maintain', 'pending_human_review', 'insufficient_evidence');--> statement-breakpoint
ALTER TYPE "public"."audit_run_kind" ADD VALUE 'retest';--> statement-breakpoint
CREATE TABLE "audit_retest_comparisons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"frozen_report_id" uuid NOT NULL,
	"baseline_audit_run_id" uuid NOT NULL,
	"retest_audit_run_id" uuid NOT NULL,
	"intent_family_id" uuid NOT NULL,
	"finding_id" uuid,
	"remediation_id" uuid,
	"schema_version" integer NOT NULL,
	"comparison_version" integer NOT NULL,
	"outcome" "audit_comparison_outcome" NOT NULL,
	"confidence" real NOT NULL,
	"reason_codes" text[] NOT NULL,
	"decision_state" "retest_decision_state" NOT NULL,
	"prompt_variant_ids" uuid[] NOT NULL,
	"baseline_evidence_ids" uuid[] NOT NULL,
	"retest_evidence_ids" uuid[] NOT NULL,
	"acceptance_criteria_snapshot" text[] NOT NULL,
	"expected_evidence_change_snapshot" text[] NOT NULL,
	"criteria_evaluation" jsonb NOT NULL,
	"baseline_metrics" jsonb NOT NULL,
	"retest_metrics" jsonb NOT NULL,
	"observed_changes" jsonb NOT NULL,
	"provider_configuration_snapshot" jsonb NOT NULL,
	"comparator_id" text NOT NULL,
	"comparator_version" text NOT NULL,
	"comparison_checksum" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "frozen_audit_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"baseline_audit_run_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"report_version" integer NOT NULL,
	"baseline_version" integer NOT NULL,
	"business_identity_snapshot" jsonb NOT NULL,
	"intent_version_snapshot" jsonb NOT NULL,
	"prompt_version_snapshot" jsonb NOT NULL,
	"provider_version_snapshot" jsonb NOT NULL,
	"fixture_manifest" jsonb NOT NULL,
	"policy_version_snapshot" jsonb NOT NULL,
	"decision_snapshot" jsonb NOT NULL,
	"evidence_record_ids" uuid[] NOT NULL,
	"finding_ids" uuid[] NOT NULL,
	"remediation_ids" uuid[] NOT NULL,
	"report_generation_version" text NOT NULL,
	"benchmark_version" text NOT NULL,
	"snapshot_checksum" text NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frozen_audit_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_frozen_report_id_frozen_audit_reports_id_fk" FOREIGN KEY ("frozen_report_id") REFERENCES "public"."frozen_audit_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_baseline_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("baseline_audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_retest_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("retest_audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_intent_family_id_intent_families_id_fk" FOREIGN KEY ("intent_family_id") REFERENCES "public"."intent_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_finding_id_diagnosis_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."diagnosis_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_remediation_id_evidence_remediations_id_fk" FOREIGN KEY ("remediation_id") REFERENCES "public"."evidence_remediations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_audit_reports" ADD CONSTRAINT "frozen_audit_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_audit_reports" ADD CONSTRAINT "frozen_audit_reports_baseline_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("baseline_audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_retest_comparisons_report_retest_intent_unique" ON "audit_retest_comparisons" USING btree ("frozen_report_id","retest_audit_run_id","intent_family_id","comparison_version");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_retest_comparisons_correlation_unique" ON "audit_retest_comparisons" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_retest_comparisons_checksum_unique" ON "audit_retest_comparisons" USING btree ("comparison_checksum");--> statement-breakpoint
CREATE INDEX "audit_retest_comparisons_brand_created_idx" ON "audit_retest_comparisons" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_retest_comparisons_report_idx" ON "audit_retest_comparisons" USING btree ("frozen_report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_audit_reports_baseline_version_unique" ON "frozen_audit_reports" USING btree ("baseline_audit_run_id","report_version");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_audit_reports_correlation_unique" ON "frozen_audit_reports" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_audit_reports_checksum_unique" ON "frozen_audit_reports" USING btree ("snapshot_checksum");--> statement-breakpoint
CREATE INDEX "frozen_audit_reports_brand_frozen_idx" ON "frozen_audit_reports" USING btree ("brand_id","frozen_at");--> statement-breakpoint
CREATE TRIGGER "frozen_audit_reports_immutable" BEFORE UPDATE OR DELETE ON "frozen_audit_reports" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "audit_retest_comparisons_immutable" BEFORE UPDATE OR DELETE ON "audit_retest_comparisons" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
