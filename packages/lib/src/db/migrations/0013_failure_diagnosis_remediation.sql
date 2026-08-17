CREATE TYPE "public"."diagnosis_failure_stage" AS ENUM('retrieval_failure', 'category_fit_ambiguity', 'entity_resolution_ambiguity', 'mention_gap', 'recommendation_gap', 'prominence_ranking_gap', 'citation_support_gap', 'independent_authority_gap', 'competitor_displacement', 'human_review_required', 'insufficient_evidence', 'maintain');--> statement-breakpoint
CREATE TYPE "public"."remediation_action_category" AS ENUM('category_clarification', 'targeted_problem_intent_content', 'comparison_customer_evidence', 'independent_authority_citation_acquisition', 'technical_retrieval_access_remediation', 'entity_disambiguation', 'prominence_recommendation_improvement', 'maintain', 'human_review_gather_more_evidence');--> statement-breakpoint
CREATE TYPE "public"."remediation_approval_state" AS ENUM('not_required', 'proposed', 'pending_human_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."remediation_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "diagnosis_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"intent_family_id" uuid NOT NULL,
	"prompt_variant_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"finding_version" integer NOT NULL,
	"frozen_prompt_version" integer NOT NULL,
	"likely_failure_stage" "diagnosis_failure_stage" NOT NULL,
	"confidence" real NOT NULL,
	"reason_codes" text[] NOT NULL,
	"supporting_evidence_ids" uuid[] NOT NULL,
	"contradicting_evidence_ids" uuid[] NOT NULL,
	"affected_provider_run_ids" uuid[] NOT NULL,
	"review_state" "evidence_review_state" NOT NULL,
	"classifier_id" text NOT NULL,
	"classifier_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"diagnosis_evidence" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnosis_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence_remediations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"primary_finding_id" uuid NOT NULL,
	"linked_finding_ids" uuid[] NOT NULL,
	"schema_version" integer NOT NULL,
	"remediation_version" integer NOT NULL,
	"action_category" "remediation_action_category" NOT NULL,
	"rationale" text NOT NULL,
	"acceptance_criteria" text[] NOT NULL,
	"priority" "remediation_priority" NOT NULL,
	"confidence" real NOT NULL,
	"expected_evidence_change" text[] NOT NULL,
	"approval_state" "remediation_approval_state" NOT NULL,
	"policy_version" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_remediations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_intent_family_id_intent_families_id_fk" FOREIGN KEY ("intent_family_id") REFERENCES "public"."intent_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_prompt_variant_id_frozen_prompt_variants_id_fk" FOREIGN KEY ("prompt_variant_id") REFERENCES "public"."frozen_prompt_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_remediations" ADD CONSTRAINT "evidence_remediations_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_remediations" ADD CONSTRAINT "evidence_remediations_primary_finding_id_diagnosis_findings_id_fk" FOREIGN KEY ("primary_finding_id") REFERENCES "public"."diagnosis_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_findings_audit_intent_version_unique" ON "diagnosis_findings" USING btree ("audit_run_id","intent_family_id","finding_version");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_findings_correlation_unique" ON "diagnosis_findings" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "diagnosis_findings_audit_idx" ON "diagnosis_findings" USING btree ("audit_run_id");--> statement-breakpoint
CREATE INDEX "diagnosis_findings_intent_idx" ON "diagnosis_findings" USING btree ("intent_family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_remediations_finding_version_unique" ON "evidence_remediations" USING btree ("primary_finding_id","remediation_version");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_remediations_correlation_unique" ON "evidence_remediations" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "evidence_remediations_audit_idx" ON "evidence_remediations" USING btree ("audit_run_id");--> statement-breakpoint
CREATE TRIGGER "diagnosis_findings_immutable" BEFORE UPDATE ON "diagnosis_findings" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "evidence_remediations_immutable" BEFORE UPDATE ON "evidence_remediations" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
