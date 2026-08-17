import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/db";
import {
	auditRuns,
	citationEvidenceRecords,
	entityIdentityEvidenceRecords,
	providerResponsePayloads,
	providerRuns,
} from "../src/db/schema";

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
		.where(and(eq(auditRuns.runKind, "baseline"), eq(auditRuns.executionMode, "fixture_replay")))
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
			.select({ id: entityIdentityEvidenceRecords.id })
			.from(entityIdentityEvidenceRecords)
			.where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
		db
			.select({ citationType: citationEvidenceRecords.citationType })
			.from(citationEvidenceRecords)
			.where(inArray(citationEvidenceRecords.providerRunId, runIds)),
	]);

	let immutableUpdateRejected = false;
	try {
		await db.update(auditRuns).set({ correlationId: latest.correlationId }).where(eq(auditRuns.id, latest.id));
	} catch (error) {
		immutableUpdateRejected = isImmutableUpdateError(error);
		if (!immutableUpdateRejected) throw error;
	}
	if (!immutableUpdateRejected) throw new Error("Immutable audit update was not rejected");

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
		citationTypes,
		fixtureSetChecksumLength: latest.fixtureSetChecksum.length,
		immutableUpdateRejected,
	};
	if (
		verification.providerRuns !== 4 ||
		verification.responsePayloads !== 4 ||
		verification.entityEvidence !== 8 ||
		verification.citationEvidence !== 3 ||
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
