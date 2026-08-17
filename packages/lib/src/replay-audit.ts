import { createHash } from "node:crypto";
import { z } from "zod";
import {
	classifyEntities,
	createUnverifiedCitationEvidence,
	normalizeHttpUrl,
	type CitationEvidenceV1,
	type EntityClassification,
	type EntityIdentityInput,
} from "./evidence";

export const AUDIT_RECORD_SCHEMA_VERSION = 1 as const;
export const REPLAY_FIXTURE_SCHEMA_VERSION = 1 as const;
export const REPLAY_EXTRACTOR_ID = "zentaviq-fixture-replay-extractor";
export const REPLAY_EXTRACTOR_VERSION = "1.0.0";
export const REPLAY_PROVIDER_ID = "fixture-replay";
export const REPLAY_MODEL_ID = "zentaviq-replay";
export const REPLAY_MODEL_VERSION = "v0.1-fixtures";

export type AuditRunKind = "baseline" | "audit";
export type AuditExecutionMode = "fixture_replay" | "live";
export type RetrievalStatus = "retrieved" | "not_retrieved";
export type CitationType = "first_party" | "independent" | "competitor" | "unknown";

const fixtureCitationSchema = z
	.object({
		url: z.string(),
		title: z.string().min(1).optional(),
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
	status: "accepted" | "not_detected";
	rule: string;
	cue?: string;
	cueStart?: number;
	cueEnd?: number;
	entityMatchStart?: number;
	entityMatchEnd?: number;
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
	entityRole: "brand" | "competitor";
	identityVersion: number;
	retrieved: boolean;
	mentioned: boolean;
	recommended: boolean;
	cited: boolean;
	extractorId: string;
	extractorVersion: string;
	identitySnapshot: EntityIdentityInput;
	matchEvidence: EntityClassification;
	recommendationEvidence: RecommendationEvidence;
	extractedAt: Date;
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
}

export interface ReplayAuditSummary {
	auditRunId: string;
	correlationId: string;
	fixtureCount: number;
	providerRunCount: number;
	entityEvidenceCount: number;
	citationEvidenceCount: number;
	retrievedRuns: number;
	mentionedEntities: number;
	recommendedEntities: number;
	citedEntities: number;
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

	const fixtures: ReplayFixture[] = [
		{
			fixtureId: "strong-business-first-party-v1",
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
			fixtureId: "competitor-recommendation-citation-v1",
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
			fixtureId: "broad-category-ambiguity-v1",
			fixtureVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			capturedAt: "2026-08-01T00:02:00.000Z",
			intent: {
				key: "broad-category-discovery",
				version: 1,
				name: "Broad category discovery",
				description: "A retrieved category answer that does not identify a tracked entity.",
			},
			prompt: {
				version: 1,
				text: "What should teams consider when evaluating broad AI visibility categories?",
			},
			provider,
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: true,
				responseText:
					"The category is broad: teams should compare evidence quality, model coverage, and repeatability before selecting a product.",
				citations: [
					{
						url: "https://industry.example/ai-visibility-landscape",
						title: "AI visibility landscape",
					},
				],
			},
		},
		{
			fixtureId: "no-retrieval-no-mention-v1",
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
			payload: {
				schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
				retrieved: false,
				responseText: "",
				citations: [],
			},
		},
	];

	return fixtures.map((fixture) => replayFixtureSchema.parse(fixture));
}

function entityIdentities(input: ReplayAuditInput): EntityIdentityInput[] {
	const brandDomains = [input.brand.website, ...(input.brand.additionalDomains ?? [])]
		.map(canonicalDomain)
		.filter((domain): domain is string => Boolean(domain));
	const replayCompetitors = input.competitors.length > 0 ? input.competitors : [effectiveCompetitor(input)];
	return [
		{
			id: `brand:${input.brand.id}`,
			role: "brand",
			name: input.brand.name,
			aliases: input.brand.aliases ?? [],
			domains: brandDomains,
			contextTerms: [],
		},
		...replayCompetitors.map((competitor) => ({
			id: `competitor:${competitor.id}`,
			role: "competitor" as const,
			name: competitor.name,
			aliases: competitor.aliases ?? [],
			domains: (competitor.domains ?? []).map(canonicalDomain).filter((domain): domain is string => Boolean(domain)),
			contextTerms: [],
		})),
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
	for (const entityMatch of classification.acceptedMatches) {
		const sentence = sentenceBounds(content, entityMatch.start);
		const sentenceText = content.slice(sentence.start, sentence.end);
		const cuePattern = /\b(?:recommend(?:ed|s|ing)?|top choice|best option)\b/giu;
		for (const cueMatch of sentenceText.matchAll(cuePattern)) {
			const relativeStart = cueMatch.index ?? 0;
			const cueStart = sentence.start + relativeStart;
			const cue = cueMatch[0];
			const preceding = content.slice(Math.max(sentence.start, cueStart - 24), cueStart);
			if (/\b(?:not|never|avoid|cannot|can't|do not|don't)\b/iu.test(preceding)) continue;
			return {
				status: "accepted",
				rule: "same_sentence_positive_recommendation_cue",
				cue,
				cueStart,
				cueEnd: cueStart + cue.length,
				entityMatchStart: entityMatch.start,
				entityMatchEnd: entityMatch.end,
			};
		}
	}
	return {
		status: "not_detected",
		rule: "no_positive_recommendation_cue_for_accepted_identity_match",
	};
}

export function classifyCitationType(url: string, brandDomains: string[], competitorDomains: string[]): CitationType {
	const normalized = normalizeHttpUrl(url);
	if (normalized.status !== "normalized") return "unknown";
	if (isOwnedDomain(normalized.normalizedDomain, brandDomains)) return "first_party";
	if (isOwnedDomain(normalized.normalizedDomain, competitorDomains)) return "competitor";
	return "independent";
}

function citationSupportsIdentity(domain: string | null, identity: EntityIdentityInput): boolean {
	return domain !== null && isOwnedDomain(domain, identity.domains ?? []);
}

export function createReplayAuditBundle(input: ReplayAuditInput): ReplayAuditBundle {
	if (!input.correlationId.trim()) throw new Error("A replay correlation ID is required");
	if (Number.isNaN(input.replayedAt.getTime())) throw new Error("A valid replay timestamp is required");

	const fixtures = createReplayFixtures(input);
	const fixtureSetChecksum = sha256(fixtures);
	const auditRunId = deterministicUuid(`audit-run:${input.correlationId}`);
	const identities = entityIdentities(input);
	const brandDomains = identities
		.filter((identity) => identity.role === "brand")
		.flatMap((identity) => identity.domains ?? []);
	const competitorDomains = identities
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
	};

	for (const fixture of fixtures) {
		const intentFamilyId = deterministicUuid(
			`intent-family:${input.brand.id}:${fixture.intent.key}:${fixture.intent.version}`,
		);
		const promptVariantId = deterministicUuid(
			`prompt-variant:${intentFamilyId}:${fixture.prompt.version}:${sha256(fixture.prompt.text)}`,
		);
		const providerRunId = deterministicUuid(`provider-run:${auditRunId}:${fixture.fixtureId}`);
		const responsePayloadId = deterministicUuid(`provider-response:${providerRunId}`);
		const providerCorrelationId = `${input.correlationId}:${fixture.fixtureId}`;
		const fixtureChecksum = sha256(fixture);
		const payloadChecksum = sha256(fixture.payload);

		bundle.intentFamilies.push({
			id: intentFamilyId,
			brandId: input.brand.id,
			key: fixture.intent.key,
			name: fixture.intent.name,
			description: fixture.intent.description,
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			version: fixture.intent.version,
			createdAt: new Date(fixture.capturedAt),
		});
		bundle.promptVariants.push({
			id: promptVariantId,
			intentFamilyId,
			sourcePromptId: null,
			promptText: fixture.prompt.text,
			promptChecksum: sha256(fixture.prompt.text),
			schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
			version: fixture.prompt.version,
			frozenAt: new Date(fixture.capturedAt),
			createdAt: new Date(fixture.capturedAt),
		});
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

		const classified = classifyEntities({
			content: fixture.payload.responseText,
			entities: identities,
			citationCount: fixture.payload.citations.length,
		});
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

		for (const classification of classified.entities) {
			const recommendationEvidence = recommendationFor(fixture.payload.responseText, classification);
			const cited = citationRows.some((citation) =>
				citationSupportsIdentity(citation.normalizedDomain, classification.identity),
			);
			bundle.entityEvidence.push({
				id: deterministicUuid(`entity-evidence:${providerRunId}:${classification.identity.id}`),
				providerRunId,
				responsePayloadId,
				schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
				correlationId: `${providerCorrelationId}:entity:${classification.identity.id}`,
				entityId: classification.identity.id,
				entityRole: classification.identity.role,
				identityVersion: 1,
				retrieved: fixture.payload.retrieved,
				mentioned: classification.status !== "not_mentioned",
				recommended: recommendationEvidence.status === "accepted",
				cited,
				extractorId: REPLAY_EXTRACTOR_ID,
				extractorVersion: REPLAY_EXTRACTOR_VERSION,
				identitySnapshot: classification.identity,
				matchEvidence: classification,
				recommendationEvidence,
				extractedAt: replayedAt,
			});
		}
	}

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
		retrievedRuns: bundle.providerRuns.filter((run) => run.retrievalStatus === "retrieved").length,
		mentionedEntities: bundle.entityEvidence.filter((evidence) => evidence.mentioned).length,
		recommendedEntities: bundle.entityEvidence.filter((evidence) => evidence.recommended).length,
		citedEntities: bundle.entityEvidence.filter((evidence) => evidence.cited).length,
		citationTypes,
		completedAt: bundle.auditRun.completedAt.toISOString(),
	};
}
