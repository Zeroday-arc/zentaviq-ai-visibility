import { eq, inArray } from "drizzle-orm";
import { canonicalJson, type ReplayAuditBundle } from "../replay-audit";
import { db } from "./db";
import {
	auditRuns,
	citationClaimEvidenceLinks,
	citationEvidenceRecords,
	diagnosisFindings,
	entityIdentityEvidenceRecords,
	evidenceRemediations,
	frozenPromptVariants,
	intentFamilies,
	providerModelVersions,
	providerResponsePayloads,
	providerRuns,
} from "./schema";

export interface ImmutableEvidenceStore {
	persist(bundle: ReplayAuditBundle): Promise<void>;
}

type EvidenceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EvidenceRecord = { id: string };

function assertCanonicalRows(collection: string, expected: EvidenceRecord[], persisted: EvidenceRecord[]): void {
	if (persisted.length !== expected.length) {
		throw new Error(`Not all immutable evidence was persisted for ${collection}`);
	}
	const expectedById = new Map(expected.map((record) => [record.id, canonicalJson(record)]));
	for (const record of persisted) {
		if (expectedById.get(record.id) !== canonicalJson(record)) {
			throw new Error(`Immutable evidence conflict for ${collection}:${record.id}`);
		}
	}
}

export async function persistReplayAuditBundleInTransaction(
	tx: EvidenceTransaction,
	bundle: ReplayAuditBundle,
): Promise<void> {
	if (bundle.intentFamilies.length > 0) {
		await tx.insert(intentFamilies).values(bundle.intentFamilies).onConflictDoNothing();
	}
	if (bundle.promptVariants.length > 0) {
		await tx.insert(frozenPromptVariants).values(bundle.promptVariants).onConflictDoNothing();
	}
	if (bundle.providerModelVersions.length > 0) {
		await tx.insert(providerModelVersions).values(bundle.providerModelVersions).onConflictDoNothing();
	}
	await tx.insert(auditRuns).values(bundle.auditRun).onConflictDoNothing();
	if (bundle.providerRuns.length > 0) await tx.insert(providerRuns).values(bundle.providerRuns).onConflictDoNothing();
	if (bundle.responsePayloads.length > 0)
		await tx.insert(providerResponsePayloads).values(bundle.responsePayloads).onConflictDoNothing();
	if (bundle.entityEvidence.length > 0)
		await tx.insert(entityIdentityEvidenceRecords).values(bundle.entityEvidence).onConflictDoNothing();
	if (bundle.citationEvidence.length > 0)
		await tx.insert(citationEvidenceRecords).values(bundle.citationEvidence).onConflictDoNothing();
	if (bundle.citationClaimLinks.length > 0)
		await tx.insert(citationClaimEvidenceLinks).values(bundle.citationClaimLinks).onConflictDoNothing();
	if (bundle.findings.length > 0) await tx.insert(diagnosisFindings).values(bundle.findings).onConflictDoNothing();
	if (bundle.remediations.length > 0)
		await tx.insert(evidenceRemediations).values(bundle.remediations).onConflictDoNothing();

	const selectIds = async <T extends EvidenceRecord>(
		collection: string,
		table: Parameters<EvidenceTransaction["select"]>[0] extends never ? never : unknown,
		idColumn: unknown,
		expected: T[],
	): Promise<void> => {
		if (expected.length === 0) return;
		const rows = await tx
			.select()
			.from(table as typeof intentFamilies)
			.where(
				inArray(
					idColumn as typeof intentFamilies.id,
					expected.map((record) => record.id),
				),
			);
		assertCanonicalRows(collection, expected, rows as EvidenceRecord[]);
	};

	await selectIds("intentFamilies", intentFamilies, intentFamilies.id, bundle.intentFamilies);
	await selectIds("promptVariants", frozenPromptVariants, frozenPromptVariants.id, bundle.promptVariants);
	await selectIds(
		"providerModelVersions",
		providerModelVersions,
		providerModelVersions.id,
		bundle.providerModelVersions,
	);
	await selectIds("auditRuns", auditRuns, auditRuns.id, [bundle.auditRun]);
	await selectIds("providerRuns", providerRuns, providerRuns.id, bundle.providerRuns);
	await selectIds("responsePayloads", providerResponsePayloads, providerResponsePayloads.id, bundle.responsePayloads);
	await selectIds(
		"entityEvidence",
		entityIdentityEvidenceRecords,
		entityIdentityEvidenceRecords.id,
		bundle.entityEvidence,
	);
	await selectIds("citationEvidence", citationEvidenceRecords, citationEvidenceRecords.id, bundle.citationEvidence);
	await selectIds(
		"citationClaimLinks",
		citationClaimEvidenceLinks,
		citationClaimEvidenceLinks.id,
		bundle.citationClaimLinks,
	);
	await selectIds("findings", diagnosisFindings, diagnosisFindings.id, bundle.findings);
	await selectIds("remediations", evidenceRemediations, evidenceRemediations.id, bundle.remediations);
}

/**
 * PostgreSQL adapter for the canonical replay bundle. All records are inserted
 * in one transaction. Shared versioned definitions are content-addressed and
 * may already exist; completed run/evidence records are only ever appended.
 */
export class DrizzleImmutableEvidenceStore implements ImmutableEvidenceStore {
	async persist(bundle: ReplayAuditBundle): Promise<void> {
		await db.transaction(async (tx) => {
			await persistReplayAuditBundleInTransaction(tx, bundle);
		});
	}
}

/** In-memory append-only store used to prove deterministic persistence. */
export class InMemoryImmutableEvidenceStore implements ImmutableEvidenceStore {
	private readonly collections = {
		intentFamilies: new Map<string, ReplayAuditBundle["intentFamilies"][number]>(),
		promptVariants: new Map<string, ReplayAuditBundle["promptVariants"][number]>(),
		auditRuns: new Map<string, ReplayAuditBundle["auditRun"]>(),
		providerModelVersions: new Map<string, ReplayAuditBundle["providerModelVersions"][number]>(),
		providerRuns: new Map<string, ReplayAuditBundle["providerRuns"][number]>(),
		responsePayloads: new Map<string, ReplayAuditBundle["responsePayloads"][number]>(),
		citationEvidence: new Map<string, ReplayAuditBundle["citationEvidence"][number]>(),
		entityEvidence: new Map<string, ReplayAuditBundle["entityEvidence"][number]>(),
		citationClaimLinks: new Map<string, ReplayAuditBundle["citationClaimLinks"][number]>(),
		findings: new Map<string, ReplayAuditBundle["findings"][number]>(),
		remediations: new Map<string, ReplayAuditBundle["remediations"][number]>(),
	};

	async persist(bundle: ReplayAuditBundle): Promise<void> {
		const incoming = {
			intentFamilies: bundle.intentFamilies,
			promptVariants: bundle.promptVariants,
			auditRuns: [bundle.auditRun],
			providerModelVersions: bundle.providerModelVersions,
			providerRuns: bundle.providerRuns,
			responsePayloads: bundle.responsePayloads,
			citationEvidence: bundle.citationEvidence,
			entityEvidence: bundle.entityEvidence,
			citationClaimLinks: bundle.citationClaimLinks,
			findings: bundle.findings,
			remediations: bundle.remediations,
		};

		for (const [collectionName, records] of Object.entries(incoming)) {
			const collection = this.collections[collectionName as keyof typeof this.collections] as Map<
				string,
				EvidenceRecord
			>;
			for (const record of records as EvidenceRecord[]) {
				const existing = collection.get(record.id);
				if (existing && canonicalJson(existing) !== canonicalJson(record)) {
					throw new Error(`Immutable evidence conflict for ${collectionName}:${record.id}`);
				}
			}
		}

		for (const [collectionName, records] of Object.entries(incoming)) {
			const collection = this.collections[collectionName as keyof typeof this.collections] as Map<
				string,
				EvidenceRecord
			>;
			for (const record of records as EvidenceRecord[]) collection.set(record.id, structuredClone(record));
		}
	}

	snapshot(): ReplayAuditBundle & { auditRuns: ReplayAuditBundle["auditRun"][] } {
		const values = <T extends EvidenceRecord>(map: Map<string, T>): T[] =>
			[...map.values()].sort((left, right) => left.id.localeCompare(right.id));
		const auditRunRecords = values(this.collections.auditRuns);
		if (!auditRunRecords[0]) throw new Error("No audit run has been persisted");
		return {
			intentFamilies: values(this.collections.intentFamilies),
			promptVariants: values(this.collections.promptVariants),
			auditRun: auditRunRecords[0],
			auditRuns: auditRunRecords,
			providerModelVersions: values(this.collections.providerModelVersions),
			providerRuns: values(this.collections.providerRuns),
			responsePayloads: values(this.collections.responsePayloads),
			citationEvidence: values(this.collections.citationEvidence),
			entityEvidence: values(this.collections.entityEvidence),
			citationClaimLinks: values(this.collections.citationClaimLinks),
			findings: values(this.collections.findings),
			remediations: values(this.collections.remediations),
		};
	}
}

export async function persistReplayAuditBundle(
	bundle: ReplayAuditBundle,
	store: ImmutableEvidenceStore = new DrizzleImmutableEvidenceStore(),
): Promise<void> {
	await store.persist(bundle);
}

/** Loads one complete immutable audit bundle and validates its tenant boundaries. */
export async function loadPersistedReplayAuditBundle(
	auditRunId: string,
	expectedBrandId?: string,
): Promise<ReplayAuditBundle | null> {
	const auditRun = await db.query.auditRuns.findFirst({ where: eq(auditRuns.id, auditRunId) });
	if (!auditRun) return null;
	if (expectedBrandId && auditRun.brandId !== expectedBrandId)
		throw new Error("Audit does not belong to the requested brand");
	const runRows = await db.select().from(providerRuns).where(eq(providerRuns.auditRunId, auditRunId));
	const runIds = runRows.map((run) => run.id);
	if (runIds.length === 0) throw new Error("Persisted audit contains no provider runs");
	const promptIds = uniqueStrings(runRows.map((run) => run.promptVariantId));
	const providerIds = uniqueStrings(runRows.map((run) => run.providerModelVersionId));
	const [promptRows, providerRows, responseRows, entityRows, citationRows, findingRows, remediationRows] =
		await Promise.all([
			db.select().from(frozenPromptVariants).where(inArray(frozenPromptVariants.id, promptIds)),
			db.select().from(providerModelVersions).where(inArray(providerModelVersions.id, providerIds)),
			db.select().from(providerResponsePayloads).where(inArray(providerResponsePayloads.providerRunId, runIds)),
			db
				.select()
				.from(entityIdentityEvidenceRecords)
				.where(inArray(entityIdentityEvidenceRecords.providerRunId, runIds)),
			db.select().from(citationEvidenceRecords).where(inArray(citationEvidenceRecords.providerRunId, runIds)),
			db.select().from(diagnosisFindings).where(eq(diagnosisFindings.auditRunId, auditRunId)),
			db.select().from(evidenceRemediations).where(eq(evidenceRemediations.auditRunId, auditRunId)),
		]);
	const intentIds = uniqueStrings(promptRows.map((prompt) => prompt.intentFamilyId));
	const intentRows = await db.select().from(intentFamilies).where(inArray(intentFamilies.id, intentIds));
	if (intentRows.some((intent) => intent.brandId !== auditRun.brandId)) {
		throw new Error("Cross-tenant intent evidence detected in persisted audit");
	}
	const entityIds = entityRows.map((entity) => entity.id);
	const claimLinkRows = entityIds.length
		? await db
				.select()
				.from(citationClaimEvidenceLinks)
				.where(inArray(citationClaimEvidenceLinks.entityEvidenceId, entityIds))
		: [];

	return {
		intentFamilies: intentRows,
		promptVariants: promptRows,
		auditRun,
		providerModelVersions: providerRows,
		providerRuns: runRows,
		responsePayloads: responseRows,
		citationEvidence: citationRows,
		entityEvidence: entityRows,
		citationClaimLinks: claimLinkRows,
		findings: findingRows,
		remediations: remediationRows,
	} as ReplayAuditBundle;
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}
