import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/db";
import {
	auditRuns,
	citationClaimEvidenceLinks,
	citationEvidenceRecords,
	diagnosisFindings,
	entityIdentityEvidenceRecords,
	evidenceRemediations,
	providerResponsePayloads,
	providerRuns,
} from "../src/db/schema";
import { AUDIT_RECORD_SCHEMA_VERSION } from "../src/replay-audit";

function assertLocalDatabase(): void {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for local fixture verification");
	const hostname = new URL(databaseUrl).hostname;
	if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
		throw new Error("Fixture replay verification is restricted to a localhost database");
	}
}

function isImmutableUpdateError(error: unknown): boolean {
	let current: unknown = error;
	const visited = new Set<unknown>();
	while (current && typeof current === "object" && !visited.has(current)) {
		visited.add(current);
		const candidate = current as { message?: unknown; code?: unknown; cause?: unknown };
		if (
			(typeof candidate.message === "string" && candidate.message.includes("immutable evidence records")) ||
			candidate.code === "P0001"
		) {
			return true;
		}
		current = candidate.cause;
	}
	return false;
}

async function main(): Promise<void> {
	assertLocalDatabase();
	const [latest] = await db
		.select()
		.from(auditRuns)
		.where(
			and(
				eq(auditRuns.runKind, "baseline"),
				eq(auditRuns.executionMode, "fixture_replay"),
				eq(auditRuns.schemaVersion, AUDIT_RECORD_SCHEMA_VERSION),
			),
		)
		.orderBy(desc(auditRuns.completedAt))
		.limit(1);
	if (!latest) throw new Error("No persisted fixture replay baseline found");

	const runs = await db
		.select({ id: providerRuns.id })
		.from(providerRuns)
		.where(eq(providerRuns.auditRunId, latest.id));
	const runIds = runs.map((run) => run.id);
	const [payloads, entities, citations] = await Promise.all([
		db
			.select({ id: providerResponsePayloads.id })
			.from(providerResponsePayloads)
			.where(inArray(providerResponsePayloads.providerRunId, runIds)),
		db
			.select({
				id: entityIdentityEvidenceRecords.id,
				role: entityIdentityEvidenceRecords.entityRole,
				reviewState: entityIdentityEvidenceRecords.reviewState,
				classificationEvidence: entityIdentityEvidenceRecords.classificationEvidence,
			})
			.from(entityIdentityEvidenceRecords)
			.where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
		db
			.select({ citationType: citationEvidenceRecords.citationType })
			.from(citationEvidenceRecords)
			.where(inArray(citationEvidenceRecords.providerRunId, runIds)),
	]);
	const entityIds = entities.map((entity) => entity.id);
	const claimLinks = await db
		.select({
			id: citationClaimEvidenceLinks.id,
			status: citationClaimEvidenceLinks.status,
			correlationId: citationClaimEvidenceLinks.correlationId,
		})
		.from(citationClaimEvidenceLinks)
		.where(inArray(citationClaimEvidenceLinks.entityEvidenceId, entityIds));
	const [findings, remediations] = await Promise.all([
		db.select().from(diagnosisFindings).where(eq(diagnosisFindings.auditRunId, latest.id)),
		db.select().from(evidenceRemediations).where(eq(evidenceRemediations.auditRunId, latest.id)),
	]);

	let immutableUpdateRejected = false;
	try {
		await db.update(auditRuns).set({ correlationId: latest.correlationId }).where(eq(auditRuns.id, latest.id));
	} catch (error) {
		immutableUpdateRejected = isImmutableUpdateError(error);
		if (!immutableUpdateRejected) throw error;
	}
	if (!immutableUpdateRejected) throw new Error("Immutable audit update was not rejected");
	let immutableClaimLinkUpdateRejected = false;
	const firstClaimLink = claimLinks[0];
	if (!firstClaimLink) throw new Error("No citation claim link was persisted");
	try {
		await db
			.update(citationClaimEvidenceLinks)
			.set({ correlationId: firstClaimLink.correlationId })
			.where(eq(citationClaimEvidenceLinks.id, firstClaimLink.id));
	} catch (error) {
		immutableClaimLinkUpdateRejected = isImmutableUpdateError(error);
		if (!immutableClaimLinkUpdateRejected) throw error;
	}
	if (!immutableClaimLinkUpdateRejected) throw new Error("Immutable citation claim link update was not rejected");
	let immutableFindingUpdateRejected = false;
	const firstFinding = findings[0];
	if (!firstFinding) throw new Error("No diagnosis finding was persisted");
	try {
		await db
			.update(diagnosisFindings)
			.set({ correlationId: firstFinding.correlationId })
			.where(eq(diagnosisFindings.id, firstFinding.id));
	} catch (error) {
		immutableFindingUpdateRejected = isImmutableUpdateError(error);
		if (!immutableFindingUpdateRejected) throw error;
	}
	if (!immutableFindingUpdateRejected) throw new Error("Immutable diagnosis finding update was not rejected");
	let immutableRemediationUpdateRejected = false;
	const firstRemediation = remediations[0];
	if (!firstRemediation) throw new Error("No evidence remediation was persisted");
	try {
		await db
			.update(evidenceRemediations)
			.set({ correlationId: firstRemediation.correlationId })
			.where(eq(evidenceRemediations.id, firstRemediation.id));
	} catch (error) {
		immutableRemediationUpdateRejected = isImmutableUpdateError(error);
		if (!immutableRemediationUpdateRejected) throw error;
	}
	if (!immutableRemediationUpdateRejected) throw new Error("Immutable remediation update was not rejected");

	const citationTypes = citations.reduce<Record<string, number>>((counts, citation) => {
		counts[citation.citationType] = (counts[citation.citationType] ?? 0) + 1;
		return counts;
	}, {});
	const verification = {
		auditRunId: latest.id,
		providerRuns: runs.length,
		responsePayloads: payloads.length,
		entityEvidence: entities.length,
		citationEvidence: citations.length,
		citationClaimLinks: claimLinks.length,
		acceptedCitationClaimLinks: claimLinks.filter((link) => link.status === "accepted").length,
		rejectedCitationClaimLinks: claimLinks.filter((link) => link.status === "rejected").length,
		pendingReviewEntities: entities.filter((entity) => entity.reviewState === "pending").length,
		unknownEntities: entities.filter((entity) => entity.role === "unknown").length,
		classificationTraces: entities.filter(
			(entity) => Object.keys(entity.classificationEvidence as Record<string, unknown>).length > 0,
		).length,
		diagnosisFindings: findings.length,
		remediations: remediations.length,
		maintainDecisions: findings.filter((finding) => finding.likelyFailureStage === "maintain").length,
		diagnosisReviewRequired: findings.filter((finding) => finding.reviewState === "pending").length,
		insufficientEvidenceFindings: findings.filter((finding) => finding.likelyFailureStage === "insufficient_evidence").length,
		repeatedCompetitorAuthorityFindings: findings.filter((finding) => {
			const evidence = finding.diagnosisEvidence as { competitorCitationGap?: { repeatedSupportingEvidence?: unknown } };
			return evidence.competitorCitationGap?.repeatedSupportingEvidence === true;
		}).length,
		citationTypes,
		fixtureSetChecksumLength: latest.fixtureSetChecksum.length,
		immutableUpdateRejected,
		immutableClaimLinkUpdateRejected,
		immutableFindingUpdateRejected,
		immutableRemediationUpdateRejected,
	};
	if (
		verification.providerRuns !== 18 ||
		verification.responsePayloads !== 18 ||
		verification.entityEvidence !== 40 ||
		verification.citationEvidence !== 9 ||
		verification.citationClaimLinks !== 14 ||
		verification.acceptedCitationClaimLinks !== 11 ||
		verification.rejectedCitationClaimLinks !== 3 ||
		verification.pendingReviewEntities !== 4 ||
		verification.unknownEntities !== 4 ||
		verification.classificationTraces !== 40 ||
		verification.diagnosisFindings !== 16 ||
		verification.remediations !== 15 ||
		verification.maintainDecisions !== 1 ||
		verification.diagnosisReviewRequired !== 2 ||
		verification.insufficientEvidenceFindings !== 1 ||
		verification.repeatedCompetitorAuthorityFindings !== 1 ||
		verification.fixtureSetChecksumLength !== 64
	) {
		throw new Error(`Persisted replay evidence is incomplete: ${JSON.stringify(verification)}`);
	}
	console.log(JSON.stringify(verification, null, 2));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
