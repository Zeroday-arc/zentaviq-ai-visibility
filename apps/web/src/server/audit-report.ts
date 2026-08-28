import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import {
	compareFrozenBaselineToRetest,
	createDeterministicRetestBundle,
	createFrozenAuditReport,
	summarizeComparisonOutcomes,
	summarizeIntentEvidence,
	verifyFrozenAuditReportChecksum,
	type AuditComparisonOutcome,
	type AuditIntentMetrics,
	type AuditRetestComparisonRecord,
	type FrozenAuditReportRecord,
} from "@workspace/lib/audit-report";
import { db } from "@workspace/lib/db/db";
import {
	assertCompleteComparisonSet,
	findFrozenAuditReportForBaseline,
	findLatestFrozenAuditReport,
	persistCompleteRetest,
	persistFrozenAuditReport,
	readAuditRetestComparisons,
} from "@workspace/lib/db/audit-report-store";
import { loadPersistedReplayAuditBundle, persistReplayAuditBundle } from "@workspace/lib/db/evidence-store";
import { auditRuns, brands, competitors } from "@workspace/lib/db/schema";
import {
	AUDIT_RECORD_SCHEMA_VERSION,
	REPLAY_BENCHMARK_VERSION,
	summarizeReplayAudit,
	type CitationType,
	type DiagnosisEvidenceSummary,
	type LikelyFailureStage,
	type RemediationActionCategory,
	type ReplayAuditBundle,
	type ReplayAuditSummary,
} from "@workspace/lib/replay-audit";

const brandInputSchema = z.object({ brandId: z.string().min(1) });

export interface CustomerAuditReportView {
	frozen: {
		id: string;
		baselineAuditRunId: string;
		reportVersion: number;
		baselineVersion: number;
		reportGenerationVersion: string;
		benchmarkVersion: string;
		snapshotChecksum: string;
		frozenAt: string;
		correlationId: string;
		verified: boolean;
	};
	business: {
		name: string;
		website: string;
		aliases: string[];
		competitors: string[];
	};
	methodology: string[];
	providerDisclosure: Array<{
		providerId: string;
		modelId: string;
		modelVersion: string;
		benchmarkVersion: string | null;
		networkAccess: string | null;
	}>;
	baselineSummary: ReplayAuditSummary;
	retestSummary: ReplayAuditSummary | null;
	outcomeCounts: Record<AuditComparisonOutcome, number> | null;
	results: Array<{
		intentFamilyId: string;
		intentKey: string;
		intentName: string;
		prompts: Array<{ id: string; version: number; text: string; checksum: string }>;
		baselineMetrics: AuditIntentMetrics;
		retestMetrics: AuditIntentMetrics | null;
		diagnosis: {
			findingId: string;
			likelyFailureStage: LikelyFailureStage;
			confidence: number;
			reasonCodes: string[];
			supportingEvidenceIds: string[];
			contradictingEvidenceIds: string[];
			reviewState: string;
			classifierVersion: string;
			policyVersion: string;
		};
		remediation: null | {
			id: string;
			actionCategory: RemediationActionCategory;
			rationale: string;
			priority: "low" | "medium" | "high";
			approvalAtFreeze: string;
			acceptanceCriteria: string[];
			expectedEvidenceChange: string[];
		};
		competitorCitationGap: DiagnosisEvidenceSummary["competitorCitationGap"];
		comparison: null | {
			id: string;
			outcome: AuditComparisonOutcome;
			confidence: number;
			reasonCodes: string[];
			observedChanges: string[];
			criteriaEvaluation: AuditRetestComparisonRecord["criteriaEvaluation"];
			comparatorVersion: string;
			checksum: string;
		};
		trace: Array<{
			phase: "baseline" | "retest";
			providerRunId: string;
			fixtureId: string;
			rawResponse: string;
			entities: Array<{
				id: string;
				name: string;
				role: "brand" | "competitor" | "unknown";
				retrieved: boolean;
				mentioned: boolean;
				recommended: boolean;
				prominenceRank: number | null;
				cited: boolean;
				reviewState: string;
				ruleVersions: string[];
			}>;
			citations: Array<{
				id: string;
				type: CitationType;
				url: string;
				acceptedClaimLinkIds: string[];
			}>;
		}>;
	}>;
	limitations: string[];
}

function requireLocalReplayMode(): void {
	if (getDeployment().mode !== "local") throw new Error("Fixture audit reports are available only in local development mode");
}

function traceForIntent(
	bundle: ReplayAuditBundle,
	intentFamilyId: string,
	phase: "baseline" | "retest",
): CustomerAuditReportView["results"][number]["trace"] {
	const promptIds = new Set(
		bundle.promptVariants.filter((prompt) => prompt.intentFamilyId === intentFamilyId).map((prompt) => prompt.id),
	);
	const runs = bundle.providerRuns.filter((run) => promptIds.has(run.promptVariantId));
	return runs
		.map((run) => {
			const payload = bundle.responsePayloads.find((candidate) => candidate.providerRunId === run.id);
			if (!payload) throw new Error(`Missing response payload for report run ${run.id}`);
			const raw = payload.rawPayload;
			const entities = bundle.entityEvidence.filter((entity) => entity.providerRunId === run.id);
			const entityIds = new Set(entities.map((entity) => entity.id));
			return {
				phase,
				providerRunId: run.id,
				fixtureId: payload.fixtureId,
				rawResponse: raw.responseText,
				entities: entities.map((entity) => ({
					id: entity.id,
					name: entity.identitySnapshot.name,
					role: entity.entityRole,
					retrieved: entity.retrieved,
					mentioned: entity.mentioned,
					recommended: entity.recommended,
					prominenceRank: entity.prominenceRank,
					cited: entity.cited,
					reviewState: entity.reviewState,
					ruleVersions: [
						`${entity.classificationEvidence.classifier.id}@${entity.classificationEvidence.classifier.version}`,
						...entity.classificationEvidence.sources.map(
							(source) => `${source.matchRule}@${source.classifierVersion}`,
						),
					],
				})),
				citations: bundle.citationEvidence
					.filter((citation) => citation.providerRunId === run.id)
					.map((citation) => ({
						id: citation.id,
						type: citation.citationType,
						url: citation.originalUrl,
						acceptedClaimLinkIds: bundle.citationClaimLinks
							.filter(
								(link) =>
									link.citationEvidenceId === citation.id &&
									link.status === "accepted" &&
									entityIds.has(link.entityEvidenceId),
							)
							.map((link) => link.id),
					})),
			};
		})
		.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
}

async function buildCustomerAuditReportView(frozen: FrozenAuditReportRecord): Promise<CustomerAuditReportView> {
	const baseline = await loadPersistedReplayAuditBundle(frozen.baselineAuditRunId, frozen.brandId);
	if (!baseline) throw new Error("Frozen baseline evidence is unavailable");
	const comparisons = await readAuditRetestComparisons(frozen.id, frozen.brandId);
	const retestAuditRunId = comparisons[0]?.retestAuditRunId;
	const retest = retestAuditRunId
		? await loadPersistedReplayAuditBundle(retestAuditRunId, frozen.brandId)
		: null;
	const comparisonsByIntent = new Map(comparisons.map((comparison) => [comparison.intentFamilyId, comparison]));
	const decisions = new Map(frozen.decisionSnapshot.map((decision) => [decision.intentFamilyId, decision]));
	const results = frozen.intentVersionSnapshot
		.map((intent) => {
			const decision = decisions.get(intent.id);
			const finding = baseline.findings.find((candidate) => candidate.intentFamilyId === intent.id);
			if (!decision || !finding) throw new Error(`Frozen report is missing a decision for intent ${intent.id}`);
			const remediation = baseline.remediations.find((candidate) => candidate.id === decision.remediationId);
			const comparison = comparisonsByIntent.get(intent.id);
			const diagnosisEvidence = finding.diagnosisEvidence as DiagnosisEvidenceSummary;
			return {
				intentFamilyId: intent.id,
				intentKey: intent.key,
				intentName: intent.name,
				prompts: frozen.promptVersionSnapshot
					.filter((prompt) => prompt.intentFamilyId === intent.id)
					.map((prompt) => ({
						id: prompt.id,
						version: prompt.version,
						text: prompt.promptText,
						checksum: prompt.promptChecksum,
					})),
				baselineMetrics: summarizeIntentEvidence(baseline, intent.id),
				retestMetrics: retest ? summarizeIntentEvidence(retest, intent.id) : null,
				diagnosis: {
					findingId: finding.id,
					likelyFailureStage: finding.likelyFailureStage,
					confidence: finding.confidence,
					reasonCodes: finding.reasonCodes,
					supportingEvidenceIds: finding.supportingEvidenceIds,
					contradictingEvidenceIds: finding.contradictingEvidenceIds,
					reviewState: finding.reviewState,
					classifierVersion: finding.classifierVersion,
					policyVersion: finding.policyVersion,
				},
				remediation: remediation
					? {
							id: remediation.id,
							actionCategory: remediation.actionCategory,
							rationale: remediation.rationale,
							priority: remediation.priority,
							approvalAtFreeze: decision.remediationApprovalAtFreeze,
							acceptanceCriteria: remediation.acceptanceCriteria,
							expectedEvidenceChange: remediation.expectedEvidenceChange,
						}
					: null,
				competitorCitationGap: diagnosisEvidence.competitorCitationGap,
				comparison: comparison
					? {
							id: comparison.id,
							outcome: comparison.outcome,
							confidence: comparison.confidence,
							reasonCodes: comparison.reasonCodes,
							observedChanges: comparison.observedChanges,
							criteriaEvaluation: comparison.criteriaEvaluation,
							comparatorVersion: comparison.comparatorVersion,
							checksum: comparison.comparisonChecksum,
						}
					: null,
				trace: [
					...traceForIntent(baseline, intent.id, "baseline"),
					...(retest ? traceForIntent(retest, intent.id, "retest") : []),
				],
			};
		})
		.sort((left, right) => left.intentKey.localeCompare(right.intentKey));
	return {
		frozen: {
			id: frozen.id,
			baselineAuditRunId: frozen.baselineAuditRunId,
			reportVersion: frozen.reportVersion,
			baselineVersion: frozen.baselineVersion,
			reportGenerationVersion: frozen.reportGenerationVersion,
			benchmarkVersion: frozen.benchmarkVersion,
			snapshotChecksum: frozen.snapshotChecksum,
			frozenAt: frozen.frozenAt.toISOString(),
			correlationId: frozen.correlationId,
			verified: verifyFrozenAuditReportChecksum(frozen),
		},
		business: {
			name: frozen.businessIdentitySnapshot.brand.name,
			website: frozen.businessIdentitySnapshot.brand.website,
			aliases: frozen.businessIdentitySnapshot.brand.aliases ?? [],
			competitors: frozen.businessIdentitySnapshot.competitors.map((competitor) => competitor.name),
		},
		methodology: [
			"Bundled fixture responses are replayed locally with no provider, search, scraping, telemetry, or external-network request.",
			"Entity and citation evidence is classified deterministically before likely diagnosis and remediation policy are applied.",
			"Retest outcomes compare accepted evidence against the exact frozen intent, prompt, provider, model, and benchmark configuration.",
			"Observed retest changes are associations, not claims that a remediation caused the change.",
		],
		providerDisclosure: frozen.providerVersionSnapshot.map((provider) => ({
			providerId: provider.providerId,
			modelId: provider.modelId,
			modelVersion: provider.modelVersion,
			benchmarkVersion: provider.metadata.benchmarkVersion ?? null,
			networkAccess: provider.metadata.networkAccess ?? null,
		})),
		baselineSummary: summarizeReplayAudit(baseline),
		retestSummary: retest ? summarizeReplayAudit(retest) : null,
		outcomeCounts: comparisons.length ? summarizeComparisonOutcomes(comparisons) : null,
		results,
		limitations: [
			"Fixture replay measures only the frozen benchmark and does not establish real-world provider behaviour.",
			"A higher mention count or an unlinked citation does not establish target improvement.",
			"Ambiguous identity evidence remains pending human review rather than being forced into a directional outcome.",
			"Provider/model/benchmark mismatches are not compared directionally.",
		],
	};
}

async function latestBaselineId(brandId: string): Promise<string | null> {
	const [latest] = await db
		.select({ id: auditRuns.id })
		.from(auditRuns)
		.where(
			and(
				eq(auditRuns.brandId, brandId),
				eq(auditRuns.runKind, "baseline"),
				eq(auditRuns.executionMode, "fixture_replay"),
				eq(auditRuns.schemaVersion, AUDIT_RECORD_SCHEMA_VERSION),
			),
		)
		.orderBy(desc(auditRuns.completedAt))
		.limit(1);
	return latest?.id ?? null;
}

async function brandInputs(brandId: string) {
	const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
	if (!brand) throw new Error("Brand not found");
	const brandCompetitors = await db.query.competitors.findMany({ where: eq(competitors.brandId, brandId) });
	return {
		brand: {
			id: brand.id,
			name: brand.name,
			website: brand.website,
			aliases: brand.aliases,
			additionalDomains: brand.additionalDomains,
		},
		competitors: brandCompetitors.map((competitor) => ({
			id: competitor.id,
			name: competitor.name,
			domains: competitor.domains,
			aliases: competitor.aliases,
		})),
	};
}

export const getLatestAuditReportFn = createServerFn({ method: "GET" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<CustomerAuditReportView | null> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const frozen = await findLatestFrozenAuditReport(data.brandId);
		return frozen ? buildCustomerAuditReportView(frozen) : null;
	});

export const freezeLatestReplayBaselineFn = createServerFn({ method: "POST" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<CustomerAuditReportView> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const baselineId = await latestBaselineId(data.brandId);
		if (!baselineId) throw new Error("Run the fixture baseline before freezing a report");
		const existing = await findFrozenAuditReportForBaseline(baselineId, data.brandId);
		if (existing) return buildCustomerAuditReportView(existing);
		const baseline = await loadPersistedReplayAuditBundle(baselineId, data.brandId);
		if (!baseline) throw new Error("Baseline evidence is unavailable");
		if (
			baseline.providerModelVersions.some(
				(provider) => provider.metadata.benchmarkVersion !== REPLAY_BENCHMARK_VERSION,
			)
		) {
			throw new Error("Run a new fixture baseline with the current benchmark before freezing");
		}
		const identity = await brandInputs(data.brandId);
		const frozen = createFrozenAuditReport({ baseline, ...identity, frozenAt: new Date() });
		return buildCustomerAuditReportView(await persistFrozenAuditReport(frozen));
	});

export const runDeterministicRetestFn = createServerFn({ method: "POST" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<CustomerAuditReportView> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const frozen = await findLatestFrozenAuditReport(data.brandId);
		if (!frozen) throw new Error("Freeze the fixture baseline before running a retest");
		const existing = await readAuditRetestComparisons(frozen.id, data.brandId);
		const expectedIntentFamilyIds = frozen.decisionSnapshot.map((decision) => decision.intentFamilyId);
		if (existing.length > 0) {
			assertCompleteComparisonSet(existing, expectedIntentFamilyIds);
			return buildCustomerAuditReportView(frozen);
		}
		const baseline = await loadPersistedReplayAuditBundle(frozen.baselineAuditRunId, data.brandId);
		if (!baseline) throw new Error("Frozen baseline evidence is unavailable");
		const identity = await brandInputs(data.brandId);
		const retestedAt = new Date();
		const retestCandidate = createDeterministicRetestBundle({ frozenReport: frozen, ...identity, retestedAt });
		const comparisons = compareFrozenBaselineToRetest({
			frozenReport: frozen,
			baseline,
			retest: retestCandidate,
			createdAt: retestedAt,
		});
		await persistCompleteRetest({ retest: retestCandidate, comparisons, expectedIntentFamilyIds });
		return buildCustomerAuditReportView(frozen);
	});
