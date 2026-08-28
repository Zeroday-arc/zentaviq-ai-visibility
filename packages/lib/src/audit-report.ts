import type { DiagnosisFindingRecord, LikelyFailureStage, RemediationRecord } from "./diagnosis";
import { ENTITY_CLASSIFIER_ID, ENTITY_CLASSIFIER_VERSION } from "./evidence";
import {
	type CitationClaimEvidenceLinkRecord,
	canonicalJson,
	createReplayAuditBundle,
	createReplayFixtures,
	deterministicUuid,
	type EntityIdentityEvidenceRecord,
	EVIDENCE_CLASSIFIER_ID,
	EVIDENCE_CLASSIFIER_VERSION,
	REPLAY_BENCHMARK_VERSION,
	REPLAY_EXTRACTOR_ID,
	REPLAY_EXTRACTOR_VERSION,
	REPLAY_FIXTURE_SCHEMA_VERSION,
	type ReplayAuditBundle,
	type ReplayBrandInput,
	type ReplayCompetitorInput,
	type ReplayFixture,
	replayFixtureSchema,
	sha256,
} from "./replay-audit";

export const AUDIT_REPORT_SCHEMA_VERSION = 1 as const;
export const AUDIT_REPORT_VERSION = 1 as const;
export const BASELINE_SNAPSHOT_VERSION = 1 as const;
export const AUDIT_REPORT_GENERATION_VERSION = "zentaviq-customer-audit-report-v1";
export const RETEST_COMPARATOR_ID = "zentaviq-deterministic-baseline-retest-comparator";
export const RETEST_COMPARATOR_VERSION = "1.0.0";
export const RETEST_FIXTURE_VERSION = "zentaviq-fixture-retest-v1";

export type AuditComparisonOutcome =
	| "improved"
	| "unchanged"
	| "regressed"
	| "insufficient_evidence"
	| "pending_human_review";

export type RetestDecisionState =
	| "approved_remediation"
	| "maintain"
	| "pending_human_review"
	| "insufficient_evidence";

export interface FrozenDecisionSnapshot {
	intentFamilyId: string;
	intentKey: string;
	intentName: string;
	promptVariantIds: string[];
	findingId: string;
	remediationId: string | null;
	likelyFailureStage: LikelyFailureStage;
	diagnosisConfidence: number;
	diagnosisReviewState: "not_required" | "pending" | "accepted" | "rejected";
	decisionState: RetestDecisionState;
	actionCategory: RemediationRecord["actionCategory"] | null;
	remediationApprovalAtFreeze: "approved_for_fixture_retest" | "not_required" | "pending_human_review" | "unavailable";
	acceptanceCriteria: string[];
	expectedEvidenceChange: string[];
}

export interface FrozenAuditReportRecord {
	id: string;
	brandId: string;
	baselineAuditRunId: string;
	schemaVersion: number;
	reportVersion: number;
	baselineVersion: number;
	businessIdentitySnapshot: {
		brand: ReplayBrandInput;
		competitors: ReplayCompetitorInput[];
		identityRecords: Array<EntityIdentityEvidenceRecord["identitySnapshot"]>;
	};
	intentVersionSnapshot: ReplayAuditBundle["intentFamilies"];
	promptVersionSnapshot: ReplayAuditBundle["promptVariants"];
	providerVersionSnapshot: ReplayAuditBundle["providerModelVersions"];
	fixtureManifest: Array<{
		fixtureId: string;
		fixtureChecksum: string;
		payloadChecksum: string;
		fixtureCapturedAt: string;
		providerRunId: string;
		promptVariantId: string;
	}>;
	policyVersionSnapshot: {
		replayExtractor: string;
		entityClassifier: string;
		evidenceClassifier: string;
		diagnosisClassifiers: string[];
		remediationPolicies: string[];
	};
	decisionSnapshot: FrozenDecisionSnapshot[];
	evidenceRecordIds: string[];
	findingIds: string[];
	remediationIds: string[];
	reportGenerationVersion: string;
	benchmarkVersion: string;
	snapshotChecksum: string;
	frozenAt: Date;
	correlationId: string;
	createdAt: Date;
}

export interface AuditIntentMetrics {
	sampleSize: number;
	providerRunIds: string[];
	promptVariantIds: string[];
	targetEvidenceIds: string[];
	competitorEvidenceIds: string[];
	targetRetrievedRuns: number;
	targetMentionedRuns: number;
	targetRecommendedRuns: number;
	targetBestProminenceRank: number | null;
	competitorRecommendedRuns: number;
	competitorBestProminenceRank: number | null;
	competitorAboveTarget: boolean;
	targetAcceptedCitationLinks: number;
	targetRecommendationCitationLinks: number;
	targetIndependentRecommendationCitationLinks: number;
	targetAcceptedMentionEvidenceCount: number;
	pendingReview: boolean;
	diagnosisStage: LikelyFailureStage | null;
	evidenceIds: string[];
	providerConfiguration: Array<{
		providerId: string;
		modelId: string;
		modelVersion: string;
		benchmarkVersion: string | null;
	}>;
}

export interface RetestCriterionEvaluation {
	criterion: string;
	status: "accepted" | "rejected" | "not_assessed";
	reasonCode: string;
}

export interface AuditRetestComparisonRecord {
	id: string;
	brandId: string;
	frozenReportId: string;
	baselineAuditRunId: string;
	retestAuditRunId: string;
	intentFamilyId: string;
	findingId: string | null;
	remediationId: string | null;
	schemaVersion: number;
	comparisonVersion: number;
	outcome: AuditComparisonOutcome;
	confidence: number;
	reasonCodes: string[];
	decisionState: RetestDecisionState;
	promptVariantIds: string[];
	baselineEvidenceIds: string[];
	retestEvidenceIds: string[];
	acceptanceCriteriaSnapshot: string[];
	expectedEvidenceChangeSnapshot: string[];
	criteriaEvaluation: RetestCriterionEvaluation[];
	baselineMetrics: AuditIntentMetrics;
	retestMetrics: AuditIntentMetrics;
	observedChanges: string[];
	providerConfigurationSnapshot: {
		baseline: AuditIntentMetrics["providerConfiguration"];
		retest: AuditIntentMetrics["providerConfiguration"];
		comparable: boolean;
	};
	comparatorId: string;
	comparatorVersion: string;
	comparisonChecksum: string;
	correlationId: string;
	createdAt: Date;
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortedById<T extends { id: string }>(records: T[]): T[] {
	return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalBusinessIdentity(input: { brand: ReplayBrandInput; competitors: ReplayCompetitorInput[] }): string {
	return canonicalJson({
		brand: input.brand,
		competitors: sortedById(input.competitors),
	});
}

function normalizedDomain(value: string): string {
	const url = new URL(value.includes("://") ? value : `https://${value}`);
	return url.hostname
		.toLowerCase()
		.replace(/^www\./, "")
		.replace(/\.$/, "");
}

function assertBaselineIdentityBinding(
	baseline: ReplayAuditBundle,
	brand: ReplayBrandInput,
	competitors: ReplayCompetitorInput[],
): void {
	const expected = [
		{
			id: `brand:${brand.id}`,
			name: brand.name,
			aliases: brand.aliases ?? [],
			domains: [brand.website, ...(brand.additionalDomains ?? [])].map(normalizedDomain).sort(),
		},
		...competitors.map((competitor) => ({
			id: `competitor:${competitor.id}`,
			name: competitor.name,
			aliases: competitor.aliases ?? [],
			domains: (competitor.domains ?? []).map(normalizedDomain).sort(),
		})),
	];
	for (const identity of expected) {
		const snapshots = baseline.entityEvidence
			.filter((entity) => entity.entityId === identity.id)
			.map((entity) => entity.identitySnapshot);
		if (
			snapshots.length === 0 ||
			snapshots.some(
				(snapshot) =>
					snapshot.name !== identity.name ||
					canonicalJson([...(snapshot.domains ?? [])].sort()) !== canonicalJson(identity.domains) ||
					identity.aliases.some((alias) => !(snapshot.aliases ?? []).includes(alias)),
			)
		) {
			throw new Error(`Baseline evidence identity does not match ${identity.id}`);
		}
	}
}

function reportChecksumPayload(record: Omit<FrozenAuditReportRecord, "snapshotChecksum">): unknown {
	return record;
}

export function verifyFrozenAuditReportChecksum(record: FrozenAuditReportRecord): boolean {
	const { snapshotChecksum: _checksum, ...payload } = record;
	return sha256(reportChecksumPayload(payload)) === record.snapshotChecksum;
}

function decisionStateFor(
	finding: DiagnosisFindingRecord,
	remediation: RemediationRecord | undefined,
): RetestDecisionState {
	if (finding.reviewState === "pending") return "pending_human_review";
	if (finding.likelyFailureStage === "maintain") return "maintain";
	if (finding.likelyFailureStage === "insufficient_evidence" || !remediation) return "insufficient_evidence";
	return "approved_remediation";
}

export function createFrozenAuditReport(input: {
	baseline: ReplayAuditBundle;
	brand: ReplayBrandInput;
	competitors: ReplayCompetitorInput[];
	frozenAt: Date;
}): FrozenAuditReportRecord {
	const { baseline, brand, competitors } = input;
	if (baseline.auditRun.runKind !== "baseline" || baseline.auditRun.executionMode !== "fixture_replay") {
		throw new Error("Only a fixture-replay baseline can be frozen");
	}
	if (baseline.auditRun.brandId !== brand.id) throw new Error("Baseline brand does not match the report identity");
	if (baseline.intentFamilies.some((intent) => intent.brandId !== brand.id)) {
		throw new Error("Cross-tenant intent evidence cannot be frozen into this report");
	}
	assertBaselineIdentityBinding(baseline, brand, competitors);
	if (Number.isNaN(input.frozenAt.getTime())) throw new Error("A valid report freeze timestamp is required");

	const promptsByIntent = new Map<string, string[]>();
	for (const prompt of baseline.promptVariants) {
		const ids = promptsByIntent.get(prompt.intentFamilyId) ?? [];
		ids.push(prompt.id);
		promptsByIntent.set(prompt.intentFamilyId, ids);
	}
	const decisions = sortedById(baseline.findings).map((finding): FrozenDecisionSnapshot => {
		const intent = baseline.intentFamilies.find((candidate) => candidate.id === finding.intentFamilyId);
		if (!intent) throw new Error(`Missing intent ${finding.intentFamilyId} for frozen report`);
		const remediation = baseline.remediations.find((candidate) => candidate.primaryFindingId === finding.id);
		const decisionState = decisionStateFor(finding, remediation);
		return {
			intentFamilyId: intent.id,
			intentKey: intent.key,
			intentName: intent.name,
			promptVariantIds: unique(promptsByIntent.get(intent.id) ?? []),
			findingId: finding.id,
			remediationId: remediation?.id ?? null,
			likelyFailureStage: finding.likelyFailureStage,
			diagnosisConfidence: finding.confidence,
			diagnosisReviewState: finding.reviewState,
			decisionState,
			actionCategory: remediation?.actionCategory ?? null,
			remediationApprovalAtFreeze:
				decisionState === "approved_remediation"
					? "approved_for_fixture_retest"
					: decisionState === "maintain"
						? "not_required"
						: decisionState === "pending_human_review"
							? "pending_human_review"
							: "unavailable",
			acceptanceCriteria: remediation?.acceptanceCriteria ?? [],
			expectedEvidenceChange: remediation?.expectedEvidenceChange ?? [],
		};
	});
	const runsById = new Map(baseline.providerRuns.map((run) => [run.id, run]));
	const identityRecords = new Map<string, EntityIdentityEvidenceRecord["identitySnapshot"]>();
	for (const entity of baseline.entityEvidence) {
		identityRecords.set(`${entity.entityId}:${entity.identityVersion}`, entity.identitySnapshot);
	}
	const frozenAt = new Date(input.frozenAt);
	const id = deterministicUuid(`frozen-audit-report:${baseline.auditRun.id}:${AUDIT_REPORT_VERSION}`);
	const withoutChecksum: Omit<FrozenAuditReportRecord, "snapshotChecksum"> = {
		id,
		brandId: brand.id,
		baselineAuditRunId: baseline.auditRun.id,
		schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
		reportVersion: AUDIT_REPORT_VERSION,
		baselineVersion: BASELINE_SNAPSHOT_VERSION,
		businessIdentitySnapshot: {
			brand: structuredClone(brand),
			competitors: structuredClone(competitors),
			identityRecords: [...identityRecords.values()].sort((left, right) => left.id.localeCompare(right.id)),
		},
		intentVersionSnapshot: sortedById(baseline.intentFamilies),
		promptVersionSnapshot: sortedById(baseline.promptVariants),
		providerVersionSnapshot: sortedById(baseline.providerModelVersions),
		fixtureManifest: baseline.responsePayloads
			.map((payload) => ({
				fixtureId: payload.fixtureId,
				fixtureChecksum: payload.fixtureChecksum,
				payloadChecksum: payload.payloadChecksum,
				fixtureCapturedAt: payload.fixtureCapturedAt.toISOString(),
				providerRunId: payload.providerRunId,
				promptVariantId: runsById.get(payload.providerRunId)?.promptVariantId ?? "",
			}))
			.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId)),
		policyVersionSnapshot: {
			replayExtractor: `${REPLAY_EXTRACTOR_ID}@${REPLAY_EXTRACTOR_VERSION}`,
			entityClassifier: `${ENTITY_CLASSIFIER_ID}@${ENTITY_CLASSIFIER_VERSION}`,
			evidenceClassifier: `${EVIDENCE_CLASSIFIER_ID}@${EVIDENCE_CLASSIFIER_VERSION}`,
			diagnosisClassifiers: unique(
				baseline.findings.map((finding) => `${finding.classifierId}@${finding.classifierVersion}`),
			),
			remediationPolicies: unique(baseline.remediations.map((remediation) => remediation.policyVersion)),
		},
		decisionSnapshot: decisions,
		evidenceRecordIds: unique([
			...baseline.providerRuns.map((record) => record.id),
			...baseline.responsePayloads.map((record) => record.id),
			...baseline.entityEvidence.map((record) => record.id),
			...baseline.citationEvidence.map((record) => record.id),
			...baseline.citationClaimLinks.map((record) => record.id),
		]),
		findingIds: unique(baseline.findings.map((record) => record.id)),
		remediationIds: unique(baseline.remediations.map((record) => record.id)),
		reportGenerationVersion: AUDIT_REPORT_GENERATION_VERSION,
		benchmarkVersion: REPLAY_BENCHMARK_VERSION,
		frozenAt,
		correlationId: `${baseline.auditRun.correlationId}:frozen-report:v${AUDIT_REPORT_VERSION}`,
		createdAt: frozenAt,
	};
	return { ...withoutChecksum, snapshotChecksum: sha256(reportChecksumPayload(withoutChecksum)) };
}

function fixtureById(fixtures: ReplayFixture[], fixtureId: string): ReplayFixture {
	const fixture = fixtures.find((candidate) => candidate.fixtureId === fixtureId);
	if (!fixture) throw new Error(`Missing baseline fixture template ${fixtureId}`);
	return fixture;
}

/** Retest fixtures change only raw replay observations; intent/prompt versions stay frozen. */
export function createDeterministicRetestFixtures(input: {
	brand: ReplayBrandInput;
	competitors: ReplayCompetitorInput[];
}): ReplayFixture[] {
	const fixtures = structuredClone(createReplayFixtures(input));
	const competitor = input.competitors[0] ?? {
		id: "fixture-competitor-ledger-labs",
		name: "Ledger Labs",
		domains: ["ledgerlabs.example"],
		aliases: [],
	};
	const brandDomain = new URL(
		input.brand.website.includes("://") ? input.brand.website : `https://${input.brand.website}`,
	).hostname.replace(/^www\./, "");

	fixtureById(fixtures, "mention-without-recommendation-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `I recommend ${input.brand.name} for teams that need evidence-backed visibility audits.`,
		citations: [],
	};
	fixtureById(fixtures, "recommendation-low-prominence-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `${input.brand.name} appears in the current market overview, but no recommendation is made.`,
		citations: [],
	};
	fixtureById(fixtures, "competitor-ranked-above-target-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `1. I recommend ${input.brand.name} for evidence quality.\n2. I recommend ${competitor.name} for workflow depth.`,
		citations: [],
	};
	fixtureById(fixtures, "target-recommended-without-citation-v3").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `1. I recommend ${input.brand.name} for a focused audit team. Independent support: https://independent-audit.example/zentaviq.`,
		citations: [
			{
				url: "https://independent-audit.example/zentaviq",
				title: "Independent evidence-led audit benchmark",
				supports: { entityRole: "brand", claim: "recommendation" },
			},
		],
	};
	fixtureById(fixtures, "target-domain-citation-without-recommendation-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `Reference material is available at https://${brandDomain}/research. Unrelated context: https://unrelated-lab.example/overview.`,
		citations: [
			{ url: `https://${brandDomain}/research`, title: "Evidence-led audit research" },
			{ url: "https://unrelated-lab.example/overview", title: "Unrelated lab overview" },
		],
	};
	fixtureById(fixtures, "unrelated-citation-near-target-mention-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `${input.brand.name} appears in this overview. ${input.brand.name} is also named in the appendix, but no recommendation is made. General context: https://neutral-source.example/appendix.`,
		citations: [{ url: "https://neutral-source.example/appendix", title: "General category appendix" }],
	};
	fixtureById(fixtures, "no-target-retrieval-v2").payload = {
		schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
		retrieved: true,
		responseText: `${input.brand.name} appears in the retrieved market set alongside ${competitor.name}, without a recommendation.`,
		citations: [],
	};
	for (const fixtureId of ["competitor-independent-support-a-v3", "competitor-independent-support-b-v3"]) {
		const fixture = fixtureById(fixtures, fixtureId);
		const citation = fixture.payload.citations[0];
		fixture.payload.responseText = `1. I recommend ${competitor.name} for control depth.\n2. I recommend ${input.brand.name} as another option. ${citation?.url ?? ""}`;
	}
	for (const fixtureId of ["repeated-retrieval-failure-a-v3", "repeated-retrieval-failure-b-v3"]) {
		fixtureById(fixtures, fixtureId).payload = {
			schemaVersion: REPLAY_FIXTURE_SCHEMA_VERSION,
			retrieved: true,
			responseText: `${input.brand.name} was retrieved as an evidence-led audit platform.`,
			citations: [],
		};
	}
	const incompatible = fixtureById(fixtures, "substantial-first-party-independent-gap-v3");
	incompatible.provider = {
		...incompatible.provider,
		version: "v0.1-incompatible-model",
		metadata: { ...incompatible.provider.metadata, benchmarkVersion: "zentaviq-fixture-benchmark-v2" },
	};

	const retestFixtures = fixtures.map((fixture, index) =>
		replayFixtureSchema.parse({
			...fixture,
			fixtureId: `retest-${fixture.fixtureId}`,
			capturedAt: new Date(Date.UTC(2026, 7, 15, 0, index, 0)).toISOString(),
		}),
	);
	const citationConfirmation = structuredClone(
		fixtureById(retestFixtures, "retest-target-recommended-without-citation-v3"),
	);
	return [
		...retestFixtures,
		replayFixtureSchema.parse({
			...citationConfirmation,
			fixtureId: "retest-target-recommended-without-citation-confirmation-v3",
			capturedAt: new Date(Date.UTC(2026, 7, 15, 0, retestFixtures.length, 0)).toISOString(),
		}),
	];
}

export function createDeterministicRetestBundle(input: {
	frozenReport: FrozenAuditReportRecord;
	brand: ReplayBrandInput;
	competitors: ReplayCompetitorInput[];
	retestedAt: Date;
}): ReplayAuditBundle {
	if (!verifyFrozenAuditReportChecksum(input.frozenReport))
		throw new Error("Frozen report checksum verification failed");
	if (input.frozenReport.brandId !== input.brand.id)
		throw new Error("Retest brand does not match the frozen report tenant");
	if (
		canonicalBusinessIdentity({ brand: input.brand, competitors: input.competitors }) !==
		canonicalBusinessIdentity(input.frozenReport.businessIdentitySnapshot)
	) {
		throw new Error("Retest business identity does not match the frozen identity snapshot");
	}
	const correlationId = `fixture-retest:${input.frozenReport.id}:${RETEST_FIXTURE_VERSION}`;
	const retest = createReplayAuditBundle(
		{
			brand: input.brand,
			competitors: input.competitors,
			correlationId,
			replayedAt: input.retestedAt,
		},
		{ fixtures: createDeterministicRetestFixtures(input), runKind: "retest" },
	);
	// Content-addressed intent, prompt, and compatible provider identities are
	// reused byte-for-byte rather than regenerated with retest timestamps.
	retest.intentFamilies = structuredClone(input.frozenReport.intentVersionSnapshot);
	retest.promptVariants = structuredClone(input.frozenReport.promptVersionSnapshot);
	const frozenProviders = new Map(
		input.frozenReport.providerVersionSnapshot.map((provider) => [provider.id, provider]),
	);
	retest.providerModelVersions = retest.providerModelVersions.map((provider) =>
		frozenProviders.has(provider.id) ? structuredClone(frozenProviders.get(provider.id) as typeof provider) : provider,
	);
	return retest;
}

function linksForTarget(
	bundle: ReplayAuditBundle,
	targets: EntityIdentityEvidenceRecord[],
): Array<{
	link: CitationClaimEvidenceLinkRecord;
	citationType: ReplayAuditBundle["citationEvidence"][number]["citationType"];
}> {
	const targetIds = new Set(targets.map((target) => target.id));
	const citations = new Map(bundle.citationEvidence.map((citation) => [citation.id, citation]));
	return bundle.citationClaimLinks
		.filter((link) => link.status === "accepted" && targetIds.has(link.entityEvidenceId))
		.map((link) => ({ link, citationType: citations.get(link.citationEvidenceId)?.citationType ?? "unknown" }));
}

export function summarizeIntentEvidence(bundle: ReplayAuditBundle, intentFamilyId: string): AuditIntentMetrics {
	const promptIds = new Set(
		bundle.promptVariants.filter((prompt) => prompt.intentFamilyId === intentFamilyId).map((prompt) => prompt.id),
	);
	const runs = bundle.providerRuns.filter((run) => promptIds.has(run.promptVariantId));
	const runIds = new Set(runs.map((run) => run.id));
	const entities = bundle.entityEvidence.filter((entity) => runIds.has(entity.providerRunId));
	const targets = entities.filter((entity) => entity.entityRole === "brand");
	const competitors = entities.filter((entity) => entity.entityRole === "competitor");
	const acceptedTargetLinks = linksForTarget(bundle, targets);
	const recommendedTargetEvidenceIds = new Set(
		targets.filter((target) => target.recommended).map((target) => target.id),
	);
	const acceptedTargetRecommendationLinks = acceptedTargetLinks.filter(
		({ link }) => link.claim === "recommendation" && recommendedTargetEvidenceIds.has(link.entityEvidenceId),
	);
	const targetRanks = targets.map((entity) => entity.prominenceRank).filter((rank): rank is number => rank !== null);
	const competitorRanks = competitors
		.map((entity) => entity.prominenceRank)
		.filter((rank): rank is number => rank !== null);
	const targetBestProminenceRank = targetRanks.length ? Math.min(...targetRanks) : null;
	const competitorBestProminenceRank = competitorRanks.length ? Math.min(...competitorRanks) : null;
	const finding = bundle.findings.find((candidate) => candidate.intentFamilyId === intentFamilyId);
	const providerById = new Map(bundle.providerModelVersions.map((provider) => [provider.id, provider]));
	const providerConfiguration = unique(
		runs.map((run) => {
			const provider = providerById.get(run.providerModelVersionId);
			if (!provider) throw new Error(`Missing provider metadata for run ${run.id}`);
			return canonicalJson({
				providerId: provider.providerId,
				modelId: provider.modelId,
				modelVersion: provider.modelVersion,
				benchmarkVersion: provider.metadata.benchmarkVersion ?? null,
			});
		}),
	).map((value) => JSON.parse(value) as AuditIntentMetrics["providerConfiguration"][number]);
	const payloadIds = bundle.responsePayloads
		.filter((payload) => runIds.has(payload.providerRunId))
		.map((payload) => payload.id);
	const citationIds = bundle.citationEvidence
		.filter((citation) => runIds.has(citation.providerRunId))
		.map((citation) => citation.id);
	const entityIds = entities.map((entity) => entity.id);
	const entityIdSet = new Set(entityIds);
	const linkIds = bundle.citationClaimLinks
		.filter((link) => entityIdSet.has(link.entityEvidenceId))
		.map((link) => link.id);

	return {
		sampleSize: runs.length,
		providerRunIds: unique(runs.map((run) => run.id)),
		promptVariantIds: unique(runs.map((run) => run.promptVariantId)),
		targetEvidenceIds: unique(targets.map((target) => target.id)),
		competitorEvidenceIds: unique(competitors.map((competitor) => competitor.id)),
		targetRetrievedRuns: new Set(targets.filter((target) => target.retrieved).map((target) => target.providerRunId))
			.size,
		targetMentionedRuns: new Set(targets.filter((target) => target.mentioned).map((target) => target.providerRunId))
			.size,
		targetRecommendedRuns: new Set(targets.filter((target) => target.recommended).map((target) => target.providerRunId))
			.size,
		targetBestProminenceRank,
		competitorRecommendedRuns: new Set(
			competitors.filter((competitor) => competitor.recommended).map((competitor) => competitor.providerRunId),
		).size,
		competitorBestProminenceRank,
		competitorAboveTarget:
			competitorBestProminenceRank !== null &&
			(targetBestProminenceRank === null || competitorBestProminenceRank < targetBestProminenceRank),
		targetAcceptedCitationLinks: acceptedTargetLinks.length,
		targetRecommendationCitationLinks: acceptedTargetRecommendationLinks.length,
		targetIndependentRecommendationCitationLinks: acceptedTargetRecommendationLinks.filter(
			({ citationType }) => citationType === "independent",
		).length,
		targetAcceptedMentionEvidenceCount: targets.reduce(
			(count, target) =>
				count +
				target.classificationEvidence.sources.filter(
					(source) => source.kind === "identity_match" && source.disposition === "accepted",
				).length,
			0,
		),
		pendingReview: entities.some((entity) => entity.reviewState === "pending") || finding?.reviewState === "pending",
		diagnosisStage: finding?.likelyFailureStage ?? null,
		evidenceIds: unique([
			...runs.map((run) => run.id),
			...payloadIds,
			...entityIds,
			...citationIds,
			...linkIds,
			...(finding ? [finding.id, ...finding.supportingEvidenceIds, ...finding.contradictingEvidenceIds] : []),
		]),
		providerConfiguration,
	};
}

function observedChanges(baseline: AuditIntentMetrics, retest: AuditIntentMetrics): string[] {
	const changes: string[] = [];
	const fields: Array<[keyof AuditIntentMetrics, string]> = [
		["targetRetrievedRuns", "accepted target retrieval runs"],
		["targetMentionedRuns", "accepted target mention runs"],
		["targetRecommendedRuns", "accepted target recommendation runs"],
		["targetBestProminenceRank", "best target prominence rank"],
		["targetRecommendationCitationLinks", "accepted target recommendation citation links"],
		["targetIndependentRecommendationCitationLinks", "independent target recommendation links"],
		["competitorRecommendedRuns", "competitor recommendation runs"],
	];
	for (const [field, label] of fields) {
		if (baseline[field] !== retest[field])
			changes.push(`${label}: ${String(baseline[field])} → ${String(retest[field])}`);
	}
	if (changes.length === 0) changes.push("No material classified evidence change was observed");
	return changes;
}

function metricRegression(baseline: AuditIntentMetrics, retest: AuditIntentMetrics): string | null {
	if (baseline.targetRecommendedRuns > 0 && retest.targetRecommendedRuns === 0)
		return "accepted_target_recommendation_lost";
	if (baseline.targetMentionedRuns > 0 && retest.targetMentionedRuns === 0) return "accepted_target_mention_lost";
	if (baseline.targetRetrievedRuns > 0 && retest.targetRetrievedRuns === 0) return "accepted_target_retrieval_lost";
	if (baseline.targetRecommendationCitationLinks > 0 && retest.targetRecommendationCitationLinks === 0) {
		return "accepted_target_citation_support_lost";
	}
	if (
		baseline.targetBestProminenceRank !== null &&
		retest.targetBestProminenceRank !== null &&
		retest.targetBestProminenceRank > baseline.targetBestProminenceRank
	) {
		return "target_prominence_regressed";
	}
	if (!baseline.competitorAboveTarget && retest.competitorAboveTarget) return "new_competitor_displacement_observed";
	return null;
}

function stageAcceptance(
	stage: LikelyFailureStage,
	baseline: AuditIntentMetrics,
	retest: AuditIntentMetrics,
): string | null {
	switch (stage) {
		case "retrieval_failure":
			return retest.targetRetrievedRuns >= 2 ? "repeated_target_retrieval_accepted" : null;
		case "mention_gap":
			return retest.targetMentionedRuns > 0 ? "accepted_target_mention_observed" : null;
		case "recommendation_gap":
			return retest.targetRecommendedRuns > 0 ? "accepted_target_recommendation_observed" : null;
		case "prominence_ranking_gap":
		case "competitor_displacement":
			return retest.targetRecommendedRuns > 0 &&
				!retest.competitorAboveTarget &&
				(retest.targetBestProminenceRank ?? Number.POSITIVE_INFINITY) <
					(baseline.targetBestProminenceRank ?? Number.POSITIVE_INFINITY)
				? "target_prominence_above_competitor_observed"
				: null;
		case "citation_support_gap":
			return retest.targetIndependentRecommendationCitationLinks > 0
				? "linked_independent_target_recommendation_support_observed"
				: null;
		case "independent_authority_gap":
			return retest.targetIndependentRecommendationCitationLinks >= 2
				? "repeated_independent_target_support_observed"
				: null;
		case "category_fit_ambiguity":
			return retest.targetRecommendedRuns > 0 ? "category_fit_resolved_with_target_recommendation" : null;
		default:
			return null;
	}
}

function comparisonChecksumPayload(record: Omit<AuditRetestComparisonRecord, "comparisonChecksum">): unknown {
	return record;
}

export function verifyAuditComparisonChecksum(record: AuditRetestComparisonRecord): boolean {
	const { comparisonChecksum: _checksum, ...payload } = record;
	return sha256(comparisonChecksumPayload(payload)) === record.comparisonChecksum;
}

export function compareFrozenBaselineToRetest(input: {
	frozenReport: FrozenAuditReportRecord;
	baseline: ReplayAuditBundle;
	retest: ReplayAuditBundle;
	createdAt: Date;
}): AuditRetestComparisonRecord[] {
	const { frozenReport, baseline, retest } = input;
	if (!verifyFrozenAuditReportChecksum(frozenReport)) throw new Error("Frozen report checksum verification failed");
	if (baseline.auditRun.id !== frozenReport.baselineAuditRunId)
		throw new Error("Frozen report baseline linkage is invalid");
	if (baseline.auditRun.brandId !== frozenReport.brandId || retest.auditRun.brandId !== frozenReport.brandId) {
		throw new Error("Cross-tenant audit comparison is not permitted");
	}
	if (retest.auditRun.runKind !== "retest" || retest.auditRun.executionMode !== "fixture_replay") {
		throw new Error("Only a persisted fixture retest can be compared");
	}
	if (Number.isNaN(input.createdAt.getTime())) throw new Error("A valid comparison timestamp is required");

	return frozenReport.decisionSnapshot.map((decision) => {
		const baselineMetrics = summarizeIntentEvidence(baseline, decision.intentFamilyId);
		const retestMetrics = summarizeIntentEvidence(retest, decision.intentFamilyId);
		const promptComparable =
			canonicalJson(baselineMetrics.promptVariantIds) === canonicalJson(retestMetrics.promptVariantIds);
		const providerComparable =
			canonicalJson(baselineMetrics.providerConfiguration) === canonicalJson(retestMetrics.providerConfiguration);
		const comparable = promptComparable && providerComparable;
		let outcome: AuditComparisonOutcome;
		let confidence: number;
		let reasonCodes: string[];

		if (!comparable) {
			outcome = "insufficient_evidence";
			confidence = 0.5;
			reasonCodes = [
				promptComparable ? "provider_model_or_benchmark_mismatch" : "frozen_prompt_configuration_mismatch",
				"non_comparable_configuration_no_change_claimed",
			];
		} else if (
			decision.decisionState === "pending_human_review" ||
			baselineMetrics.pendingReview ||
			retestMetrics.pendingReview
		) {
			outcome = "pending_human_review";
			confidence = 0.5;
			reasonCodes = ["ambiguous_or_low_confidence_evidence", "comparison_withheld_pending_human_review"];
		} else if (
			decision.decisionState === "insufficient_evidence" ||
			baselineMetrics.sampleSize === 0 ||
			retestMetrics.sampleSize === 0
		) {
			outcome = "insufficient_evidence";
			confidence = 0.5;
			reasonCodes = ["minimum_evidence_not_met", "no_improvement_or_regression_claimed"];
		} else {
			const regression = metricRegression(baselineMetrics, retestMetrics);
			const acceptance = stageAcceptance(decision.likelyFailureStage, baselineMetrics, retestMetrics);
			if (regression) {
				outcome = "regressed";
				confidence = 0.94;
				reasonCodes = [regression, "classified_evidence_regression_precedes_improvement"];
			} else if (decision.decisionState === "maintain") {
				outcome = "unchanged";
				confidence = 0.93;
				reasonCodes = ["maintain_evidence_remains_stable", "no_major_remediation_required"];
			} else if (acceptance) {
				outcome = "improved";
				confidence = 0.92;
				reasonCodes = [acceptance, "remediation_acceptance_signal_observed", "association_not_causation"];
			} else {
				outcome = "unchanged";
				confidence = 0.88;
				reasonCodes = ["remediation_acceptance_criteria_not_met", "no_material_classified_evidence_change"];
				if (
					retestMetrics.targetAcceptedMentionEvidenceCount > baselineMetrics.targetAcceptedMentionEvidenceCount &&
					retestMetrics.targetRecommendedRuns === baselineMetrics.targetRecommendedRuns
				) {
					reasonCodes.push("higher_mention_count_alone_not_improvement");
				}
				if (
					retestMetrics.targetAcceptedCitationLinks === baselineMetrics.targetAcceptedCitationLinks &&
					retest.citationEvidence.length > baseline.citationEvidence.length
				) {
					reasonCodes.push("unlinked_citation_presence_not_improvement");
				}
				if (retestMetrics.competitorAboveTarget) reasonCodes.push("competitor_remains_ranked_above_target");
			}
		}

		const criteriaStatus: RetestCriterionEvaluation["status"] =
			outcome === "improved"
				? "accepted"
				: outcome === "unchanged" || outcome === "regressed"
					? "rejected"
					: "not_assessed";
		const id = deterministicUuid(
			`audit-comparison:${frozenReport.id}:${retest.auditRun.id}:${decision.intentFamilyId}:${RETEST_COMPARATOR_VERSION}`,
		);
		const createdAt = new Date(input.createdAt);
		const withoutChecksum: Omit<AuditRetestComparisonRecord, "comparisonChecksum"> = {
			id,
			brandId: frozenReport.brandId,
			frozenReportId: frozenReport.id,
			baselineAuditRunId: baseline.auditRun.id,
			retestAuditRunId: retest.auditRun.id,
			intentFamilyId: decision.intentFamilyId,
			findingId: decision.findingId,
			remediationId: decision.remediationId,
			schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
			comparisonVersion: 1,
			outcome,
			confidence,
			reasonCodes,
			decisionState: decision.decisionState,
			promptVariantIds: decision.promptVariantIds,
			baselineEvidenceIds: baselineMetrics.evidenceIds,
			retestEvidenceIds: retestMetrics.evidenceIds,
			acceptanceCriteriaSnapshot: decision.acceptanceCriteria,
			expectedEvidenceChangeSnapshot: decision.expectedEvidenceChange,
			criteriaEvaluation: decision.acceptanceCriteria.map((criterion) => ({
				criterion,
				status: criteriaStatus,
				reasonCode: reasonCodes[0] ?? "comparison_policy_result",
			})),
			baselineMetrics,
			retestMetrics,
			observedChanges: observedChanges(baselineMetrics, retestMetrics),
			providerConfigurationSnapshot: {
				baseline: baselineMetrics.providerConfiguration,
				retest: retestMetrics.providerConfiguration,
				comparable,
			},
			comparatorId: RETEST_COMPARATOR_ID,
			comparatorVersion: RETEST_COMPARATOR_VERSION,
			correlationId: `${retest.auditRun.correlationId}:comparison:${decision.intentKey}`,
			createdAt,
		};
		return { ...withoutChecksum, comparisonChecksum: sha256(comparisonChecksumPayload(withoutChecksum)) };
	});
}

export function summarizeComparisonOutcomes(
	records: AuditRetestComparisonRecord[],
): Record<AuditComparisonOutcome, number> {
	const counts: Record<AuditComparisonOutcome, number> = {
		improved: 0,
		unchanged: 0,
		regressed: 0,
		insufficient_evidence: 0,
		pending_human_review: 0,
	};
	for (const record of records) counts[record.outcome]++;
	return counts;
}
