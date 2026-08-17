import {
	pgEnum,
	pgTable,
	uuid,
	text,
	timestamp,
	boolean,
	json,
	jsonb,
	index,
	uniqueIndex,
	integer,
	smallint,
	real,
} from "drizzle-orm/pg-core";

// Better-auth tables & relations — re-exported so `import * as schema` sees everything.
// Source file is auto-generated; run `pnpm run generate:auth-schema` to refresh.
export * from "./schema-auth";

// ============================================================================
// Application tables
// ============================================================================

export const reportStatusEnum = pgEnum("report_status", ["pending", "processing", "completed", "failed"]);
export const auditRunKindEnum = pgEnum("audit_run_kind", ["baseline", "audit", "retest"]);
export const auditExecutionModeEnum = pgEnum("audit_execution_mode", ["fixture_replay", "live"]);
export const retrievalStatusEnum = pgEnum("retrieval_status", ["retrieved", "not_retrieved"]);
export const citationEvidenceTypeEnum = pgEnum("citation_evidence_type", [
	"first_party",
	"independent",
	"competitor",
	"unknown",
]);
export const evidenceEntityRoleEnum = pgEnum("evidence_entity_role", ["brand", "competitor", "unknown"]);
export const evidenceDecisionStatusEnum = pgEnum("evidence_decision_status", [
	"accepted",
	"rejected",
	"ambiguous",
	"not_detected",
]);
export const evidenceReviewStateEnum = pgEnum("evidence_review_state", [
	"not_required",
	"pending",
	"accepted",
	"rejected",
]);
export const citationClaimTypeEnum = pgEnum("citation_claim_type", ["identity", "mention", "recommendation"]);
export const diagnosisFailureStageEnum = pgEnum("diagnosis_failure_stage", [
	"retrieval_failure",
	"category_fit_ambiguity",
	"entity_resolution_ambiguity",
	"mention_gap",
	"recommendation_gap",
	"prominence_ranking_gap",
	"citation_support_gap",
	"independent_authority_gap",
	"competitor_displacement",
	"human_review_required",
	"insufficient_evidence",
	"maintain",
]);
export const remediationActionCategoryEnum = pgEnum("remediation_action_category", [
	"category_clarification",
	"targeted_problem_intent_content",
	"comparison_customer_evidence",
	"independent_authority_citation_acquisition",
	"technical_retrieval_access_remediation",
	"entity_disambiguation",
	"prominence_recommendation_improvement",
	"maintain",
	"human_review_gather_more_evidence",
]);
export const remediationPriorityEnum = pgEnum("remediation_priority", ["low", "medium", "high"]);
export const remediationApprovalStateEnum = pgEnum("remediation_approval_state", [
	"not_required",
	"proposed",
	"pending_human_review",
	"approved",
	"rejected",
]);
export const auditComparisonOutcomeEnum = pgEnum("audit_comparison_outcome", [
	"improved",
	"unchanged",
	"regressed",
	"insufficient_evidence",
	"pending_human_review",
]);
export const retestDecisionStateEnum = pgEnum("retest_decision_state", [
	"approved_remediation",
	"maintain",
	"pending_human_review",
	"insufficient_evidence",
]);

export const brands = pgTable("brands", {
	id: text("id").primaryKey().notNull(),
	name: text("name").notNull(),
	website: text("website").notNull(),
	additionalDomains: text("additional_domains").array().notNull().default([]),
	aliases: text("aliases").array().notNull().default([]),
	enabled: boolean("enabled").default(true).notNull(),
	onboarded: boolean("onboarded").default(false).notNull(),
	delayOverrideHours: integer("delay_override_hours"),
	enabledModels: text("enabled_models").array(),
	targetMarket: text("target_market"),
	targetLanguage: text("target_language"),
	shortDescription: text("short_description"),
	productsAndServices: text("products_and_services").array().notNull().default([]),
	keywords: text("keywords").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

export const prompts = pgTable(
	"prompts",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		value: text("value").notNull(),
		enabled: boolean("enabled").default(true).notNull(),
		tags: text("tags").array().notNull().default([]),
		systemTags: text("system_tags").array().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		brandIdIdx: index("prompts_brand_id_idx").on(table.brandId),
		brandIdEnabledIdx: index("prompts_brand_id_enabled_idx").on(table.brandId, table.enabled),
	}),
).enableRLS();

export const competitors = pgTable("competitors", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id)
		.notNull(),
	name: text("name").notNull(),
	domains: text("domains").array().notNull().default([]),
	aliases: text("aliases").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

export const promptRuns = pgTable(
	"prompt_runs",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		provider: text("provider"),
		version: text("version").notNull(),
		webSearchEnabled: boolean("web_search_enabled").notNull(),
		rawOutput: json("raw_output").notNull(),
		webQueries: text("web_queries").array().notNull().default([]),
		brandMentioned: boolean("brand_mentioned").notNull(),
		competitorsMentioned: text("competitors_mentioned").array().notNull().default([]),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		promptIdCreatedAtIdx: index("prompt_runs_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		createdAtIdx: index("prompt_runs_created_at_idx").on(table.createdAt),
		webSearchCreatedAtIdx: index("prompt_runs_web_search_created_at_idx").on(table.webSearchEnabled, table.createdAt),
		webSearchModelCreatedAtIdx: index("prompt_runs_web_search_model_created_at_idx").on(
			table.webSearchEnabled,
			table.model,
			table.createdAt,
		),
		providerIdx: index("prompt_runs_provider_idx").on(table.provider),
		modelCreatedAtIdx: index("prompt_runs_model_created_at_idx").on(table.model, table.createdAt),
	}),
).enableRLS();

export const citations = pgTable(
	"citations",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		promptRunId: uuid("prompt_run_id")
			.references(() => promptRuns.id)
			.notNull(),
		promptId: uuid("prompt_id")
			.references(() => prompts.id)
			.notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		model: text("model").notNull(),
		url: text("url").notNull(),
		domain: text("domain").notNull(),
		title: text("title"),
		citationIndex: smallint("citation_index").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		brandAnalyticsIdx: index("idx_citations_brand_analytics").on(
			table.brandId,
			table.createdAt,
			table.url,
			table.domain,
			table.title,
			table.promptId,
			table.model,
		),
		promptCreatedIdx: index("citations_prompt_id_created_at_idx").on(table.promptId, table.createdAt),
		domainIdx: index("citations_domain_idx").on(table.domain),
	}),
).enableRLS();

// ============================================================================
// Canonical immutable audit evidence
// ============================================================================

/**
 * Versioned intent definition. Records are append-only: a changed intent gets
 * a new version instead of mutating the definition used by historical runs.
 */
export const intentFamilies = pgTable(
	"intent_families",
	{
		id: uuid("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		key: text("key").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull(),
		schemaVersion: integer("schema_version").notNull(),
		version: integer("version").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		brandKeyVersionUnique: uniqueIndex("intent_families_brand_key_version_unique").on(
			table.brandId,
			table.key,
			table.version,
		),
		brandCreatedIdx: index("intent_families_brand_created_at_idx").on(table.brandId, table.createdAt),
	}),
).enableRLS();

/** A prompt string frozen exactly as executed for a versioned intent. */
export const frozenPromptVariants = pgTable(
	"frozen_prompt_variants",
	{
		id: uuid("id").primaryKey().notNull(),
		intentFamilyId: uuid("intent_family_id")
			.references(() => intentFamilies.id, { onDelete: "cascade" })
			.notNull(),
		sourcePromptId: uuid("source_prompt_id").references(() => prompts.id, { onDelete: "set null" }),
		promptText: text("prompt_text").notNull(),
		promptChecksum: text("prompt_checksum").notNull(),
		schemaVersion: integer("schema_version").notNull(),
		version: integer("version").notNull(),
		frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		intentVersionUnique: uniqueIndex("frozen_prompt_variants_intent_version_unique").on(
			table.intentFamilyId,
			table.version,
		),
		checksumIdx: index("frozen_prompt_variants_checksum_idx").on(table.promptChecksum),
	}),
).enableRLS();

/** A completed immutable baseline or audit envelope. */
export const auditRuns = pgTable(
	"audit_runs",
	{
		id: uuid("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		runKind: auditRunKindEnum("run_kind").notNull(),
		executionMode: auditExecutionModeEnum("execution_mode").notNull(),
		schemaVersion: integer("schema_version").notNull(),
		correlationId: text("correlation_id").notNull(),
		fixtureSetChecksum: text("fixture_set_checksum").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		correlationUnique: uniqueIndex("audit_runs_correlation_id_unique").on(table.correlationId),
		brandCompletedIdx: index("audit_runs_brand_completed_at_idx").on(table.brandId, table.completedAt),
	}),
).enableRLS();

/** Canonical provider/model/version identity referenced by individual runs. */
export const providerModelVersions = pgTable(
	"provider_model_versions",
	{
		id: uuid("id").primaryKey().notNull(),
		providerId: text("provider_id").notNull(),
		modelId: text("model_id").notNull(),
		modelVersion: text("model_version").notNull(),
		schemaVersion: integer("schema_version").notNull(),
		metadata: jsonb("metadata").$type<Record<string, string>>().notNull(),
		recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		identityUnique: uniqueIndex("provider_model_versions_identity_unique").on(
			table.providerId,
			table.modelId,
			table.modelVersion,
			table.schemaVersion,
		),
	}),
).enableRLS();

/** One provider execution for one frozen prompt variant. */
export const providerRuns = pgTable(
	"provider_runs",
	{
		id: uuid("id").primaryKey().notNull(),
		auditRunId: uuid("audit_run_id")
			.references(() => auditRuns.id, { onDelete: "cascade" })
			.notNull(),
		promptVariantId: uuid("prompt_variant_id")
			.references(() => frozenPromptVariants.id, { onDelete: "cascade" })
			.notNull(),
		providerModelVersionId: uuid("provider_model_version_id")
			.references(() => providerModelVersions.id)
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		executionMode: auditExecutionModeEnum("execution_mode").notNull(),
		retrievalStatus: retrievalStatusEnum("retrieval_status").notNull(),
		correlationId: text("correlation_id").notNull(),
		extractorId: text("extractor_id").notNull(),
		extractorVersion: text("extractor_version").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		correlationUnique: uniqueIndex("provider_runs_correlation_id_unique").on(table.correlationId),
		auditIdx: index("provider_runs_audit_run_id_idx").on(table.auditRunId),
		promptIdx: index("provider_runs_prompt_variant_id_idx").on(table.promptVariantId),
	}),
).enableRLS();

/** Raw provider response retained byte-for-byte as canonical JSON. */
export const providerResponsePayloads = pgTable(
	"provider_response_payloads",
	{
		id: uuid("id").primaryKey().notNull(),
		providerRunId: uuid("provider_run_id")
			.references(() => providerRuns.id, { onDelete: "cascade" })
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		fixtureId: text("fixture_id").notNull(),
		fixtureChecksum: text("fixture_checksum").notNull(),
		payloadChecksum: text("payload_checksum").notNull(),
		rawPayload: jsonb("raw_payload").$type<unknown>().notNull(),
		fixtureCapturedAt: timestamp("fixture_captured_at", { withTimezone: true }).notNull(),
		replayedAt: timestamp("replayed_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		providerRunUnique: uniqueIndex("provider_response_payloads_provider_run_unique").on(table.providerRunId),
		fixtureChecksumIdx: index("provider_response_payloads_fixture_checksum_idx").on(
			table.fixtureId,
			table.fixtureChecksum,
		),
	}),
).enableRLS();

/** Citation extraction output with source classification and exact provenance. */
export const citationEvidenceRecords = pgTable(
	"citation_evidence_records",
	{
		id: uuid("id").primaryKey().notNull(),
		providerRunId: uuid("provider_run_id")
			.references(() => providerRuns.id, { onDelete: "cascade" })
			.notNull(),
		responsePayloadId: uuid("response_payload_id")
			.references(() => providerResponsePayloads.id, { onDelete: "cascade" })
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		correlationId: text("correlation_id").notNull(),
		citationIndex: integer("citation_index").notNull(),
		citationType: citationEvidenceTypeEnum("citation_type").notNull(),
		originalUrl: text("original_url").notNull(),
		normalizedUrl: text("normalized_url"),
		normalizedDomain: text("normalized_domain"),
		title: text("title"),
		extractorId: text("extractor_id").notNull(),
		extractorVersion: text("extractor_version").notNull(),
		evidence: jsonb("evidence").$type<unknown>().notNull(),
		extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		providerIndexUnique: uniqueIndex("citation_evidence_provider_index_unique").on(
			table.providerRunId,
			table.citationIndex,
		),
		correlationUnique: uniqueIndex("citation_evidence_correlation_id_unique").on(table.correlationId),
		domainIdx: index("citation_evidence_normalized_domain_idx").on(table.normalizedDomain),
	}),
).enableRLS();

/** Per-entity retrieval, mention, recommendation, citation, and match evidence. */
export const entityIdentityEvidenceRecords = pgTable(
	"entity_identity_evidence_records",
	{
		id: uuid("id").primaryKey().notNull(),
		providerRunId: uuid("provider_run_id")
			.references(() => providerRuns.id, { onDelete: "cascade" })
			.notNull(),
		responsePayloadId: uuid("response_payload_id")
			.references(() => providerResponsePayloads.id, { onDelete: "cascade" })
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		correlationId: text("correlation_id").notNull(),
		entityId: text("entity_id").notNull(),
		entityRole: evidenceEntityRoleEnum("entity_role").notNull(),
		identityVersion: integer("identity_version").notNull(),
		retrieved: boolean("retrieved").notNull(),
		mentioned: boolean("mentioned").notNull(),
		recommended: boolean("recommended").notNull(),
		cited: boolean("cited").notNull(),
		prominenceRank: integer("prominence_rank"),
		reviewState: evidenceReviewStateEnum("review_state").default("not_required").notNull(),
		extractorId: text("extractor_id").notNull(),
		extractorVersion: text("extractor_version").notNull(),
		identitySnapshot: jsonb("identity_snapshot").$type<unknown>().notNull(),
		matchEvidence: jsonb("match_evidence").$type<unknown>().notNull(),
		recommendationEvidence: jsonb("recommendation_evidence").$type<unknown>().notNull(),
		classificationEvidence: jsonb("classification_evidence").$type<unknown>().default({}).notNull(),
		extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		providerEntityUnique: uniqueIndex("entity_identity_evidence_provider_entity_unique").on(
			table.providerRunId,
			table.entityId,
		),
		correlationUnique: uniqueIndex("entity_identity_evidence_correlation_unique").on(table.correlationId),
		providerIdx: index("entity_identity_evidence_provider_run_idx").on(table.providerRunId),
	}),
).enableRLS();

/** Immutable, evidence-backed relationship between one citation and one entity claim. */
export const citationClaimEvidenceLinks = pgTable(
	"citation_claim_evidence_links",
	{
		id: uuid("id").primaryKey().notNull(),
		citationEvidenceId: uuid("citation_evidence_id")
			.references(() => citationEvidenceRecords.id, { onDelete: "cascade" })
			.notNull(),
		entityEvidenceId: uuid("entity_evidence_id")
			.references(() => entityIdentityEvidenceRecords.id, { onDelete: "cascade" })
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		correlationId: text("correlation_id").notNull(),
		claim: citationClaimTypeEnum("claim").notNull(),
		status: evidenceDecisionStatusEnum("status").notNull(),
		classifierId: text("classifier_id").notNull(),
		classifierVersion: text("classifier_version").notNull(),
		sourceExcerpt: text("source_excerpt").notNull(),
		excerptStart: integer("excerpt_start").notNull(),
		excerptEnd: integer("excerpt_end").notNull(),
		confidence: real("confidence").notNull(),
		reasonCodes: text("reason_codes").array().notNull(),
		sourceEvidenceIds: uuid("source_evidence_ids").array().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		citationEntityClaimUnique: uniqueIndex("citation_claim_evidence_link_unique").on(
			table.citationEvidenceId,
			table.entityEvidenceId,
			table.claim,
		),
		correlationUnique: uniqueIndex("citation_claim_evidence_correlation_unique").on(table.correlationId),
		entityIdx: index("citation_claim_evidence_entity_idx").on(table.entityEvidenceId),
	}),
).enableRLS();

/** Immutable likely failure-stage diagnosis derived only from canonical replay evidence. */
export const diagnosisFindings = pgTable(
	"diagnosis_findings",
	{
		id: uuid("id").primaryKey().notNull(),
		auditRunId: uuid("audit_run_id")
			.references(() => auditRuns.id, { onDelete: "cascade" })
			.notNull(),
		intentFamilyId: uuid("intent_family_id")
			.references(() => intentFamilies.id)
			.notNull(),
		promptVariantId: uuid("prompt_variant_id")
			.references(() => frozenPromptVariants.id)
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		findingVersion: integer("finding_version").notNull(),
		frozenPromptVersion: integer("frozen_prompt_version").notNull(),
		likelyFailureStage: diagnosisFailureStageEnum("likely_failure_stage").notNull(),
		confidence: real("confidence").notNull(),
		reasonCodes: text("reason_codes").array().notNull(),
		supportingEvidenceIds: uuid("supporting_evidence_ids").array().notNull(),
		contradictingEvidenceIds: uuid("contradicting_evidence_ids").array().notNull(),
		affectedProviderRunIds: uuid("affected_provider_run_ids").array().notNull(),
		reviewState: evidenceReviewStateEnum("review_state").notNull(),
		classifierId: text("classifier_id").notNull(),
		classifierVersion: text("classifier_version").notNull(),
		policyVersion: text("policy_version").notNull(),
		diagnosisEvidence: jsonb("diagnosis_evidence").$type<unknown>().notNull(),
		correlationId: text("correlation_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		auditIntentVersionUnique: uniqueIndex("diagnosis_findings_audit_intent_version_unique").on(
			table.auditRunId,
			table.intentFamilyId,
			table.findingVersion,
		),
		correlationUnique: uniqueIndex("diagnosis_findings_correlation_unique").on(table.correlationId),
		auditIdx: index("diagnosis_findings_audit_idx").on(table.auditRunId),
		intentIdx: index("diagnosis_findings_intent_idx").on(table.intentFamilyId),
	}),
).enableRLS();

/** Immutable action, MAINTAIN decision, or review instruction created only after a diagnosis finding. */
export const evidenceRemediations = pgTable(
	"evidence_remediations",
	{
		id: uuid("id").primaryKey().notNull(),
		auditRunId: uuid("audit_run_id")
			.references(() => auditRuns.id, { onDelete: "cascade" })
			.notNull(),
		primaryFindingId: uuid("primary_finding_id")
			.references(() => diagnosisFindings.id, { onDelete: "cascade" })
			.notNull(),
		linkedFindingIds: uuid("linked_finding_ids").array().notNull(),
		schemaVersion: integer("schema_version").notNull(),
		remediationVersion: integer("remediation_version").notNull(),
		actionCategory: remediationActionCategoryEnum("action_category").notNull(),
		rationale: text("rationale").notNull(),
		acceptanceCriteria: text("acceptance_criteria").array().notNull(),
		priority: remediationPriorityEnum("priority").notNull(),
		confidence: real("confidence").notNull(),
		expectedEvidenceChange: text("expected_evidence_change").array().notNull(),
		approvalState: remediationApprovalStateEnum("approval_state").notNull(),
		policyVersion: text("policy_version").notNull(),
		correlationId: text("correlation_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		findingVersionUnique: uniqueIndex("evidence_remediations_finding_version_unique").on(
			table.primaryFindingId,
			table.remediationVersion,
		),
		correlationUnique: uniqueIndex("evidence_remediations_correlation_unique").on(table.correlationId),
		auditIdx: index("evidence_remediations_audit_idx").on(table.auditRunId),
	}),
).enableRLS();

/** Immutable customer-report snapshot freezing the exact baseline evidence and policy inputs. */
export const frozenAuditReports = pgTable(
	"frozen_audit_reports",
	{
		id: uuid("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		baselineAuditRunId: uuid("baseline_audit_run_id")
			.references(() => auditRuns.id)
			.notNull(),
		schemaVersion: integer("schema_version").notNull(),
		reportVersion: integer("report_version").notNull(),
		baselineVersion: integer("baseline_version").notNull(),
		businessIdentitySnapshot: jsonb("business_identity_snapshot").$type<unknown>().notNull(),
		intentVersionSnapshot: jsonb("intent_version_snapshot").$type<unknown>().notNull(),
		promptVersionSnapshot: jsonb("prompt_version_snapshot").$type<unknown>().notNull(),
		providerVersionSnapshot: jsonb("provider_version_snapshot").$type<unknown>().notNull(),
		fixtureManifest: jsonb("fixture_manifest").$type<unknown>().notNull(),
		policyVersionSnapshot: jsonb("policy_version_snapshot").$type<unknown>().notNull(),
		decisionSnapshot: jsonb("decision_snapshot").$type<unknown>().notNull(),
		evidenceRecordIds: uuid("evidence_record_ids").array().notNull(),
		findingIds: uuid("finding_ids").array().notNull(),
		remediationIds: uuid("remediation_ids").array().notNull(),
		reportGenerationVersion: text("report_generation_version").notNull(),
		benchmarkVersion: text("benchmark_version").notNull(),
		snapshotChecksum: text("snapshot_checksum").notNull(),
		frozenAt: timestamp("frozen_at", { withTimezone: true }).notNull(),
		correlationId: text("correlation_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		baselineVersionUnique: uniqueIndex("frozen_audit_reports_baseline_version_unique").on(
			table.baselineAuditRunId,
			table.reportVersion,
		),
		correlationUnique: uniqueIndex("frozen_audit_reports_correlation_unique").on(table.correlationId),
		checksumUnique: uniqueIndex("frozen_audit_reports_checksum_unique").on(table.snapshotChecksum),
		brandFrozenIdx: index("frozen_audit_reports_brand_frozen_idx").on(table.brandId, table.frozenAt),
	}),
).enableRLS();

/** Immutable per-intent baseline-versus-retest observation tied to one frozen report. */
export const auditRetestComparisons = pgTable(
	"audit_retest_comparisons",
	{
		id: uuid("id").primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		frozenReportId: uuid("frozen_report_id")
			.references(() => frozenAuditReports.id)
			.notNull(),
		baselineAuditRunId: uuid("baseline_audit_run_id")
			.references(() => auditRuns.id)
			.notNull(),
		retestAuditRunId: uuid("retest_audit_run_id")
			.references(() => auditRuns.id)
			.notNull(),
		intentFamilyId: uuid("intent_family_id")
			.references(() => intentFamilies.id)
			.notNull(),
		findingId: uuid("finding_id").references(() => diagnosisFindings.id),
		remediationId: uuid("remediation_id").references(() => evidenceRemediations.id),
		schemaVersion: integer("schema_version").notNull(),
		comparisonVersion: integer("comparison_version").notNull(),
		outcome: auditComparisonOutcomeEnum("outcome").notNull(),
		confidence: real("confidence").notNull(),
		reasonCodes: text("reason_codes").array().notNull(),
		decisionState: retestDecisionStateEnum("decision_state").notNull(),
		promptVariantIds: uuid("prompt_variant_ids").array().notNull(),
		baselineEvidenceIds: uuid("baseline_evidence_ids").array().notNull(),
		retestEvidenceIds: uuid("retest_evidence_ids").array().notNull(),
		acceptanceCriteriaSnapshot: text("acceptance_criteria_snapshot").array().notNull(),
		expectedEvidenceChangeSnapshot: text("expected_evidence_change_snapshot").array().notNull(),
		criteriaEvaluation: jsonb("criteria_evaluation").$type<unknown>().notNull(),
		baselineMetrics: jsonb("baseline_metrics").$type<unknown>().notNull(),
		retestMetrics: jsonb("retest_metrics").$type<unknown>().notNull(),
		observedChanges: jsonb("observed_changes").$type<unknown>().notNull(),
		providerConfigurationSnapshot: jsonb("provider_configuration_snapshot").$type<unknown>().notNull(),
		comparatorId: text("comparator_id").notNull(),
		comparatorVersion: text("comparator_version").notNull(),
		comparisonChecksum: text("comparison_checksum").notNull(),
		correlationId: text("correlation_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		reportRetestIntentVersionUnique: uniqueIndex("audit_retest_comparisons_report_retest_intent_unique").on(
			table.frozenReportId,
			table.retestAuditRunId,
			table.intentFamilyId,
			table.comparisonVersion,
		),
		correlationUnique: uniqueIndex("audit_retest_comparisons_correlation_unique").on(table.correlationId),
		checksumUnique: uniqueIndex("audit_retest_comparisons_checksum_unique").on(table.comparisonChecksum),
		brandCreatedIdx: index("audit_retest_comparisons_brand_created_idx").on(table.brandId, table.createdAt),
		reportIdx: index("audit_retest_comparisons_report_idx").on(table.frozenReportId),
	}),
).enableRLS();

export const reports = pgTable(
	"reports",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandName: text("brand_name").notNull(),
		brandWebsite: text("brand_website").notNull(),
		status: reportStatusEnum().notNull().default("pending"),
		progress: integer("progress").notNull().default(0),
		rawOutput: json("raw_output"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => ({
		createdAtIdx: index("reports_created_at_idx").on(table.createdAt),
	}),
).enableRLS();

// One row per generated Opportunities report, per brand — append-only history
// (every generation is kept, not overwritten). The page reads the latest row and
// regenerates only when it's stale; see apps/web/src/server/opportunities.ts.
export const brandOpportunities = pgTable(
	"brand_opportunities",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id)
			.notNull(),
		/** The full enriched opportunities report the page renders (OpportunitiesReport JSON). */
		report: json("report").notNull(),
		/** Model/provider that generated it, when known. */
		model: text("model"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		brandCreatedIdx: index("brand_opportunities_brand_id_created_at_idx").on(table.brandId, table.createdAt),
	}),
).enableRLS();

export type BrandOpportunity = typeof brandOpportunities.$inferSelect;
export type NewBrandOpportunity = typeof brandOpportunities.$inferInsert;

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;

export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;

export type PromptRun = typeof promptRuns.$inferSelect;
export type NewPromptRun = typeof promptRuns.$inferInsert;

export type BrandWithPrompts = Brand & {
	prompts: Prompt[];
	competitors: Competitor[];
};

export type CitationRecord = typeof citations.$inferSelect;
export type NewCitationRecord = typeof citations.$inferInsert;

export type IntentFamily = typeof intentFamilies.$inferSelect;
export type NewIntentFamily = typeof intentFamilies.$inferInsert;
export type FrozenPromptVariant = typeof frozenPromptVariants.$inferSelect;
export type NewFrozenPromptVariant = typeof frozenPromptVariants.$inferInsert;
export type AuditRun = typeof auditRuns.$inferSelect;
export type NewAuditRun = typeof auditRuns.$inferInsert;
export type ProviderModelVersion = typeof providerModelVersions.$inferSelect;
export type NewProviderModelVersion = typeof providerModelVersions.$inferInsert;
export type ProviderRun = typeof providerRuns.$inferSelect;
export type NewProviderRun = typeof providerRuns.$inferInsert;
export type ProviderResponsePayload = typeof providerResponsePayloads.$inferSelect;
export type NewProviderResponsePayload = typeof providerResponsePayloads.$inferInsert;
export type CitationEvidenceRecord = typeof citationEvidenceRecords.$inferSelect;
export type NewCitationEvidenceRecord = typeof citationEvidenceRecords.$inferInsert;
export type EntityIdentityEvidenceRecord = typeof entityIdentityEvidenceRecords.$inferSelect;
export type NewEntityIdentityEvidenceRecord = typeof entityIdentityEvidenceRecords.$inferInsert;
export type CitationClaimEvidenceLink = typeof citationClaimEvidenceLinks.$inferSelect;
export type NewCitationClaimEvidenceLink = typeof citationClaimEvidenceLinks.$inferInsert;
export type DiagnosisFinding = typeof diagnosisFindings.$inferSelect;
export type NewDiagnosisFinding = typeof diagnosisFindings.$inferInsert;
export type EvidenceRemediation = typeof evidenceRemediations.$inferSelect;
export type NewEvidenceRemediation = typeof evidenceRemediations.$inferInsert;
export type FrozenAuditReport = typeof frozenAuditReports.$inferSelect;
export type NewFrozenAuditReport = typeof frozenAuditReports.$inferInsert;
export type AuditRetestComparison = typeof auditRetestComparisons.$inferSelect;
export type NewAuditRetestComparison = typeof auditRetestComparisons.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export const SYSTEM_TAGS = {
	BRANDED: "branded",
	UNBRANDED: "unbranded",
} as const;

export type SystemTag = (typeof SYSTEM_TAGS)[keyof typeof SYSTEM_TAGS];
