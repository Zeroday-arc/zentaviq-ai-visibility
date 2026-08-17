CREATE TYPE "public"."audit_execution_mode" AS ENUM('fixture_replay', 'live');--> statement-breakpoint
CREATE TYPE "public"."audit_run_kind" AS ENUM('baseline', 'audit');--> statement-breakpoint
CREATE TYPE "public"."citation_evidence_type" AS ENUM('first_party', 'independent', 'competitor', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."evidence_entity_role" AS ENUM('brand', 'competitor');--> statement-breakpoint
CREATE TYPE "public"."retrieval_status" AS ENUM('retrieved', 'not_retrieved');--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"run_kind" "audit_run_kind" NOT NULL,
	"execution_mode" "audit_execution_mode" NOT NULL,
	"schema_version" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"fixture_set_checksum" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "citation_evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"response_payload_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"citation_index" integer NOT NULL,
	"citation_type" "citation_evidence_type" NOT NULL,
	"original_url" text NOT NULL,
	"normalized_url" text,
	"normalized_domain" text,
	"title" text,
	"extractor_id" text NOT NULL,
	"extractor_version" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citation_evidence_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_identity_evidence_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"response_payload_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_role" "evidence_entity_role" NOT NULL,
	"identity_version" integer NOT NULL,
	"retrieved" boolean NOT NULL,
	"mentioned" boolean NOT NULL,
	"recommended" boolean NOT NULL,
	"cited" boolean NOT NULL,
	"extractor_id" text NOT NULL,
	"extractor_version" text NOT NULL,
	"identity_snapshot" jsonb NOT NULL,
	"match_evidence" jsonb NOT NULL,
	"recommendation_evidence" jsonb NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "frozen_prompt_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_family_id" uuid NOT NULL,
	"source_prompt_id" uuid,
	"prompt_text" text NOT NULL,
	"prompt_checksum" text NOT NULL,
	"schema_version" integer NOT NULL,
	"version" integer NOT NULL,
	"frozen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frozen_prompt_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intent_families" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"schema_version" integer NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_families" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_model_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"schema_version" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_model_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_response_payloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_run_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"fixture_id" text NOT NULL,
	"fixture_checksum" text NOT NULL,
	"payload_checksum" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"fixture_captured_at" timestamp with time zone NOT NULL,
	"replayed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_response_payloads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"prompt_variant_id" uuid NOT NULL,
	"provider_model_version_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"execution_mode" "audit_execution_mode" NOT NULL,
	"retrieval_status" "retrieval_status" NOT NULL,
	"correlation_id" text NOT NULL,
	"extractor_id" text NOT NULL,
	"extractor_version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_evidence_records" ADD CONSTRAINT "citation_evidence_records_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_evidence_records" ADD CONSTRAINT "citation_evidence_records_response_payload_id_provider_response_payloads_id_fk" FOREIGN KEY ("response_payload_id") REFERENCES "public"."provider_response_payloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD CONSTRAINT "entity_identity_evidence_records_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD CONSTRAINT "entity_identity_evidence_records_response_payload_id_provider_response_payloads_id_fk" FOREIGN KEY ("response_payload_id") REFERENCES "public"."provider_response_payloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_prompt_variants" ADD CONSTRAINT "frozen_prompt_variants_intent_family_id_intent_families_id_fk" FOREIGN KEY ("intent_family_id") REFERENCES "public"."intent_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_prompt_variants" ADD CONSTRAINT "frozen_prompt_variants_source_prompt_id_prompts_id_fk" FOREIGN KEY ("source_prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_families" ADD CONSTRAINT "intent_families_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_response_payloads" ADD CONSTRAINT "provider_response_payloads_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_prompt_variant_id_frozen_prompt_variants_id_fk" FOREIGN KEY ("prompt_variant_id") REFERENCES "public"."frozen_prompt_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_provider_model_version_id_provider_model_versions_id_fk" FOREIGN KEY ("provider_model_version_id") REFERENCES "public"."provider_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_runs_correlation_id_unique" ON "audit_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_runs_brand_completed_at_idx" ON "audit_runs" USING btree ("brand_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "citation_evidence_provider_index_unique" ON "citation_evidence_records" USING btree ("provider_run_id","citation_index");--> statement-breakpoint
CREATE UNIQUE INDEX "citation_evidence_correlation_id_unique" ON "citation_evidence_records" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "citation_evidence_normalized_domain_idx" ON "citation_evidence_records" USING btree ("normalized_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_identity_evidence_provider_entity_unique" ON "entity_identity_evidence_records" USING btree ("provider_run_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_identity_evidence_correlation_unique" ON "entity_identity_evidence_records" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "entity_identity_evidence_provider_run_idx" ON "entity_identity_evidence_records" USING btree ("provider_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_prompt_variants_intent_version_unique" ON "frozen_prompt_variants" USING btree ("intent_family_id","version");--> statement-breakpoint
CREATE INDEX "frozen_prompt_variants_checksum_idx" ON "frozen_prompt_variants" USING btree ("prompt_checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "intent_families_brand_key_version_unique" ON "intent_families" USING btree ("brand_id","key","version");--> statement-breakpoint
CREATE INDEX "intent_families_brand_created_at_idx" ON "intent_families" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_model_versions_identity_unique" ON "provider_model_versions" USING btree ("provider_id","model_id","model_version","schema_version");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_response_payloads_provider_run_unique" ON "provider_response_payloads" USING btree ("provider_run_id");--> statement-breakpoint
CREATE INDEX "provider_response_payloads_fixture_checksum_idx" ON "provider_response_payloads" USING btree ("fixture_id","fixture_checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_runs_correlation_id_unique" ON "provider_runs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "provider_runs_audit_run_id_idx" ON "provider_runs" USING btree ("audit_run_id");--> statement-breakpoint
CREATE INDEX "provider_runs_prompt_variant_id_idx" ON "provider_runs" USING btree ("prompt_variant_id");
--> statement-breakpoint
CREATE FUNCTION "reject_immutable_evidence_update"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'immutable evidence records cannot be updated: %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "intent_families_immutable" BEFORE UPDATE ON "intent_families" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "frozen_prompt_variants_immutable" BEFORE UPDATE ON "frozen_prompt_variants" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "audit_runs_immutable" BEFORE UPDATE ON "audit_runs" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "provider_model_versions_immutable" BEFORE UPDATE ON "provider_model_versions" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "provider_runs_immutable" BEFORE UPDATE ON "provider_runs" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "provider_response_payloads_immutable" BEFORE UPDATE ON "provider_response_payloads" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "citation_evidence_records_immutable" BEFORE UPDATE ON "citation_evidence_records" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "entity_identity_evidence_records_immutable" BEFORE UPDATE ON "entity_identity_evidence_records" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
