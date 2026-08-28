ALTER TABLE "audit_retest_comparisons" DROP CONSTRAINT "audit_retest_comparisons_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_runs" DROP CONSTRAINT "audit_runs_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" DROP CONSTRAINT "citation_claim_evidence_links_citation_evidence_id_citation_evidence_records_id_fk";
--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" DROP CONSTRAINT "citation_claim_evidence_links_entity_evidence_id_entity_identity_evidence_records_id_fk";
--> statement-breakpoint
ALTER TABLE "citation_evidence_records" DROP CONSTRAINT "citation_evidence_records_provider_run_id_provider_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "citation_evidence_records" DROP CONSTRAINT "citation_evidence_records_response_payload_id_provider_response_payloads_id_fk";
--> statement-breakpoint
ALTER TABLE "diagnosis_findings" DROP CONSTRAINT "diagnosis_findings_audit_run_id_audit_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" DROP CONSTRAINT "entity_identity_evidence_records_provider_run_id_provider_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" DROP CONSTRAINT "entity_identity_evidence_records_response_payload_id_provider_response_payloads_id_fk";
--> statement-breakpoint
ALTER TABLE "evidence_remediations" DROP CONSTRAINT "evidence_remediations_audit_run_id_audit_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "evidence_remediations" DROP CONSTRAINT "evidence_remediations_primary_finding_id_diagnosis_findings_id_fk";
--> statement-breakpoint
ALTER TABLE "frozen_audit_reports" DROP CONSTRAINT "frozen_audit_reports_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "frozen_prompt_variants" DROP CONSTRAINT "frozen_prompt_variants_intent_family_id_intent_families_id_fk";
--> statement-breakpoint
ALTER TABLE "intent_families" DROP CONSTRAINT "intent_families_brand_id_brands_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_response_payloads" DROP CONSTRAINT "provider_response_payloads_provider_run_id_provider_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_runs" DROP CONSTRAINT "provider_runs_audit_run_id_audit_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_runs" DROP CONSTRAINT "provider_runs_prompt_variant_id_frozen_prompt_variants_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_retest_comparisons" ADD CONSTRAINT "audit_retest_comparisons_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" ADD CONSTRAINT "citation_claim_evidence_links_citation_evidence_id_citation_evidence_records_id_fk" FOREIGN KEY ("citation_evidence_id") REFERENCES "public"."citation_evidence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" ADD CONSTRAINT "citation_claim_evidence_links_entity_evidence_id_entity_identity_evidence_records_id_fk" FOREIGN KEY ("entity_evidence_id") REFERENCES "public"."entity_identity_evidence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_evidence_records" ADD CONSTRAINT "citation_evidence_records_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_evidence_records" ADD CONSTRAINT "citation_evidence_records_response_payload_id_provider_response_payloads_id_fk" FOREIGN KEY ("response_payload_id") REFERENCES "public"."provider_response_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD CONSTRAINT "entity_identity_evidence_records_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD CONSTRAINT "entity_identity_evidence_records_response_payload_id_provider_response_payloads_id_fk" FOREIGN KEY ("response_payload_id") REFERENCES "public"."provider_response_payloads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_remediations" ADD CONSTRAINT "evidence_remediations_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_remediations" ADD CONSTRAINT "evidence_remediations_primary_finding_id_diagnosis_findings_id_fk" FOREIGN KEY ("primary_finding_id") REFERENCES "public"."diagnosis_findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_audit_reports" ADD CONSTRAINT "frozen_audit_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_prompt_variants" ADD CONSTRAINT "frozen_prompt_variants_intent_family_id_intent_families_id_fk" FOREIGN KEY ("intent_family_id") REFERENCES "public"."intent_families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_families" ADD CONSTRAINT "intent_families_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_response_payloads" ADD CONSTRAINT "provider_response_payloads_provider_run_id_provider_runs_id_fk" FOREIGN KEY ("provider_run_id") REFERENCES "public"."provider_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_prompt_variant_id_frozen_prompt_variants_id_fk" FOREIGN KEY ("prompt_variant_id") REFERENCES "public"."frozen_prompt_variants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP TRIGGER "intent_families_immutable" ON "intent_families";--> statement-breakpoint
DROP TRIGGER "frozen_prompt_variants_immutable" ON "frozen_prompt_variants";--> statement-breakpoint
DROP TRIGGER "audit_runs_immutable" ON "audit_runs";--> statement-breakpoint
DROP TRIGGER "provider_model_versions_immutable" ON "provider_model_versions";--> statement-breakpoint
DROP TRIGGER "provider_runs_immutable" ON "provider_runs";--> statement-breakpoint
DROP TRIGGER "provider_response_payloads_immutable" ON "provider_response_payloads";--> statement-breakpoint
DROP TRIGGER "citation_evidence_records_immutable" ON "citation_evidence_records";--> statement-breakpoint
DROP TRIGGER "entity_identity_evidence_records_immutable" ON "entity_identity_evidence_records";--> statement-breakpoint
DROP TRIGGER "citation_claim_evidence_links_immutable" ON "citation_claim_evidence_links";--> statement-breakpoint
DROP TRIGGER "diagnosis_findings_immutable" ON "diagnosis_findings";--> statement-breakpoint
DROP TRIGGER "evidence_remediations_immutable" ON "evidence_remediations";--> statement-breakpoint
CREATE TRIGGER "intent_families_immutable" BEFORE UPDATE OR DELETE ON "intent_families" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "frozen_prompt_variants_immutable" BEFORE UPDATE OR DELETE ON "frozen_prompt_variants" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "audit_runs_immutable" BEFORE UPDATE OR DELETE ON "audit_runs" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "provider_model_versions_immutable" BEFORE UPDATE OR DELETE ON "provider_model_versions" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "provider_runs_immutable" BEFORE UPDATE OR DELETE ON "provider_runs" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "provider_response_payloads_immutable" BEFORE UPDATE OR DELETE ON "provider_response_payloads" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "citation_evidence_records_immutable" BEFORE UPDATE OR DELETE ON "citation_evidence_records" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "entity_identity_evidence_records_immutable" BEFORE UPDATE OR DELETE ON "entity_identity_evidence_records" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "citation_claim_evidence_links_immutable" BEFORE UPDATE OR DELETE ON "citation_claim_evidence_links" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "diagnosis_findings_immutable" BEFORE UPDATE OR DELETE ON "diagnosis_findings" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();--> statement-breakpoint
CREATE TRIGGER "evidence_remediations_immutable" BEFORE UPDATE OR DELETE ON "evidence_remediations" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
