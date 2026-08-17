import { createHash } from "node:crypto";
import { z } from "zod";
import {
	classifyEntities,
	createUnverifiedCitationEvidence,
	ENTITY_CLASSIFIER_ID,
	ENTITY_CLASSIFIER_VERSION,
	normalizeHttpUrl,
	type CitationEvidenceV1,
	type EntityClassification,
	type EntityIdentityInput,
} from "./evidence";
import {
	diagnoseReplayEvidence,
	type DiagnosisFindingRecord,
	type DiagnosisResult,
	type RemediationRecord,
} from "./diagnosis";

export {
	DIAGNOSIS_CLASSIFIER_ID,
	DIAGNOSIS_CLASSIFIER_VERSION,
	DIAGNOSIS_RECORD_SCHEMA_VERSION,
	MINIMUM_REPEATED_EVIDENCE_RUNS,
	REMEDIATION_POLICY_VERSION,
} from "./diagnosis";
export type {
	CompetitorCitationGapWinner,
	DiagnosisEvidenceSummary,
	DiagnosisFindingRecord,
	LikelyFailureStage,
	RemediationActionCategory,
	RemediationRecord,
} from "./diagnosis";

export const AUDIT_RECORD_SCHEMA_VERSION = 2 as const;
export const REPLAY_FIXTURE_SCHEMA_VERSION = 3 as const;
export const REPLAY_EXTRACTOR_ID = "zentaviq-fixture-replay-extractor";
export const REPLAY_EXTRACTOR_VERSION = "2.0.0";
export const EVIDENCE_CLASSIFIER_ID = "zentaviq-deterministic-evidence-classifier";
export const EVIDENCE_CLASSIFIER_VERSION = "2.0.0";
export const REPLAY_PROVIDER_ID = "fixture-replay";
export const REPLAY_MODEL_ID = "zentaviq-replay";
export const REPLAY_MODEL_VERSION = "v0.1-failure-diagnosis";
export const HUMAN_REVIEW_CONFIDENCE_THRESHOLD = 0.75;

export type AuditRunKind = "baseline" | "audit";
export type AuditExecutionMode = "fixture_replay" | "live";
export type RetrievalStatus = "retrieved" | "not_retrieved";
export type CitationType = "first_party" | "independent" | "competitor" | "unknown";
export type EvidenceEntityRole = "brand" | "competitor" | "unknown";
export type EvidenceEntityType = "target_business" | "competitor" | "unrelated_unknown";
export type EvidenceDecisionStatus = "accepted" | "rejected" | "ambiguous" | "not_detected";
export type EvidenceReviewState = "not_required" | "pending" | "accepted" | "rejected";
export type CitationClaimType = "identity" | "mention" | "recommendation";
export type EvidenceSourceKind = "retrieval" | "identity_match" | "recommendation_cue" | "prominence" | "citation";

const fixtureCitationSchema = z
	.object({
		url: z.string(),
		title: z.string().min(1).optional(),
		supports: z
			.object({
				entityRole: z.enum(["brand", "competitor"]),
				claim: z.enum(["identity", "mention", "recommendation"]),
			})
			.strict()
			.optional(),
	})
	.strict();

export const replayProviderPayloadSchema = z
	.object({
		schemaVersion: z.literal(REPLAY_FIXTURE_SCHEMA_VERSION),
		retrieved: z.boolean(),
		responseText: z.string(),
		citations: z.array(fixtureCitationSchema),
	})
	.strict()
	.superRefine((payload, context) => {
		if (!payload.retrieved && (payload.responseText.length > 0 || payload.citations.length > 0)) {
			context.addIssue({
				code: "custom",
				message: "A not-retrieved fixture cannot contain response text or citations",
			});
		}
	});

export const replayFixtureSchema = z
	.object({
		fixtureId: z.string().min(1),
		fixtureVersion: z.literal(REPLAY_FIXTURE_SCHEMA_VERSION),
		capturedAt: z.string().datetime(),
		intent: z
			.object({
				key: z.string().min(1),
				version: z.number().int().positive(),
				name: z.string().min(1),
				description: z.string().min(1),
			})
			.strict(),
		prompt: z
			.object({
				version: z.number().int().positive(),
				text: z.string().min(1),
			})
			.strict(),
		provider: z
			.object({
				id: z.literal(REPLAY_PROVIDER_ID),
				model: z.literal(REPLAY_MODEL_ID),
				version: z.literal(REPLAY_MODEL_VERSION),
				metadata: z.record(z.string(), z.string()),
			})
			.strict(),
		classificationContext: z
			.object({
				sharedAlias: z.string().min(1).optional(),
				categoryTerms: z.array(z.string().min(1)),
			})
			.strict(),
		payload: replayProviderPayloadSchema,
	})
	.strict();

export type ReplayFixture = z.infer<typeof replayFixtureSchema>;

export interface ReplayBrandInput {
	id: string;
	name: string;
	website: string;
	aliases?: string[];
	additionalDomains?: string[];
}

export interface ReplayCompetitorInput {
	id: string;
	name: string;
	domains?: string[];
	aliases?: string[];
}

export interface ReplayAuditInput {
	brand: ReplayBrandInput;
	competitors: ReplayCompetitorInput[];
	correlationId: string;
	replayedAt: Date;
}

export interface IntentFamilyRecord {
	id: string;
	brandId: string;
	key: string;
	name: string;
	description: string;
	schemaVersion: number;
	version: number;
	createdAt: Date;
}

export interface FrozenPromptVariantRecord {
	id: string;
	intentFamilyId: string;
	sourcePromptId: string | null;
	promptText: string;
	promptChecksum: string;
	schemaVersion: number;
	version: number;
	frozenAt: Date;
	createdAt: Date;
}

export interface AuditRunRecord {
	id: string;
	brandId: string;
	runKind: AuditRunKind;
	executionMode: AuditExecutionMode;
	schemaVersion: number;
	correlationId: string;
	fixtureSetChecksum: string;
	startedAt: Date;
	completedAt: Date;
	createdAt: Date;
}

export interface ProviderModelVersionRecord {
	id: string;
	providerId: string;
	modelId: string;
	modelVersion: string;
	schemaVersion: number;
	metadata: Record<string, string>;
	recordedAt: Date;
}

export interface ProviderRunRecord {
	id: string;
	auditRunId: string;
	promptVariantId: string;
	providerModelVersionId: string;
	schemaVersion: number;
	executionMode: AuditExecutionMode;
	retrievalStatus: RetrievalStatus;
	correlationId: string;
	extractorId: string;
	extractorVersion: string;
	startedAt: Date;
	completedAt: Date;
	createdAt: Date;
}

export interface ProviderResponsePayloadRecord {
	id: string;
	providerRunId: string;
	schemaVersion: number;
	fixtureId: string;
	fixtureChecksum: string;
	payloadChecksum: string;
	rawPayload: z.infer<typeof replayProviderPayloadSchema>;
	fixtureCapturedAt: Date;
	replayedAt: Date;
	createdAt: Date;
}

export interface RecommendationEvidence {
	status: EvidenceDecisionStatus;
	rule: string;
	confidence: number;
	reasonCodes: string[];
	cue?: string;
	cueStart?: number;
	cueEnd?: number;
	entityMatchStart?: number;
	entityMatchEnd?: number;
}

export interface ClassificationSourceEvidence {
	id: string;
	kind: EvidenceSourceKind;
	disposition: Exclude<EvidenceDecisionStatus, "not_detected">;
	matchedIdentityTerm: string | null;
	matchedDomain: string | null;
	matchedAlias: string | null;
	matchRule: string;
	classifierId: string;
	classifierVersion: string;
	excerpt: string;
	start: number;
	end: number;
	confidence: number;
	reasonCodes: string[];
	sourceEvidenceIds: string[];
}

export interface ClassificationDecision {
	status: EvidenceDecisionStatus;
	value: boolean | number | string | null;
	rule: string;
	confidence: number;
	reasonCodes: string[];
	sourceEvidenceIds: string[];
}

export interface EntityClassificationTrace {
	schemaVersion: number;
	classifier: {
		id: string;
		version: string;
		deterministic: true;
	};
	entityType: EvidenceEntityType;
	review: {
		state: EvidenceReviewState;
		reasonCodes: string[];
	};
	decisions: {
		retrieved: ClassificationDecision;
		mentioned: ClassificationDecision;
		recommended: ClassificationDecision;
		prominence: ClassificationDecision;
		cited: ClassificationDecision;
		entityType: ClassificationDecision;
	};
	sources: ClassificationSourceEvidence[];
}

export interface CitationEvidenceRecord {
	id: string;
	providerRunId: string;
	responsePayloadId: string;
	schemaVersion: number;
	correlationId: string;
	citationIndex: number;
	citationType: CitationType;
	originalUrl: string;
	normalizedUrl: string | null;
	normalizedDomain: string | null;
	title: string | null;
	extractorId: string;
	extractorVersion: string;
	evidence: CitationEvidenceV1;
	extractedAt: Date;
}

export interface EntityIdentityEvidenceRecord {
	id: string;
	providerRunId: string;
	responsePayloadId: string;
	schemaVersion: number;
	correlationId: string;
	entityId: string;
	entityRole: EvidenceEntityRole;
	identityVersion: number;
	retrieved: boolean;
	mentioned: boolean;
	recommended: boolean;
	cited: boolean;
	prominenceRank: number | null;
	reviewState: EvidenceReviewState;
	extractorId: string;
	extractorVersion: string;
	identitySnapshot: EntityIdentityInput;
	matchEvidence: EntityClassification;
	recommendationEvidence: RecommendationEvidence;
	classificationEvidence: EntityClassificationTrace;
	extractedAt: Date;
}

export interface CitationClaimEvidenceLinkRecord {
	id: string;
	citationEvidenceId: string;
	entityEvidenceId: string;
	schemaVersion: number;
	correlationId: string;
	claim: CitationClaimType;
	status: EvidenceDecisionStatus;
	classifierId: string;
	classifierVersion: string;
	sourceExcerpt: string;
	excerptStart: number;
	excerptEnd: number;
	confidence: number;
	reasonCodes: string[];
	sourceEvidenceIds: string[];
	createdAt: Date;
}

export interface ReplayAuditBundle {
	intentFamilies: IntentFamilyRecord[];
	promptVariants: FrozenPromptVariantRecord[];
	auditRun: AuditRunRecord;
	providerModelVersions: ProviderModelVersionRecord[];
	providerRuns: ProviderRunRecord[];
	responsePayloads: ProviderResponsePayloadRecord[];
	citationEvidence: CitationEvidenceRecord[];
	entityEvidence: EntityIdentityEvidenceRecord[];
	citationClaimLinks: CitationClaimEvidenceLinkRecord[];
	findings: DiagnosisFindingRecord[];
	remediations: RemediationRecord[];
}

export interface ReplayAuditSummary {
	auditRunId: string;
	correlationId: string;
	fixtureCount: number;
	providerRunCount: number;
	entityEvidenceCount: number;
	citationEvidenceCount: number;
	citationClaimLinkCount: number;
	retrievedRuns: number;
	mentionedEntities: number;
	recommendedEntities: number;
	citedEntities: number;
	pendingReviewEntities: number;
	diagnosisFindingCount: number;
	remediationCount: number;
	maintainDecisionCount: number;
	diagnosisReviewCount: number;
	citationTypes: Record<CitationType, number>;
	completedAt: string;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value && typeof value === "object" && !(value instanceof Date)) {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, sortJson(child)]),
		);
	}
	if (value instanceof Date) return value.toISOString();
	return value;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

export function sha256(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function deterministicUuid(value: string): string {
	const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
	hex[12] = "5";
	hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function canonicalDomain(value: string): string | null {
	const candidate = value.trim();
	if (!candidate) return null;
	try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		return url.hostname
			.toLowerCase()
			.replace(/^www\./, "")
			.replace(/\.$/, "");
	} catch {
		return null;
	}
}

function isOwnedDomain(domain: string, ownedDomains: string[]): boolean {
	return ownedDomains.some((owned) => domain === owned || domain.endsWith(`.${owned}`));
}

function websiteDomain(brand: ReplayBrandInput): string {
	return canonicalDomain(brand.website) ?? "zentaviq.example";
}

function effectiveCompetitor(input: ReplayAuditInput): ReplayCompetitorInput {
	return (
		input.competitors[0] ?? {
			id: "fixture-competitor-ledger-labs",
			name: "Ledger Labs",
			domains: ["ledgerlabs.example"],
			aliases: [],
		}
	);
}

function providerMetadata() {
	return {
		id: REPLAY_PROVIDER_ID,
		model: REPLAY_MODEL_ID,
		version: REPLAY_MODEL_VERSION,
		metadata: {
			source: "bundled_fixture",
			networkAccess: "disabled",
			format: "zentaviq-replay-v1",
		},
	} as const;
}

export function createReplayFixtures(input: Pick<ReplayAuditInput, "brand" | "competitors">): ReplayFixture[] {
	const competitor = effectiveCompetitor({
		...input,
		correlationId: "fixture-template",
		replayedAt: new Date(0),
	});
	const brandDomain = websiteDomain(input.brand);
	const competitorDomain = canonicalDomain(competitor.domains?.[0] ?? "") ?? "ledgerlabs.example";
	const provider = providerMetadata();

	const baseContext = { categoryTerms: ["AI visibility platform", "AI visibility platforms"] };
	const fixtures: ReplayFixture[] = [
		{
			fixtureId: "strong-business-first-party-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:00:00.000Z",
			intent: {
				key: "strong-business-match",
				version: 1,
				name: "Strong business match",
				description: "A specific recommendation with first-party source evidence.",
			},
			prompt: {
				version: 1,
				text: "Which AI visibility platform is a strong fit for an evidence-led marketing team?",
			},
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `I recommend ${input.brand.name} for an evidence-led team. Its official source is ${brandDomain}.`,
				citations: [
					{
						url: `https://${brandDomain}/evidence-led-audits`,
						title: `${input.brand.name} evidence-led audits`,
					},
				],
			},
		},
		{
			fixtureId: "competitor-recommendation-citation-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:01:00.000Z",
			intent: {
				key: "competitor-comparison",
				version: 1,
				name: "Competitor comparison",
				description: "A competitor recommendation backed by a competitor-owned citation.",
			},
			prompt: {
				version: 1,
				text: "Which competing AI visibility product is recommended for workflow depth?",
			},
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `For workflow depth, I recommend ${competitor.name}. Product details are published at ${competitorDomain}.`,
				citations: [
					{
						url: `https://${competitorDomain}/product`,
						title: `${competitor.name} product overview`,
					},
				],
			},
		},
		{
			fixtureId: "broad-category-ambiguity-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:02:00.000Z",
			intent: {
				key: "broad-category-discovery",
				version: 1,
				name: "Portable workstation category ambiguity",
				description: "A broad portable-workstation answer that does not resolve a tracked entity.",
			},
			prompt: {
				version: 1,
				text: "What is the best portable workstation for a field research team?",
			},
			provider,
			classificationContext: { categoryTerms: ["portable workstation", "portable workstations"] },
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText:
					"Portable workstation can mean a rugged laptop, compact desktop, or mobile lab. Clarify workload and travel constraints before selecting a product. Source: https://industry.example/portable-workstations.",
				citations: [
					{
						url: "https://industry.example/portable-workstations",
						title: "Portable workstation landscape",
					},
				],
			},
		},
		{
			fixtureId: "no-retrieval-no-mention-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:03:00.000Z",
			intent: {
				key: "unanswered-query",
				version: 1,
				name: "No retrieval",
				description: "A provider run with no retrieved answer, mention, recommendation, or citation.",
			},
			prompt: {
				version: 1,
				text: "Return an answer only if sufficient evidence is available.",
			},
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: false,
				responseText: "",
				citations: [],
			},
		},
		{
			fixtureId: "mention-without-recommendation-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:04:00.000Z",
			intent: {
				key: "mention-without-recommendation",
				version: 1,
				name: "Mention without recommendation",
				description: "A target identity mention without any recommendation cue.",
			},
			prompt: { version: 1, text: "Which products appear in the AI visibility market overview?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `${input.brand.name} appears in the market overview alongside several established tools.`,
				citations: [],
			},
		},
		{
			fixtureId: "recommendation-low-prominence-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:05:00.000Z",
			intent: {
				key: "recommendation-low-prominence",
				version: 1,
				name: "Recommendation with low prominence",
				description: "A positive target recommendation at explicit rank three.",
			},
			prompt: { version: 1, text: "Rank three AI visibility products for a small evidence team." },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `1. MarketScope\n2. Signal Atlas\n3. I recommend ${input.brand.name} for teams that prioritize evidence.`,
				citations: [],
			},
		},
		{
			fixtureId: "competitor-ranked-above-target-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:06:00.000Z",
			intent: {
				key: "competitor-ranked-above-target",
				version: 1,
				name: "Competitor above target",
				description: "An explicit ranking where the competitor precedes the target.",
			},
			prompt: { version: 1, text: "Rank the strongest workflow options." },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `1. I recommend ${competitor.name} for workflow depth.\n2. I recommend ${input.brand.name} as another credible option.`,
				citations: [],
			},
		},
		{
			fixtureId: "alias-name-collision-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:07:00.000Z",
			intent: {
				key: "alias-name-collision",
				version: 1,
				name: "Alias and name collision",
				description: "A shared alias that cannot be assigned to either tracked identity automatically.",
			},
			prompt: { version: 1, text: "Is Visibility Core recommended?" },
			provider,
			classificationContext: { ...baseContext, sharedAlias: "Visibility Core" },
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: "I recommend Visibility Core for teams that need detailed workflow controls.",
				citations: [],
			},
		},
		{
			fixtureId: "target-domain-citation-without-recommendation-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:08:00.000Z",
			intent: {
				key: "target-domain-citation-without-recommendation",
				version: 1,
				name: "Target citation without recommendation",
				description: "A target-owned domain is cited without a target name or recommendation.",
			},
			prompt: { version: 1, text: "Provide source material about evidence-led audits." },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `Reference material is available at https://${brandDomain}/research.`,
				citations: [{ url: `https://${brandDomain}/research`, title: "Evidence-led audit research" }],
			},
		},
		{
			fixtureId: "unrelated-citation-near-target-mention-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:09:00.000Z",
			intent: {
				key: "unrelated-citation-near-target-mention",
				version: 1,
				name: "Unrelated citation near target",
				description: "An independent source sits near a target mention but does not support that target claim.",
			},
			prompt: { version: 1, text: "Which products are discussed in current category coverage?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `${input.brand.name} is included in this overview. General category context: https://neutral-source.example/market.`,
				citations: [{ url: "https://neutral-source.example/market", title: "General software market" }],
			},
		},
		{
			fixtureId: "ambiguous-category-human-review-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:10:00.000Z",
			intent: {
				key: "ambiguous-category-human-review",
				version: 1,
				name: "Ambiguous category language",
				description: "Category-only language that requires human review rather than an inferred target match.",
			},
			prompt: { version: 1, text: "Are AI visibility platforms useful for evidence teams?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText:
					"AI visibility platforms can help evidence teams, but the category wording does not identify a specific business.",
				citations: [],
			},
		},
		{
			fixtureId: "no-target-retrieval-v2",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:11:00.000Z",
			intent: {
				key: "no-target-retrieval",
				version: 1,
				name: "No target retrieval",
				description: "The response retrieves a competitor but contains no target evidence.",
			},
			prompt: { version: 1, text: "Which workflow product was retrieved for this query?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `Only ${competitor.name} was retrieved for this query.`,
				citations: [],
			},
		},
		{
			fixtureId: "target-recommended-without-citation-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:12:00.000Z",
			intent: {
				key: "target-recommended-without-citation",
				version: 1,
				name: "Target recommendation without support",
				description: "A top-ranked target recommendation with no citation-to-claim support.",
			},
			prompt: { version: 1, text: "Which evidence platform is the best fit for a focused audit team?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `1. I recommend ${input.brand.name} for a focused audit team.`,
				citations: [],
			},
		},
		{
			fixtureId: "competitor-independent-support-a-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:13:00.000Z",
			intent: {
				key: "repeated-competitor-independent-support",
				version: 4,
				name: "Repeated competitor independent support",
				description: "A losing intent where independent evidence explicitly supports the competitor.",
			},
			prompt: { version: 4, text: "Which workflow platform has independently supported operational depth?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `Independent testing recommends ${competitor.name} for operational depth. See https://research-one.example/workflow-depth.`,
				citations: [
					{
						url: "https://research-one.example/workflow-depth",
						title: "Independent workflow-depth study",
						supports: { entityRole: "competitor", claim: "recommendation" },
					},
				],
			},
		},
		{
			fixtureId: "competitor-independent-support-b-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:14:00.000Z",
			intent: {
				key: "repeated-competitor-independent-support",
				version: 4,
				name: "Repeated competitor independent support",
				description: "A losing intent where independent evidence explicitly supports the competitor.",
			},
			prompt: { version: 5, text: "Which workflow platform is independently recommended for control depth?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `A separate benchmark recommends ${competitor.name} for control depth. See https://research-two.example/control-benchmark.`,
				citations: [
					{
						url: "https://research-two.example/control-benchmark",
						title: "Independent control benchmark",
						supports: { entityRole: "competitor", claim: "recommendation" },
					},
				],
			},
		},
		{
			fixtureId: "substantial-first-party-independent-gap-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:15:00.000Z",
			intent: {
				key: "substantial-first-party-independent-gap",
				version: 1,
				name: "Substantial first-party evidence",
				description: "The target has substantial first-party content but lacks requested independent support.",
			},
			prompt: { version: 1, text: "Which platform has independent evidence for an evidence-led audit program?" },
			provider,
			classificationContext: baseContext,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText: `I recommend ${input.brand.name}. Its substantial first-party library is documented at https://${brandDomain}/research and https://${brandDomain}/customers.`,
				citations: [
					{ url: `https://${brandDomain}/research`, title: "Research library" },
					{ url: `https://${brandDomain}/customers`, title: "Customer evidence" },
				],
			},
		},
		{
			fixtureId: "repeated-retrieval-failure-a-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:16:00.000Z",
			intent: {
				key: "repeated-retrieval-failure",
				version: 4,
				name: "Repeated retrieval failure",
				description: "Multiple frozen prompts fail before entity-level evidence is available.",
			},
			prompt: { version: 4, text: "Retrieve the technical-access audit evidence sample A." },
			provider,
			classificationContext: baseContext,
			payload: { schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION, retrieved: false, responseText: "", citations: [] },
		},
		{
			fixtureId: "repeated-retrieval-failure-b-v3",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:17:00.000Z",
			intent: {
				key: "repeated-retrieval-failure",
				version: 4,
				name: "Repeated retrieval failure",
				description: "Multiple frozen prompts fail before entity-level evidence is available.",
			},
			prompt: { version: 5, text: "Retrieve the technical-access audit evidence sample B." },
			provider,
			classificationContext: baseContext,
			payload: { schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION, retrieved: false, responseText: "", citations: [] },
		},
	];

	return fixtures.map((fixture) =>
		replayFixtureSchema.parse({
			...fixture,
			intent: { ...fixture.intent, version: fixture.intent.version === 1 ? 3 : fixture.intent.version },
			prompt: { ...fixture.prompt, version: fixture.prompt.version === 1 ? 3 : fixture.prompt.version },
		}),
	);
}

function baseEntityIdentities(input: ReplayAuditInput, fixture: ReplayFixture): EntityIdentityInput[] {
	const brandDomains = [input.brand.website, ...(input.brand.additionalDomains ?? [])]
		.map(canonicalDomain)
		.filter((domain): domain is string => Boolean(domain));
	const replayCompetitors = input.competitors.length > 0 ? input.competitors : [effectiveCompetitor(input)];
	const sharedAliases = fixture.classificationContext.sharedAlias ? [fixture.classificationContext.sharedAlias] : [];
	return [
		{
			id: `brand:${input.brand.id}`,
			role: "brand",
			name: input.brand.name,
			aliases: [...(input.brand.aliases ?? []), ...sharedAliases],
			domains: brandDomains,
			contextTerms: fixture.classificationContext.categoryTerms,
		},
		...replayCompetitors.map((competitor) => ({
			id: `competitor:${competitor.id}`,
			role: "competitor" as const,
			name: competitor.name,
			aliases: [...(competitor.aliases ?? []), ...sharedAliases],
			domains: (competitor.domains ?? []).map(canonicalDomain).filter((domain): domain is string => Boolean(domain)),
			contextTerms: [],
		})),
	];
}

function entityIdentities(input: ReplayAuditInput, fixture: ReplayFixture): EntityIdentityInput[] {
	const tracked = baseEntityIdentities(input, fixture);
	const trackedDomains = tracked.flatMap((identity) => identity.domains ?? []);
	const unknownDomains = fixture.payload.citations
		.map((citation) => normalizeHttpUrl(citation.url))
		.filter(
			(citation): citation is Extract<ReturnType<typeof normalizeHttpUrl>, { status: "normalized" }> =>
				citation.status === "normalized",
		)
		.map((citation) => citation.normalizedDomain)
		.filter((domain) => !isOwnedDomain(domain, trackedDomains));
	return [
		...tracked,
		...[...new Set(unknownDomains)].map(
			(domain): EntityIdentityInput => ({
				id: `unknown-domain:${domain}`,
				role: "unknown",
				name: domain,
				aliases: [],
				domains: [domain],
				contextTerms: [],
			}),
		),
	];
}

function sentenceBounds(content: string, offset: number): { start: number; end: number } {
	let start = offset;
	while (start > 0 && !/[.!?\n]/u.test(content[start - 1])) start--;
	let end = offset;
	while (end < content.length && !/[.!?\n]/u.test(content[end])) end++;
	return { start, end };
}

function recommendationFor(content: string, classification: EntityClassification): RecommendationEvidence {
	const eligibleMatches = classification.acceptedMatches.filter((match) => match.source !== "domain");
	for (const entityMatch of eligibleMatches) {
		const sentence = sentenceBounds(content, entityMatch.start);
		const sentenceText = content.slice(sentence.start, sentence.end);
		const cuePattern = /\b(?:recommend(?:ed|s|ing)?|top choice|best option)\b/giu;
		for (const cueMatch of sentenceText.matchAll(cuePattern)) {
			const relativeStart = cueMatch.index ?? 0;
			const cueStart = sentence.start + relativeStart;
			const cue = cueMatch[0];
			const preceding = content.slice(Math.max(sentence.start, cueStart - 24), cueStart);
			if (/\b(?:not|never|avoid|cannot|can't|do not|don't)\b/iu.test(preceding)) {
				return {
					status: "rejected",
					rule: "same_sentence_negated_recommendation_cue",
					confidence: 0.95,
					reasonCodes: ["recommendation_cue_negated"],
					cue,
					cueStart,
					cueEnd: cueStart + cue.length,
					entityMatchStart: entityMatch.start,
					entityMatchEnd: entityMatch.end,
				};
			}
			if (/\b(?:might|may|could|possibly|perhaps|consider)\b/iu.test(preceding)) {
				return {
					status: "ambiguous",
					rule: "same_sentence_uncertain_recommendation_cue",
					confidence: 0.6,
					reasonCodes: ["uncertain_recommendation_language", "human_review_required"],
					cue,
					cueStart,
					cueEnd: cueStart + cue.length,
					entityMatchStart: entityMatch.start,
					entityMatchEnd: entityMatch.end,
				};
			}
			return {
				status: "accepted",
				rule: "same_sentence_positive_recommendation_cue",
				confidence: 0.94,
				reasonCodes: ["positive_recommendation_cue", "accepted_identity_in_same_sentence"],
				cue,
				cueStart,
				cueEnd: cueStart + cue.length,
				entityMatchStart: entityMatch.start,
				entityMatchEnd: entityMatch.end,
			};
		}
	}
	if (
		classification.rejectedMatches.length > 0 &&
		/\b(?:recommend(?:ed|s|ing)?|top choice|best option)\b/iu.test(content)
	) {
		return {
			status: "ambiguous",
			rule: "recommendation_cue_with_ambiguous_identity_match",
			confidence: 0.5,
			reasonCodes: ["identity_match_not_accepted", "human_review_required"],
		};
	}
	return {
		status: "not_detected",
		rule: "no_positive_recommendation_cue_for_accepted_identity_match",
		confidence: 1,
		reasonCodes: ["no_recommendation_cue_linked_to_entity"],
	};
}

function excerptForSpan(content: string, start: number, end: number): { excerpt: string; start: number; end: number } {
	const radius = 70;
	const excerptStart = Math.max(0, start - radius);
	const excerptEnd = Math.min(content.length, Math.max(end, start) + radius);
	return { excerpt: content.slice(excerptStart, excerptEnd), start: excerptStart, end: excerptEnd };
}

function explicitProminenceRank(content: string, matchStart: number): number | null {
	const lineStart = content.lastIndexOf("\n", matchStart - 1) + 1;
	const prefix = content.slice(lineStart, matchStart);
	const ordinal = prefix.match(/^\s*(\d{1,3})[.)]\s/u);
	return ordinal ? Number.parseInt(ordinal[1], 10) : null;
}

function prominenceRanks(content: string, classifications: EntityClassification[]): Map<string, number> {
	const ranks = new Map<string, number>();
	const proseMatches = classifications
		.map((classification) => ({
			classification,
			match: classification.acceptedMatches.find((match) => match.source !== "domain"),
		}))
		.filter(
			(
				entry,
			): entry is { classification: EntityClassification; match: EntityClassification["acceptedMatches"][number] } =>
				Boolean(entry.match),
		)
		.sort((left, right) => left.match.start - right.match.start);
	for (const [index, entry] of proseMatches.entries()) {
		ranks.set(entry.classification.identity.id, explicitProminenceRank(content, entry.match.start) ?? index + 1);
	}
	return ranks;
}

function entityTypeFor(role: EvidenceEntityRole): EvidenceEntityType {
	if (role === "brand") return "target_business";
	if (role === "competitor") return "competitor";
	return "unrelated_unknown";
}

function decision(
	status: EvidenceDecisionStatus,
	value: boolean | number | string | null,
	rule: string,
	confidence: number,
	reasonCodes: string[],
	sourceEvidenceIds: string[],
): ClassificationDecision {
	return { status, value, rule, confidence, reasonCodes, sourceEvidenceIds };
}

function sourceFromIdentityMatch(
	providerRunId: string,
	classification: EntityClassification,
	match: EntityClassification["acceptedMatches"][number] | EntityClassification["rejectedMatches"][number],
	index: number,
): ClassificationSourceEvidence {
	const isAccepted = match.disposition === "accepted";
	const ambiguous =
		!isAccepted && ["ambiguous_without_corroboration", "identity_collision"].includes(match.rejectionReason);
	return {
		id: deterministicUuid(
			`classification-source:${providerRunId}:${classification.identity.id}:${match.source}:${match.start}:${match.end}:${index}`,
		),
		kind: "identity_match",
		disposition: isAccepted ? "accepted" : ambiguous ? "ambiguous" : "rejected",
		matchedIdentityTerm: match.source === "domain" ? null : match.matchedTerm,
		matchedDomain: match.source === "domain" ? match.matchedTerm : null,
		matchedAlias: match.source === "alias" ? match.matchedTerm : null,
		matchRule: match.rule,
		classifierId: ENTITY_CLASSIFIER_ID,
		classifierVersion: ENTITY_CLASSIFIER_VERSION,
		excerpt: match.excerpt,
		start: match.excerptStart,
		end: match.excerptEnd,
		confidence: match.confidence,
		reasonCodes: isAccepted ? ["identity_match_accepted"] : [match.rejectionReason],
		sourceEvidenceIds: [],
	};
}

function categoryAmbiguitySource(
	providerRunId: string,
	content: string,
	classification: EntityClassification,
): ClassificationSourceEvidence | null {
	if (classification.identity.role !== "brand" || classification.acceptedMatches.length > 0) return null;
	const lower = content.toLocaleLowerCase("en");
	for (const term of [...classification.identity.contextTerms].sort((left, right) => right.length - left.length)) {
		const start = lower.indexOf(term.toLocaleLowerCase("en"));
		if (start < 0) continue;
		const end = start + term.length;
		const excerpt = excerptForSpan(content, start, end);
		return {
			id: deterministicUuid(
				`classification-source:${providerRunId}:${classification.identity.id}:category:${start}:${end}`,
			),
			kind: "identity_match",
			disposition: "ambiguous",
			matchedIdentityTerm: term,
			matchedDomain: null,
			matchedAlias: null,
			matchRule: "category_language_does_not_establish_business_identity",
			classifierId: EVIDENCE_CLASSIFIER_ID,
			classifierVersion: EVIDENCE_CLASSIFIER_VERSION,
			excerpt: excerpt.excerpt,
			start: excerpt.start,
			end: excerpt.end,
			confidence: 0.35,
			reasonCodes: ["category_language_only", "specific_business_identity_missing", "human_review_required"],
			sourceEvidenceIds: [],
		};
	}
	return null;
}

function refreshReview(trace: EntityClassificationTrace): void {
	const ambiguousDecisions = Object.entries(trace.decisions)
		.filter(([, value]) => value.status === "ambiguous")
		.map(([key]) => `ambiguous_${key}`);
	const lowConfidence = trace.sources.some(
		(source) => source.disposition !== "rejected" && source.confidence < HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
	);
	const reasonCodes = [...ambiguousDecisions];
	if (lowConfidence) reasonCodes.push("low_confidence_evidence");
	trace.review = {
		state: reasonCodes.length > 0 ? "pending" : "not_required",
		reasonCodes,
	};
}

function initialClassificationTrace(input: {
	providerRunId: string;
	content: string;
	providerRetrieved: boolean;
	classification: EntityClassification;
	prominenceRank: number | null;
}): { trace: EntityClassificationTrace; recommendation: RecommendationEvidence } {
	const { providerRunId, content, providerRetrieved, classification, prominenceRank } = input;
	const identitySources = [
		...classification.acceptedMatches.map((match, index) =>
			sourceFromIdentityMatch(providerRunId, classification, match, index),
		),
		...classification.rejectedMatches.map((match, index) =>
			sourceFromIdentityMatch(providerRunId, classification, match, classification.acceptedMatches.length + index),
		),
	];
	const categorySource = categoryAmbiguitySource(providerRunId, content, classification);
	if (categorySource) identitySources.push(categorySource);
	const acceptedIdentitySources = identitySources.filter((source) => source.disposition === "accepted");
	const acceptedMentionSources = acceptedIdentitySources.filter((source) => source.matchedDomain === null);
	const ambiguousSources = identitySources.filter((source) => source.disposition === "ambiguous");
	const recommendation = recommendationFor(content, classification);
	const sources = [...identitySources];
	let recommendationSourceIds: string[] = [];
	if (recommendation.status !== "not_detected") {
		const cueStart = recommendation.cueStart ?? classification.rejectedMatches[0]?.start ?? 0;
		const cueEnd = recommendation.cueEnd ?? classification.rejectedMatches[0]?.end ?? cueStart;
		const entityStart = recommendation.entityMatchStart ?? cueStart;
		const entityEnd = recommendation.entityMatchEnd ?? cueEnd;
		const excerpt = excerptForSpan(content, Math.min(cueStart, entityStart), Math.max(cueEnd, entityEnd));
		const source: ClassificationSourceEvidence = {
			id: deterministicUuid(`classification-source:${providerRunId}:${classification.identity.id}:recommendation`),
			kind: "recommendation_cue",
			disposition:
				recommendation.status === "accepted"
					? "accepted"
					: recommendation.status === "ambiguous"
						? "ambiguous"
						: "rejected",
			matchedIdentityTerm: classification.identity.name,
			matchedDomain: null,
			matchedAlias: null,
			matchRule: recommendation.rule,
			classifierId: EVIDENCE_CLASSIFIER_ID,
			classifierVersion: EVIDENCE_CLASSIFIER_VERSION,
			excerpt: excerpt.excerpt,
			start: excerpt.start,
			end: excerpt.end,
			confidence: recommendation.confidence,
			reasonCodes: recommendation.reasonCodes,
			sourceEvidenceIds: ambiguousSources.map((candidate) => candidate.id),
		};
		sources.push(source);
		recommendationSourceIds = [source.id];
	}

	let prominenceSourceIds: string[] = [];
	if (prominenceRank !== null) {
		const identitySource = acceptedMentionSources[0];
		if (identitySource) {
			const source: ClassificationSourceEvidence = {
				...identitySource,
				id: deterministicUuid(`classification-source:${providerRunId}:${classification.identity.id}:prominence`),
				kind: "prominence",
				matchRule: explicitProminenceRank(content, classification.acceptedMatches[0]?.start ?? 0)
					? "explicit_ordinal_rank"
					: "accepted_entity_mention_order",
				reasonCodes: [`prominence_rank_${prominenceRank}`],
				sourceEvidenceIds: [identitySource.id],
			};
			sources.push(source);
			prominenceSourceIds = [source.id];
		}
	}

	const mentionDecision =
		acceptedMentionSources.length > 0
			? decision(
					"accepted",
					true,
					"accepted_name_or_alias_identity_match",
					0.94,
					["specific_identity_mentioned"],
					acceptedMentionSources.map((source) => source.id),
				)
			: ambiguousSources.length > 0
				? decision(
						"ambiguous",
						null,
						"identity_match_requires_human_review",
						0.5,
						["identity_not_safely_resolved"],
						ambiguousSources.map((source) => source.id),
					)
				: decision("not_detected", false, "no_name_or_alias_identity_match", 1, ["no_specific_entity_mention"], []);
	const retrievalDecision = !providerRetrieved
		? decision("rejected", false, "provider_returned_no_response", 1, ["provider_response_not_retrieved"], [])
		: acceptedIdentitySources.length > 0
			? decision(
					"accepted",
					true,
					"accepted_identity_evidence_retrieved",
					0.95,
					["entity_identity_evidence_present"],
					acceptedIdentitySources.map((source) => source.id),
				)
			: ambiguousSources.length > 0
				? decision(
						"ambiguous",
						null,
						"retrieval_identity_ambiguous",
						0.5,
						["retrieved_response_has_ambiguous_identity_evidence"],
						ambiguousSources.map((source) => source.id),
					)
				: decision(
						"not_detected",
						false,
						"no_entity_retrieval_evidence",
						1,
						["entity_absent_from_retrieved_response"],
						[],
					);
	const recommendationDecision = decision(
		recommendation.status,
		recommendation.status === "accepted" ? true : recommendation.status === "ambiguous" ? null : false,
		recommendation.rule,
		recommendation.confidence,
		recommendation.reasonCodes,
		recommendationSourceIds,
	);
	const entityType = entityTypeFor(classification.identity.role);
	const trace: EntityClassificationTrace = {
		schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
		classifier: { id: EVIDENCE_CLASSIFIER_ID, version: EVIDENCE_CLASSIFIER_VERSION, deterministic: true },
		entityType,
		review: { state: "not_required", reasonCodes: [] },
		decisions: {
			retrieved: retrievalDecision,
			mentioned: mentionDecision,
			recommended: recommendationDecision,
			prominence:
				prominenceRank === null
					? decision("not_detected", null, "no_accepted_prose_mention_to_rank", 1, ["prominence_not_available"], [])
					: decision(
							"accepted",
							prominenceRank,
							"deterministic_response_rank",
							0.95,
							[`rank_${prominenceRank}`],
							prominenceSourceIds,
						),
			cited: decision("not_detected", false, "no_supporting_citation_link", 1, ["citation_support_not_linked"], []),
			entityType: decision(
				"accepted",
				entityType,
				"configured_identity_role",
				1,
				[`entity_type_${entityType}`],
				acceptedIdentitySources.map((source) => source.id),
			),
		},
		sources,
	};
	refreshReview(trace);
	return { trace, recommendation };
}

function citationSourceSpan(
	content: string,
	citation: CitationEvidenceRecord,
	entity: EntityIdentityEvidenceRecord,
): { excerpt: string; start: number; end: number } {
	const candidates = [citation.originalUrl, citation.normalizedUrl, citation.normalizedDomain].filter(
		(value): value is string => Boolean(value),
	);
	for (const candidate of candidates) {
		const start = content.toLocaleLowerCase("en").indexOf(candidate.toLocaleLowerCase("en"));
		if (start >= 0) return excerptForSpan(content, start, start + candidate.length);
	}
	const match = entity.matchEvidence.acceptedMatches[0] ?? entity.matchEvidence.rejectedMatches[0];
	if (match) return { excerpt: match.excerpt, start: match.excerptStart, end: match.excerptEnd };
	return { excerpt: "", start: 0, end: 0 };
}

function createCitationClaimLink(input: {
	providerCorrelationId: string;
	citation: CitationEvidenceRecord;
	entity: EntityIdentityEvidenceRecord;
	claim: CitationClaimType;
	status: EvidenceDecisionStatus;
	reasonCodes: string[];
	confidence: number;
	content: string;
	createdAt: Date;
}): CitationClaimEvidenceLinkRecord {
	const id = deterministicUuid(`citation-claim:${input.citation.id}:${input.entity.id}:${input.claim}:${input.status}`);
	const span = citationSourceSpan(input.content, input.citation, input.entity);
	return {
		id,
		citationEvidenceId: input.citation.id,
		entityEvidenceId: input.entity.id,
		schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
		correlationId: `${input.providerCorrelationId}:citation-claim:${id}`,
		claim: input.claim,
		status: input.status,
		classifierId: EVIDENCE_CLASSIFIER_ID,
		classifierVersion: EVIDENCE_CLASSIFIER_VERSION,
		sourceExcerpt: span.excerpt,
		excerptStart: span.start,
		excerptEnd: span.end,
		confidence: input.confidence,
		reasonCodes: input.reasonCodes,
		sourceEvidenceIds: [input.citation.id],
		createdAt: input.createdAt,
	};
}

function applyCitationLinksToEntity(
	entity: EntityIdentityEvidenceRecord,
	links: CitationClaimEvidenceLinkRecord[],
	citationsById: Map<string, CitationEvidenceRecord>,
): void {
	const entityLinks = links.filter((link) => link.entityEvidenceId === entity.id);
	for (const link of entityLinks) {
		const citation = citationsById.get(link.citationEvidenceId);
		entity.classificationEvidence.sources.push({
			id: link.id,
			kind: "citation",
			disposition: link.status === "accepted" ? "accepted" : link.status === "ambiguous" ? "ambiguous" : "rejected",
			matchedIdentityTerm: entity.identitySnapshot.name,
			matchedDomain: citation?.normalizedDomain ?? null,
			matchedAlias: null,
			matchRule: link.reasonCodes[0] ?? "citation_claim_link",
			classifierId: link.classifierId,
			classifierVersion: link.classifierVersion,
			excerpt: link.sourceExcerpt,
			start: link.excerptStart,
			end: link.excerptEnd,
			confidence: link.confidence,
			reasonCodes: link.reasonCodes,
			sourceEvidenceIds: link.sourceEvidenceIds,
		});
	}
	const accepted = entityLinks.filter((link) => link.status === "accepted");
	const ambiguous = entityLinks.filter((link) => link.status === "ambiguous");
	const rejected = entityLinks.filter((link) => link.status === "rejected");
	entity.classificationEvidence.decisions.cited =
		accepted.length > 0
			? decision(
					"accepted",
					true,
					"accepted_citation_entity_claim_link",
					0.99,
					["citation_link_supports_entity_identity"],
					accepted.map((link) => link.id),
				)
			: ambiguous.length > 0
				? decision(
						"ambiguous",
						null,
						"citation_entity_claim_requires_review",
						0.5,
						["citation_link_ambiguous"],
						ambiguous.map((link) => link.id),
					)
				: rejected.length > 0
					? decision(
							"rejected",
							false,
							"citation_does_not_support_entity_claim",
							0.98,
							["citation_present_but_not_linked_to_entity"],
							rejected.map((link) => link.id),
						)
					: decision("not_detected", false, "no_citation_entity_claim_link", 1, ["no_citation_support_for_entity"], []);
	if (
		entity.classificationEvidence.decisions.retrieved.status !== "accepted" &&
		entity.classificationEvidence.decisions.cited.status === "accepted"
	) {
		entity.classificationEvidence.decisions.retrieved = decision(
			"accepted",
			true,
			"accepted_owned_domain_citation_retrieval",
			0.99,
			["entity_retrieved_through_owned_domain_citation"],
			accepted.map((link) => link.id),
		);
	}
	entity.retrieved = entity.classificationEvidence.decisions.retrieved.status === "accepted";
	entity.mentioned = entity.classificationEvidence.decisions.mentioned.status === "accepted";
	entity.recommended = entity.classificationEvidence.decisions.recommended.status === "accepted";
	entity.cited = entity.classificationEvidence.decisions.cited.status === "accepted";
	refreshReview(entity.classificationEvidence);
	entity.reviewState = entity.classificationEvidence.review.state;
}

export function classifyCitationType(url: string, brandDomains: string[], competitorDomains: string[]): CitationType {
	const normalized = normalizeHttpUrl(url);
	if (normalized.status !== "normalized") return "unknown";
	if (isOwnedDomain(normalized.normalizedDomain, brandDomains)) return "first_party";
	if (isOwnedDomain(normalized.normalizedDomain, competitorDomains)) return "competitor";
	return "independent";
}

export function createReplayAuditBundle(input: ReplayAuditInput): ReplayAuditBundle {
	if (!input.correlationId.trim()) throw new Error("A replay correlation ID is required");
	if (Number.isNaN(input.replayedAt.getTime())) throw new Error("A valid replay timestamp is required");

	const fixtures = createReplayFixtures(input);
	const fixtureSetChecksum = sha256(fixtures);
	const auditRunId = deterministicUuid(`audit-run:${input.correlationId}`);
	const configuredIdentities = baseEntityIdentities(input, fixtures[0]);
	const brandDomains = configuredIdentities
		.filter((identity) => identity.role === "brand")
		.flatMap((identity) => identity.domains ?? []);
	const competitorDomains = configuredIdentities
		.filter((identity) => identity.role === "competitor")
		.flatMap((identity) => identity.domains ?? []);
	const replayedAt = new Date(input.replayedAt);
	const providerModelVersionId = deterministicUuid(
		`provider-model:${REPLAY_PROVIDER_ID}:${REPLAY_MODEL_ID}:${REPLAY_MODEL_VERSION}`,
	);

	const bundle: ReplayAuditBundle = {
		intentFamilies: [],
		promptVariants: [],
		auditRun: {
			id: auditRunId,
			brandId: input.brand.id,
			runKind: "baseline",
			executionMode: "fixture_replay",
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			correlationId: input.correlationId,
			fixtureSetChecksum,
			startedAt: replayedAt,
			completedAt: replayedAt,
			createdAt: replayedAt,
		},
		providerModelVersions: [
			{
				id: providerModelVersionId,
				providerId: REPLAY_PROVIDER_ID,
				modelId: REPLAY_MODEL_ID,
				modelVersion: REPLAY_MODEL_VERSION,
				schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
				metadata: providerMetadata().metadata,
				recordedAt: new Date(fixtures[0].capturedAt),
			},
		],
		providerRuns: [],
		responsePayloads: [],
		citationEvidence: [],
		entityEvidence: [],
		citationClaimLinks: [],
		findings: [],
		remediations: [],
	};

	for (const fixture of fixtures) {
		const intentFamilyId = deterministicUuid(
			`intent-family:${AUDIT_RECORD_SCHEMA_VERSION}:${input.brand.id}:${fixture.intent.key}:${fixture.intent.version}`,
		);
		const promptVariantId = deterministicUuid(
			`prompt-variant:${intentFamilyId}:${fixture.prompt.version}:${sha256(fixture.prompt.text)}`,
		);
		const providerRunId = deterministicUuid(`provider-run:${auditRunId}:${fixture.fixtureId}`);
		const responsePayloadId = deterministicUuid(`provider-response:${providerRunId}`);
		const providerCorrelationId = `${input.correlationId}:${fixture.fixtureId}`;
		const fixtureChecksum = sha256(fixture);
		const payloadChecksum = sha256(fixture.payload);

		const intentFamilyRecord: IntentFamilyRecord = {
			id: intentFamilyId,
			brandId: input.brand.id,
			key: fixture.intent.key,
			name: fixture.intent.name,
			description: fixture.intent.description,
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			version: fixture.intent.version,
			createdAt: new Date(fixture.capturedAt),
		};
		if (!bundle.intentFamilies.some((intent) => intent.id === intentFamilyId)) {
			bundle.intentFamilies.push(intentFamilyRecord);
		}
		const promptVariantRecord: FrozenPromptVariantRecord = {
			id: promptVariantId,
			intentFamilyId,
			sourcePromptId: null,
			promptText: fixture.prompt.text,
			promptChecksum: sha256(fixture.prompt.text),
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			version: fixture.prompt.version,
			frozenAt: new Date(fixture.capturedAt),
			createdAt: new Date(fixture.capturedAt),
		};
		if (!bundle.promptVariants.some((prompt) => prompt.id === promptVariantId)) {
			bundle.promptVariants.push(promptVariantRecord);
		}
		bundle.providerRuns.push({
			id: providerRunId,
			auditRunId,
			promptVariantId,
			providerModelVersionId,
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			executionMode: "fixture_replay",
			retrievalStatus: fixture.payload.retrieved ? "retrieved" : "not_retrieved",
			correlationId: providerCorrelationId,
			extractorId: REPLAY_EXTRACTOR_ID,
			extractorVersion: REPLAY_EXTRACTOR_VERSION,
			startedAt: replayedAt,
			completedAt: replayedAt,
			createdAt: replayedAt,
		});
		bundle.responsePayloads.push({
			id: responsePayloadId,
			providerRunId,
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			fixtureId: fixture.fixtureId,
			fixtureChecksum,
			payloadChecksum,
			rawPayload: fixture.payload,
			fixtureCapturedAt: new Date(fixture.capturedAt),
			replayedAt,
			createdAt: replayedAt,
		});

		const identities = entityIdentities(input, fixture);
		const classified = classifyEntities({
			content: fixture.payload.responseText,
			entities: identities,
			citationCount: fixture.payload.citations.length,
		});
		const ranks = prominenceRanks(fixture.payload.responseText, classified.entities);
		const citationRows = fixture.payload.citations.map((citation, citationIndex) => {
			const normalized = normalizeHttpUrl(citation.url);
			const normalizedUrl = normalized.status === "normalized" ? normalized.normalizedUrl : null;
			const normalizedDomain = normalized.status === "normalized" ? normalized.normalizedDomain : null;
			const citationCorrelationId = `${providerCorrelationId}:citation:${citationIndex}`;
			const row: CitationEvidenceRecord = {
				id: deterministicUuid(`citation-evidence:${providerRunId}:${citationIndex}`),
				providerRunId,
				responsePayloadId,
				schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
				correlationId: citationCorrelationId,
				citationIndex,
				citationType: classifyCitationType(citation.url, brandDomains, competitorDomains),
				originalUrl: citation.url,
				normalizedUrl,
				normalizedDomain,
				title: citation.title ?? null,
				extractorId: REPLAY_EXTRACTOR_ID,
				extractorVersion: REPLAY_EXTRACTOR_VERSION,
				evidence: createUnverifiedCitationEvidence(citation.url),
				extractedAt: replayedAt,
			};
			return row;
		});
		bundle.citationEvidence.push(...citationRows);

		const entityRows = classified.entities.map((classification): EntityIdentityEvidenceRecord => {
			const { trace, recommendation } = initialClassificationTrace({
				providerRunId,
				content: fixture.payload.responseText,
				providerRetrieved: fixture.payload.retrieved,
				classification,
				prominenceRank: ranks.get(classification.identity.id) ?? null,
			});
			return {
				id: deterministicUuid(`entity-evidence:${providerRunId}:${classification.identity.id}`),
				providerRunId,
				responsePayloadId,
				schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
				correlationId: `${providerCorrelationId}:entity:${classification.identity.id}`,
				entityId: classification.identity.id,
				entityRole: classification.identity.role,
				identityVersion: 1,
				retrieved: trace.decisions.retrieved.status === "accepted",
				mentioned: trace.decisions.mentioned.status === "accepted",
				recommended: trace.decisions.recommended.status === "accepted",
				cited: false,
				prominenceRank: ranks.get(classification.identity.id) ?? null,
				reviewState: trace.review.state,
				extractorId: REPLAY_EXTRACTOR_ID,
				extractorVersion: REPLAY_EXTRACTOR_VERSION,
				identitySnapshot: classification.identity,
				matchEvidence: classification,
				recommendationEvidence: recommendation,
				classificationEvidence: trace,
				extractedAt: replayedAt,
			};
		});
		bundle.entityEvidence.push(...entityRows);

		const fixtureLinks: CitationClaimEvidenceLinkRecord[] = [];
		for (const citation of citationRows) {
			const fixtureCitation = fixture.payload.citations[citation.citationIndex];
			const trackedOwners = entityRows.filter(
				(entity) =>
					entity.entityRole !== "unknown" &&
					citation.normalizedDomain !== null &&
					isOwnedDomain(citation.normalizedDomain, entity.identitySnapshot.domains ?? []),
			);
			const unknownOwners = entityRows.filter(
				(entity) =>
					entity.entityRole === "unknown" &&
					citation.normalizedDomain !== null &&
					isOwnedDomain(citation.normalizedDomain, entity.identitySnapshot.domains ?? []),
			);
			for (const owner of [...trackedOwners, ...unknownOwners]) {
				fixtureLinks.push(
					createCitationClaimLink({
						providerCorrelationId,
						citation,
						entity: owner,
						claim: "identity",
						status: "accepted",
						reasonCodes: [
							owner.entityRole === "unknown"
								? "citation_domain_identifies_unrelated_unknown_entity"
								: "citation_domain_owned_by_entity",
						],
						confidence: 0.99,
						content: fixture.payload.responseText,
						createdAt: replayedAt,
					}),
				);
			}
			if (fixtureCitation?.supports) {
				const supportedEntities = entityRows.filter(
					(entity) => entity.entityRole === fixtureCitation.supports?.entityRole,
				);
				for (const supportedEntity of supportedEntities) {
					fixtureLinks.push(
						createCitationClaimLink({
							providerCorrelationId,
							citation,
							entity: supportedEntity,
							claim: fixtureCitation.supports.claim,
							status: "accepted",
							reasonCodes: ["structured_fixture_citation_support", "explicit_entity_claim_relationship"],
							confidence: 0.99,
							content: fixture.payload.responseText,
							createdAt: replayedAt,
						}),
					);
				}
			}
			if (trackedOwners.length === 0) {
				for (const mentionedEntity of entityRows.filter(
					(entity) =>
						entity.entityRole !== "unknown" && entity.classificationEvidence.decisions.mentioned.status === "accepted",
				)) {
					fixtureLinks.push(
						createCitationClaimLink({
							providerCorrelationId,
							citation,
							entity: mentionedEntity,
							claim: "mention",
							status: "rejected",
							reasonCodes: ["citation_domain_not_owned_by_entity", "proximity_does_not_establish_support"],
							confidence: 0.98,
							content: fixture.payload.responseText,
							createdAt: replayedAt,
						}),
					);
				}
			}
		}
		bundle.citationClaimLinks.push(...fixtureLinks);
		const citationsById = new Map(citationRows.map((citation) => [citation.id, citation]));
		for (const entity of entityRows) {
			applyCitationLinksToEntity(entity, fixtureLinks, citationsById);
		}
	}

	const diagnosis: DiagnosisResult = diagnoseReplayEvidence(bundle);
	bundle.findings = diagnosis.findings;
	bundle.remediations = diagnosis.remediations;

	return bundle;
}

export function summarizeReplayAudit(bundle: ReplayAuditBundle): ReplayAuditSummary {
	const citationTypes: Record<CitationType, number> = {
		first_party: 0,
		independent: 0,
		competitor: 0,
		unknown: 0,
	};
	for (const citation of bundle.citationEvidence) citationTypes[citation.citationType]++;
	return {
		auditRunId: bundle.auditRun.id,
		correlationId: bundle.auditRun.correlationId,
		fixtureCount: bundle.responsePayloads.length,
		providerRunCount: bundle.providerRuns.length,
		entityEvidenceCount: bundle.entityEvidence.length,
		citationEvidenceCount: bundle.citationEvidence.length,
		citationClaimLinkCount: bundle.citationClaimLinks.length,
		retrievedRuns: bundle.providerRuns.filter((run) => run.retrievalStatus === "retrieved").length,
		mentionedEntities: bundle.entityEvidence.filter((evidence) => evidence.mentioned).length,
		recommendedEntities: bundle.entityEvidence.filter((evidence) => evidence.recommended).length,
		citedEntities: bundle.entityEvidence.filter((evidence) => evidence.cited).length,
		pendingReviewEntities: bundle.entityEvidence.filter((evidence) => evidence.reviewState === "pending").length,
		diagnosisFindingCount: bundle.findings.length,
		remediationCount: bundle.remediations.length,
		maintainDecisionCount: bundle.findings.filter((finding) => finding.likelyFailureStage === "maintain").length,
		diagnosisReviewCount: bundle.findings.filter((finding) => finding.reviewState === "pending").length,
		citationTypes,
		completedAt: bundle.auditRun.completedAt.toISOString(),
	};
}
