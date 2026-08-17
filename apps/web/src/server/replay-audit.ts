import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import { db } from "@workspace/lib/db/db";
import { persistReplayAuditBundle } from "@workspace/lib/db/evidence-store";
import {
	auditRuns,
	brands,
	citationClaimEvidenceLinks,
	citationEvidenceRecords,
	competitors,
	diagnosisFindings,
	entityIdentityEvidenceRecords,
	evidenceRemediations,
	frozenPromptVariants,
	intentFamilies,
	providerResponsePayloads,
	providerRuns,
} from "@workspace/lib/db/schema";
import {
	AUDIT_RECORD_SCHEMA_VERSION,
	createReplayAuditBundle,
	type CitationType,
	type DiagnosisEvidenceSummary,
	type EntityClassificationTrace,
	type LikelyFailureStage,
	type RemediationActionCategory,
	type ReplayAuditSummary,
} from "@workspace/lib/replay-audit";

const brandInputSchema = z.object({ brandId: z.string().min(1) });

export interface ReplayEvidenceView {
	summary: ReplayAuditSummary;
	scenarios: Array<{
		providerRunId: string;
		fixtureId: string;
		promptText: string;
		rawResponse: string;
		providerRetrieved: boolean;
		correlationId: string;
		extractorId: string;
		extractorVersion: string;
		entities: Array<{
			id: string;
			name: string;
			role: "brand" | "competitor" | "unknown";
			retrieved: boolean;
			mentioned: boolean;
			recommended: boolean;
			prominenceRank: number | null;
			cited: boolean;
			reviewState: "not_required" | "pending" | "accepted" | "rejected";
			trace: EntityClassificationTrace;
		}>;
		citations: Array<{
			id: string;
			type: CitationType;
			url: string;
			title: string | null;
			links: Array<{
				entityEvidenceId: string;
				entityName: string;
				claim: "identity" | "mention" | "recommendation";
				status: "accepted" | "rejected" | "ambiguous" | "not_detected";
				rule: string;
				classifierVersion: string;
				excerpt: string;
				start: number;
				end: number;
			}>;
		}>;
	}>;
	diagnoses: Array<{
		id: string;
		intentKey: string;
		intentName: string;
		promptText: string;
		frozenPromptVersion: number;
		likelyFailureStage: LikelyFailureStage;
		confidence: number;
		reasonCodes: string[];
		supportingEvidenceIds: string[];
		contradictingEvidenceIds: string[];
		affectedProviderRunIds: string[];
		reviewState: "not_required" | "pending" | "accepted" | "rejected";
		classifierId: string;
		classifierVersion: string;
		policyVersion: string;
		correlationId: string;
		evidence: DiagnosisEvidenceSummary;
		affectedRuns: Array<{
			providerRunId: string;
			fixtureId: string;
			rawResponse: string;
			entities: Array<{
				name: string;
				role: "brand" | "competitor" | "unknown";
				retrieved: boolean;
				mentioned: boolean;
				recommended: boolean;
				prominenceRank: number | null;
				cited: boolean;
			}>;
		}>;
		remediation: null | {
			id: string;
			actionCategory: RemediationActionCategory;
			rationale: string;
			acceptanceCriteria: string[];
			priority: "low" | "medium" | "high";
			confidence: number;
			expectedEvidenceChange: string[];
			approvalState: "not_required" | "proposed" | "pending_human_review" | "approved" | "rejected";
			policyVersion: string;
		};
	}>;
}

function requireLocalReplayMode(): void {
	if (getDeployment().mode !== "local") {
		throw new Error("Fixture replay is available only in local development mode");
	}
}

async function readPersistedSummary(auditRunId: string): Promise<ReplayAuditSummary | null> {
	const auditRun = await db.query.auditRuns.findFirst({
		where: eq(auditRuns.id, auditRunId),
	});
	if (!auditRun) return null;

	const runs = await db
		.select({ id: providerRuns.id, retrievalStatus: providerRuns.retrievalStatus })
		.from(providerRuns)
		.where(eq(providerRuns.auditRunId, auditRunId));
	const runIds = runs.map((run) => run.id);
	if (runIds.length === 0) {
		return {
			auditRunId,
			correlationId: auditRun.correlationId,
			fixtureCount: 0,
			providerRunCount: 0,
			entityEvidenceCount: 0,
			citationEvidenceCount: 0,
			citationClaimLinkCount: 0,
			retrievedRuns: 0,
			mentionedEntities: 0,
			recommendedEntities: 0,
			citedEntities: 0,
			pendingReviewEntities: 0,
			diagnosisFindingCount: 0,
			remediationCount: 0,
			maintainDecisionCount: 0,
			diagnosisReviewCount: 0,
			citationTypes: { first_party: 0, independent: 0, competitor: 0, unknown: 0 },
			completedAt: auditRun.completedAt.toISOString(),
		};
	}

	const [payloads, entities, citations, findings, remediations] = await Promise.all([
		db
			.select({ id: providerResponsePayloads.id })
			.from(providerResponsePayloads)
			.where(inArray(providerResponsePayloads.providerRunId, runIds)),
		db
			.select({
				id: entityIdentityEvidenceRecords.id,
				mentioned: entityIdentityEvidenceRecords.mentioned,
				recommended: entityIdentityEvidenceRecords.recommended,
				cited: entityIdentityEvidenceRecords.cited,
				reviewState: entityIdentityEvidenceRecords.reviewState,
			})
			.from(entityIdentityEvidenceRecords)
			.where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
		db
			.select({ citationType: citationEvidenceRecords.citationType })
			.from(citationEvidenceRecords)
			.where(inArray(citationEvidenceRecords.providerRunId, runIds)),
		db.select().from(diagnosisFindings).where(eq(diagnosisFindings.auditRunId, auditRunId)),
		db.select().from(evidenceRemediations).where(eq(evidenceRemediations.auditRunId, auditRunId)),
	]);
	const entityIds = entities.map((entity) => entity.id).filter((id): id is string => Boolean(id));
	const citationClaimLinkCount = entityIds.length
		? (
				await db
					.select({ id: citationClaimEvidenceLinks.id })
					.from(citationClaimEvidenceLinks)
					.where(inArray(citationClaimEvidenceLinks.entityEvidenceId, entityIds))
			).length
		: 0;

	const citationTypes: Record<CitationType, number> = {
		first_party: 0,
		independent: 0,
		competitor: 0,
		unknown: 0,
	};
	for (const citation of citations) citationTypes[citation.citationType]++;

	return {
		auditRunId,
		correlationId: auditRun.correlationId,
		fixtureCount: payloads.length,
		providerRunCount: runs.length,
		entityEvidenceCount: entities.length,
		citationEvidenceCount: citations.length,
		citationClaimLinkCount,
		retrievedRuns: runs.filter((run) => run.retrievalStatus === "retrieved").length,
		mentionedEntities: entities.filter((entity) => entity.mentioned).length,
		recommendedEntities: entities.filter((entity) => entity.recommended).length,
		citedEntities: entities.filter((entity) => entity.cited).length,
		pendingReviewEntities: entities.filter((entity) => entity.reviewState === "pending").length,
		diagnosisFindingCount: findings.length,
		remediationCount: remediations.length,
		maintainDecisionCount: findings.filter((finding) => finding.likelyFailureStage === "maintain").length,
		diagnosisReviewCount: findings.filter((finding) => finding.reviewState === "pending").length,
		citationTypes,
		completedAt: auditRun.completedAt.toISOString(),
	};
}

async function readPersistedEvidence(auditRunId: string): Promise<ReplayEvidenceView | null> {
	const summary = await readPersistedSummary(auditRunId);
	if (!summary) return null;
	const runs = await db
		.select({
			id: providerRuns.id,
			promptVariantId: providerRuns.promptVariantId,
			correlationId: providerRuns.correlationId,
			extractorId: providerRuns.extractorId,
			extractorVersion: providerRuns.extractorVersion,
			promptText: frozenPromptVariants.promptText,
			promptVersion: frozenPromptVariants.version,
			intentFamilyId: frozenPromptVariants.intentFamilyId,
		})
		.from(providerRuns)
		.innerJoin(frozenPromptVariants, eq(providerRuns.promptVariantId, frozenPromptVariants.id))
		.where(eq(providerRuns.auditRunId, auditRunId));
	const runIds = runs.map((run) => run.id);
	if (runIds.length === 0) return { summary, scenarios: [], diagnoses: [] };
	const [payloads, entities, citations, findings, remediations] = await Promise.all([
		db.select().from(providerResponsePayloads).where(inArray(providerResponsePayloads.providerRunId, runIds)),
		db.select().from(entityIdentityEvidenceRecords).where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
		db.select().from(citationEvidenceRecords).where(inArray(citationEvidenceRecords.providerRunId, runIds)),
		db.select().from(diagnosisFindings).where(eq(diagnosisFindings.auditRunId, auditRunId)),
		db.select().from(evidenceRemediations).where(eq(evidenceRemediations.auditRunId, auditRunId)),
	]);
	const citationIds = citations.map((citation) => citation.id);
	const links = citationIds.length
		? await db
				.select()
				.from(citationClaimEvidenceLinks)
				.where(inArray(citationClaimEvidenceLinks.citationEvidenceId, citationIds))
		: [];
	const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
	const intentIds = [...new Set(findings.map((finding) => finding.intentFamilyId))];
	const intentRows = intentIds.length
		? await db.select().from(intentFamilies).where(inArray(intentFamilies.id, intentIds))
		: [];
	const intentsById = new Map(intentRows.map((intent) => [intent.id, intent]));
	const scenarios = runs
		.map((run) => {
			const payload = payloads.find((candidate) => candidate.providerRunId === run.id);
			if (!payload) return null;
			const rawPayload = payload.rawPayload as { retrieved: boolean; responseText: string };
			const runEntities = entities.filter((entity) => entity.providerRunId === run.id);
			return {
				providerRunId: run.id,
				fixtureId: payload.fixtureId,
				promptText: run.promptText,
				rawResponse: rawPayload.responseText,
				providerRetrieved: rawPayload.retrieved,
				correlationId: run.correlationId,
				extractorId: run.extractorId,
				extractorVersion: run.extractorVersion,
				entities: runEntities.map((entity) => {
					const identity = entity.identitySnapshot as { name?: unknown };
					return {
						id: entity.id,
						name: typeof identity.name === "string" ? identity.name : entity.entityId,
						role: entity.entityRole,
						retrieved: entity.retrieved,
						mentioned: entity.mentioned,
						recommended: entity.recommended,
						prominenceRank: entity.prominenceRank,
						cited: entity.cited,
						reviewState: entity.reviewState,
						trace: entity.classificationEvidence as EntityClassificationTrace,
					};
				}),
				citations: citations
					.filter((citation) => citation.providerRunId === run.id)
					.map((citation) => ({
						id: citation.id,
						type: citation.citationType,
						url: citation.originalUrl,
						title: citation.title,
						links: links
							.filter((link) => link.citationEvidenceId === citation.id)
							.map((link) => {
								const linkedEntity = entitiesById.get(link.entityEvidenceId);
								const identity = linkedEntity?.identitySnapshot as { name?: unknown } | undefined;
								return {
									entityEvidenceId: link.entityEvidenceId,
									entityName:
										typeof identity?.name === "string" ? identity.name : (linkedEntity?.entityId ?? "Unknown entity"),
									claim: link.claim,
									status: link.status,
									rule: link.reasonCodes[0] ?? "citation_claim_link",
									classifierVersion: link.classifierVersion,
									excerpt: link.sourceExcerpt,
									start: link.excerptStart,
									end: link.excerptEnd,
								};
							}),
					})),
			};
		})
		.filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario))
		.sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
	const scenariosByRunId = new Map(scenarios.map((scenario) => [scenario.providerRunId, scenario]));
	const promptsById = new Map(runs.map((run) => [run.promptVariantId, run]));
	const diagnoses = findings
		.map((finding) => {
			const intent = intentsById.get(finding.intentFamilyId);
			const prompt = promptsById.get(finding.promptVariantId);
			if (!intent || !prompt) return null;
			const remediation = remediations.find((candidate) => candidate.primaryFindingId === finding.id);
			return {
				id: finding.id,
				intentKey: intent.key,
				intentName: intent.name,
				promptText: prompt.promptText,
				frozenPromptVersion: finding.frozenPromptVersion,
				likelyFailureStage: finding.likelyFailureStage,
				confidence: finding.confidence,
				reasonCodes: finding.reasonCodes,
				supportingEvidenceIds: finding.supportingEvidenceIds,
				contradictingEvidenceIds: finding.contradictingEvidenceIds,
				affectedProviderRunIds: finding.affectedProviderRunIds,
				reviewState: finding.reviewState,
				classifierId: finding.classifierId,
				classifierVersion: finding.classifierVersion,
				policyVersion: finding.policyVersion,
				correlationId: finding.correlationId,
				evidence: finding.diagnosisEvidence as DiagnosisEvidenceSummary,
				affectedRuns: finding.affectedProviderRunIds
					.map((providerRunId) => scenariosByRunId.get(providerRunId))
					.filter((scenario): scenario is NonNullable<typeof scenario> => Boolean(scenario))
					.map((scenario) => ({
						providerRunId: scenario.providerRunId,
						fixtureId: scenario.fixtureId,
						rawResponse: scenario.rawResponse,
						entities: scenario.entities.map((entity) => ({
							name: entity.name,
							role: entity.role,
							retrieved: entity.retrieved,
							mentioned: entity.mentioned,
							recommended: entity.recommended,
							prominenceRank: entity.prominenceRank,
							cited: entity.cited,
						})),
					})),
				remediation: remediation
					? {
							id: remediation.id,
							actionCategory: remediation.actionCategory,
							rationale: remediation.rationale,
							acceptanceCriteria: remediation.acceptanceCriteria,
							priority: remediation.priority,
							confidence: remediation.confidence,
							expectedEvidenceChange: remediation.expectedEvidenceChange,
							approvalState: remediation.approvalState,
							policyVersion: remediation.policyVersion,
						}
					: null,
			};
		})
		.filter((diagnosis): diagnosis is NonNullable<typeof diagnosis> => Boolean(diagnosis))
		.sort((left, right) => left.intentKey.localeCompare(right.intentKey));
	return { summary, scenarios, diagnoses };
}

export const getLatestReplayBaselineFn = createServerFn({ method: "GET" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<ReplayAuditSummary | null> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const [latest] = await db
			.select({ id: auditRuns.id })
			.from(auditRuns)
			.where(
				and(
					eq(auditRuns.brandId, data.brandId),
					eq(auditRuns.runKind, "baseline"),
					eq(auditRuns.executionMode, "fixture_replay"),
					eq(auditRuns.schemaVersion, AUDIT_RECORD_SCHEMA_VERSION),
				),
			)
			.orderBy(desc(auditRuns.completedAt))
			.limit(1);

		return latest ? readPersistedSummary(latest.id) : null;
	});

export const getLatestReplayEvidenceFn = createServerFn({ method: "GET" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<ReplayEvidenceView | null> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const [latest] = await db
			.select({ id: auditRuns.id })
			.from(auditRuns)
			.where(
				and(
					eq(auditRuns.brandId, data.brandId),
					eq(auditRuns.runKind, "baseline"),
					eq(auditRuns.executionMode, "fixture_replay"),
					eq(auditRuns.schemaVersion, AUDIT_RECORD_SCHEMA_VERSION),
				),
			)
			.orderBy(desc(auditRuns.completedAt))
			.limit(1);
		return latest ? readPersistedEvidence(latest.id) : null;
	});

export const runReplayBaselineFn = createServerFn({ method: "POST" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<ReplayEvidenceView> => {
		requireLocalReplayMode();
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, data.brandId),
		});
		if (!brand) throw new Error("Brand not found");
		const brandCompetitors = await db.query.competitors.findMany({
			where: eq(competitors.brandId, data.brandId),
		});

		const replayedAt = new Date();
		const correlationId = `fixture-replay:${data.brandId}:${replayedAt.toISOString()}:${randomUUID()}`;
		const bundle = createReplayAuditBundle({
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
			correlationId,
			replayedAt,
		});

		await persistReplayAuditBundle(bundle);
		const persisted = await readPersistedEvidence(bundle.auditRun.id);
		if (!persisted) throw new Error("Replay baseline was not persisted");
		return persisted;
	});
