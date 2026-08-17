import {
	auditRuns,
	citationEvidenceRecords,
	entityIdentityEvidenceRecords,
	frozenPromptVariants,
	intentFamilies,
	providerModelVersions,
	providerResponsePayloads,
	providerRuns,
} from "./schema";
import { db } from "./db";
import { canonicalJson, type ReplayAuditBundle } from "../replay-audit";

export interface ImmutableEvidenceStore {
	persist(bundle: ReplayAuditBundle): Promise<void>;
}

/**
 * PostgreSQL adapter for the canonical replay bundle. All records are inserted
 * in one transaction. Shared versioned definitions are content-addressed and
 * may already exist; completed run/evidence records are only ever appended.
 */
export class DrizzleImmutableEvidenceStore implements ImmutableEvidenceStore {
	async persist(bundle: ReplayAuditBundle): Promise<void> {
		await db.transaction(async (tx) => {
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
			if (bundle.providerRuns.length > 0) {
				await tx.insert(providerRuns).values(bundle.providerRuns).onConflictDoNothing();
			}
			if (bundle.responsePayloads.length > 0) {
				await tx.insert(providerResponsePayloads).values(bundle.responsePayloads).onConflictDoNothing();
			}
			if (bundle.citationEvidence.length > 0) {
				await tx.insert(citationEvidenceRecords).values(bundle.citationEvidence).onConflictDoNothing();
			}
			if (bundle.entityEvidence.length > 0) {
				await tx.insert(entityIdentityEvidenceRecords).values(bundle.entityEvidence).onConflictDoNothing();
			}
		});
	}
}

type EvidenceRecord = { id: string };

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
		};
	}
}

export async function persistReplayAuditBundle(
	bundle: ReplayAuditBundle,
	store: ImmutableEvidenceStore = new DrizzleImmutableEvidenceStore(),
): Promise<void> {
	await store.persist(bundle);
}
