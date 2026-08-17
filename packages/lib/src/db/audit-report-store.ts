import { and, desc, eq, inArray } from "drizzle-orm";
import {
	type AuditRetestComparisonRecord,
	type FrozenAuditReportRecord,
	verifyAuditComparisonChecksum,
	verifyFrozenAuditReportChecksum,
} from "../audit-report";
import { auditRetestComparisons, frozenAuditReports } from "./schema";
import { db } from "./db";

function hydrateFrozenAuditReport(record: typeof frozenAuditReports.$inferSelect): FrozenAuditReportRecord {
	const typed = record as unknown as FrozenAuditReportRecord;
	return {
		...typed,
		intentVersionSnapshot: typed.intentVersionSnapshot.map((intent) => ({
			...intent,
			createdAt: new Date(intent.createdAt),
		})),
		promptVersionSnapshot: typed.promptVersionSnapshot.map((prompt) => ({
			...prompt,
			frozenAt: new Date(prompt.frozenAt),
			createdAt: new Date(prompt.createdAt),
		})),
		providerVersionSnapshot: typed.providerVersionSnapshot.map((provider) => ({
			...provider,
			recordedAt: new Date(provider.recordedAt),
		})),
	};
}

export async function persistFrozenAuditReport(record: FrozenAuditReportRecord): Promise<FrozenAuditReportRecord> {
	if (!verifyFrozenAuditReportChecksum(record))
		throw new Error("Frozen report checksum verification failed before persistence");
	await db.insert(frozenAuditReports).values(record).onConflictDoNothing();
	const persisted = await db.query.frozenAuditReports.findFirst({ where: eq(frozenAuditReports.id, record.id) });
	if (!persisted) throw new Error("Frozen report was not persisted");
	const typed = hydrateFrozenAuditReport(persisted);
	if (typed.snapshotChecksum !== record.snapshotChecksum || !verifyFrozenAuditReportChecksum(typed)) {
		throw new Error("Immutable frozen report conflict detected");
	}
	return typed;
}

export async function findFrozenAuditReportForBaseline(
	baselineAuditRunId: string,
	brandId: string,
): Promise<FrozenAuditReportRecord | null> {
	const record = await db.query.frozenAuditReports.findFirst({
		where: and(eq(frozenAuditReports.baselineAuditRunId, baselineAuditRunId), eq(frozenAuditReports.brandId, brandId)),
	});
	return record ? hydrateFrozenAuditReport(record) : null;
}

export async function findLatestFrozenAuditReport(brandId: string): Promise<FrozenAuditReportRecord | null> {
	const [record] = await db
		.select()
		.from(frozenAuditReports)
		.where(eq(frozenAuditReports.brandId, brandId))
		.orderBy(desc(frozenAuditReports.frozenAt))
		.limit(1);
	return record ? hydrateFrozenAuditReport(record) : null;
}

export async function persistAuditRetestComparisons(
	records: AuditRetestComparisonRecord[],
): Promise<AuditRetestComparisonRecord[]> {
	if (records.length === 0) throw new Error("At least one retest comparison is required");
	const [first] = records;
	if (!first) throw new Error("At least one retest comparison is required");
	if (
		records.some(
			(record) =>
				record.brandId !== first.brandId ||
				record.frozenReportId !== first.frozenReportId ||
				record.retestAuditRunId !== first.retestAuditRunId,
		)
	) {
		throw new Error("Cross-report or cross-tenant comparison persistence is not permitted");
	}
	if (records.some((record) => !verifyAuditComparisonChecksum(record))) {
		throw new Error("Retest comparison checksum verification failed before persistence");
	}
	await db.insert(auditRetestComparisons).values(records).onConflictDoNothing();
	const persisted = await db
		.select()
		.from(auditRetestComparisons)
		.where(
			inArray(
				auditRetestComparisons.id,
				records.map((record) => record.id),
			),
		);
	if (persisted.length !== records.length) throw new Error("Not all retest comparisons were persisted");
	const expectedChecksums = new Map(records.map((record) => [record.id, record.comparisonChecksum]));
	for (const row of persisted) {
		if (expectedChecksums.get(row.id) !== row.comparisonChecksum)
			throw new Error("Immutable retest comparison conflict detected");
		if (!verifyAuditComparisonChecksum(row as AuditRetestComparisonRecord)) {
			throw new Error("Persisted retest comparison checksum verification failed");
		}
	}
	return persisted as AuditRetestComparisonRecord[];
}

export async function readAuditRetestComparisons(
	frozenReportId: string,
	brandId: string,
): Promise<AuditRetestComparisonRecord[]> {
	const rows = await db
		.select()
		.from(auditRetestComparisons)
		.where(and(eq(auditRetestComparisons.frozenReportId, frozenReportId), eq(auditRetestComparisons.brandId, brandId)));
	return rows as AuditRetestComparisonRecord[];
}
