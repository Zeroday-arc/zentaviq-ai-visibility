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
	citationEvidenceRecords,
	competitors,
	entityIdentityEvidenceRecords,
	providerResponsePayloads,
	providerRuns,
} from "@workspace/lib/db/schema";
import { createReplayAuditBundle, type CitationType, type ReplayAuditSummary } from "@workspace/lib/replay-audit";

const brandInputSchema = z.object({ brandId: z.string().min(1) });

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
			retrievedRuns: 0,
			mentionedEntities: 0,
			recommendedEntities: 0,
			citedEntities: 0,
			citationTypes: { first_party: 0, independent: 0, competitor: 0, unknown: 0 },
			completedAt: auditRun.completedAt.toISOString(),
		};
	}

	const [payloads, entities, citations] = await Promise.all([
		db
			.select({ id: providerResponsePayloads.id })
			.from(providerResponsePayloads)
			.where(inArray(providerResponsePayloads.providerRunId, runIds)),
		db
			.select({
				mentioned: entityIdentityEvidenceRecords.mentioned,
				recommended: entityIdentityEvidenceRecords.recommended,
				cited: entityIdentityEvidenceRecords.cited,
			})
			.from(entityIdentityEvidenceRecords)
			.where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
		db
			.select({ citationType: citationEvidenceRecords.citationType })
			.from(citationEvidenceRecords)
			.where(inArray(citationEvidenceRecords.providerRunId, runIds)),
	]);

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
		retrievedRuns: runs.filter((run) => run.retrievalStatus === "retrieved").length,
		mentionedEntities: entities.filter((entity) => entity.mentioned).length,
		recommendedEntities: entities.filter((entity) => entity.recommended).length,
		citedEntities: entities.filter((entity) => entity.cited).length,
		citationTypes,
		completedAt: auditRun.completedAt.toISOString(),
	};
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
				),
			)
			.orderBy(desc(auditRuns.completedAt))
			.limit(1);

		return latest ? readPersistedSummary(latest.id) : null;
	});

export const runReplayBaselineFn = createServerFn({ method: "POST" })
	.validator(brandInputSchema)
	.handler(async ({ data }): Promise<ReplayAuditSummary> => {
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
		const persisted = await readPersistedSummary(bundle.auditRun.id);
		if (!persisted) throw new Error("Replay baseline was not persisted");
		return persisted;
	});
