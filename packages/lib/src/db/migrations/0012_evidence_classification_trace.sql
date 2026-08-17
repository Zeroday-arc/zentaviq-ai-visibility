CREATE TYPE "public"."citation_claim_type" AS ENUM('identity', 'mention', 'recommendation');--> statement-breakpoint
CREATE TYPE "public"."evidence_decision_status" AS ENUM('accepted', 'rejected', 'ambiguous', 'not_detected');--> statement-breakpoint
CREATE TYPE "public"."evidence_review_state" AS ENUM('not_required', 'pending', 'accepted', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."evidence_entity_role" ADD VALUE 'unknown';--> statement-breakpoint
CREATE TABLE "citation_claim_evidence_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"citation_evidence_id" uuid NOT NULL,
	"entity_evidence_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"correlation_id" text NOT NULL,
	"claim" "citation_claim_type" NOT NULL,
	"status" "evidence_decision_status" NOT NULL,
	"classifier_id" text NOT NULL,
	"classifier_version" text NOT NULL,
	"source_excerpt" text NOT NULL,
	"excerpt_start" integer NOT NULL,
	"excerpt_end" integer NOT NULL,
	"confidence" real NOT NULL,
	"reason_codes" text[] NOT NULL,
	"source_evidence_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD COLUMN "prominence_rank" integer;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD COLUMN "review_state" "evidence_review_state" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_identity_evidence_records" ADD COLUMN "classification_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" ADD CONSTRAINT "citation_claim_evidence_links_citation_evidence_id_citation_evidence_records_id_fk" FOREIGN KEY ("citation_evidence_id") REFERENCES "public"."citation_evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation_claim_evidence_links" ADD CONSTRAINT "citation_claim_evidence_links_entity_evidence_id_entity_identity_evidence_records_id_fk" FOREIGN KEY ("entity_evidence_id") REFERENCES "public"."entity_identity_evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "citation_claim_evidence_link_unique" ON "citation_claim_evidence_links" USING btree ("citation_evidence_id","entity_evidence_id","claim");--> statement-breakpoint
CREATE UNIQUE INDEX "citation_claim_evidence_correlation_unique" ON "citation_claim_evidence_links" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "citation_claim_evidence_entity_idx" ON "citation_claim_evidence_links" USING btree ("entity_evidence_id");
--> statement-breakpoint
CREATE TRIGGER "citation_claim_evidence_links_immutable" BEFORE UPDATE ON "citation_claim_evidence_links" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_evidence_update"();
