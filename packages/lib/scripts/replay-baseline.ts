import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/db/db";
import { persistReplayAuditBundle } from "../src/db/evidence-store";
import { brands, competitors } from "../src/db/schema";
import { createReplayAuditBundle, summarizeReplayAudit } from "../src/replay-audit";

function assertLocalDatabase(): void {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required for local fixture persistence");
	const hostname = new URL(databaseUrl).hostname;
	if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
		throw new Error("Fixture replay persistence is restricted to a localhost database");
	}
}

async function main(): Promise<void> {
	assertLocalDatabase();
	const requestedBrandId = process.argv.find((argument) => argument.startsWith("--brand="))?.slice("--brand=".length);
	const brand = requestedBrandId
		? await db.query.brands.findFirst({ where: eq(brands.id, requestedBrandId) })
		: await db.query.brands.findFirst();
	if (!brand) throw new Error("No local brand exists for fixture replay");

	const brandCompetitors = await db.query.competitors.findMany({
		where: eq(competitors.brandId, brand.id),
	});
	const replayedAt = new Date();
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
		correlationId: `local-fixture-replay:${brand.id}:${replayedAt.toISOString()}:${randomUUID()}`,
		replayedAt,
	});

	await persistReplayAuditBundle(bundle);
	console.log(JSON.stringify(summarizeReplayAudit(bundle), null, 2));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
