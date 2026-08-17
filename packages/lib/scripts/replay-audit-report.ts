import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
	compareFrozenBaselineToRetest,
	createDeterministicRetestBundle,
	createFrozenAuditReport,
	summarizeComparisonOutcomes,
} from "../src/audit-report";
import { db } from "../src/db/db";
import { persistAuditRetestComparisons, persistFrozenAuditReport } from "../src/db/audit-report-store";
import { persistReplayAuditBundle } from "../src/db/evidence-store";
import { brands, competitors } from "../src/db/schema";
import { createReplayAuditBundle, summarizeReplayAudit } from "../src/replay-audit";

function assertLocalDatabase(): void {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for local fixture report persistence");
	const hostname = new URL(databaseUrl).hostname;
	if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
		throw new Error("Fixture report persistence is restricted to a localhost database");
	}
}

async function main(): Promise<void> {
	assertLocalDatabase();
	const requestedBrandId = process.argv.find((argument) => argument.startsWith("--brand="))?.slice("--brand=".length);
	const brand = requestedBrandId
		? await db.query.brands.findFirst({ where: eq(brands.id, requestedBrandId) })
		: await db.query.brands.findFirst();
	if (!brand) throw new Error("No local brand exists for fixture report persistence");
	const brandCompetitors = await db.query.competitors.findMany({ where: eq(competitors.brandId, brand.id) });
	const identity = {
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
	const baselineAt = new Date();
	const baseline = createReplayAuditBundle({
		...identity,
		correlationId: `local-fixture-report:${brand.id}:${baselineAt.toISOString()}:${randomUUID()}`,
		replayedAt: baselineAt,
	});
	await persistReplayAuditBundle(baseline);
	const frozenAt = new Date(baselineAt.getTime() + 1);
	const frozen = await persistFrozenAuditReport(createFrozenAuditReport({ baseline, ...identity, frozenAt }));
	const retestedAt = new Date(baselineAt.getTime() + 2);
	const retest = createDeterministicRetestBundle({ frozenReport: frozen, ...identity, retestedAt });
	await persistReplayAuditBundle(retest);
	const comparisons = compareFrozenBaselineToRetest({ frozenReport: frozen, baseline, retest, createdAt: retestedAt });
	await persistAuditRetestComparisons(comparisons);
	console.log(
		JSON.stringify(
			{
				baseline: summarizeReplayAudit(baseline),
				frozenReportId: frozen.id,
				frozenChecksum: frozen.snapshotChecksum,
				retest: summarizeReplayAudit(retest),
				comparisonOutcomes: summarizeComparisonOutcomes(comparisons),
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
