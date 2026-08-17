import { describe, expect, it } from "vitest";
import { InMemoryImmutableEvidenceStore } from "./db/evidence-store";
import {
	canonicalJson,
	classifyCitationType,
	createReplayAuditBundle,
	createReplayFixtures,
	sha256,
	summarizeReplayAudit,
	type EntityIdentityEvidenceRecord,
	type ReplayAuditInput,
} from "./replay-audit";

const input: ReplayAuditInput = {
	brand: {
		id: "brand-zentaviq",
		name: "Zentaviq",
		website: "https://zentaviq.example",
		aliases: ["Zentaviq AI Visibility"],
		additionalDomains: ["docs.zentaviq.example"],
	},
	competitors: [
		{
			id: "00000000-0000-4000-8000-000000000001",
			name: "Ledger Labs",
			domains: ["ledgerlabs.example"],
			aliases: ["Ledger"],
		},
	],
	correlationId: "test-replay-baseline-001",
	replayedAt: new Date("2026-08-18T00:00:00.000Z"),
};

function entityForFixture(
	bundle: ReturnType<typeof createReplayAuditBundle>,
	fixtureId: string,
	entityId: string,
): EntityIdentityEvidenceRecord {
	const payload = bundle.responsePayloads.find((candidate) => candidate.fixtureId === fixtureId);
	if (!payload) throw new Error(`Missing payload for ${fixtureId}`);
	const evidence = bundle.entityEvidence.find(
		(candidate) => candidate.responsePayloadId === payload.id && candidate.entityId === entityId,
	);
	if (!evidence) throw new Error(`Missing entity evidence for ${fixtureId}:${entityId}`);
	return evidence;
}

describe("fixture replay audit", () => {
	it("covers the four deterministic v0.1 evidence scenarios", () => {
		const bundle = createReplayAuditBundle(input);

		expect(bundle.intentFamilies).toHaveLength(4);
		expect(bundle.promptVariants).toHaveLength(4);
		expect(bundle.providerRuns).toHaveLength(4);
		expect(bundle.responsePayloads).toHaveLength(4);
		expect(bundle.entityEvidence).toHaveLength(8);
		expect(bundle.citationEvidence).toHaveLength(3);

		const strongBrand = entityForFixture(bundle, "strong-business-first-party-v1", "brand:brand-zentaviq");
		expect(strongBrand).toMatchObject({
			retrieved: true,
			mentioned: true,
			recommended: true,
			cited: true,
		});
		expect(strongBrand.matchEvidence.acceptedMatches.length).toBeGreaterThan(0);
		expect(strongBrand.recommendationEvidence).toMatchObject({
			status: "accepted",
			rule: "same_sentence_positive_recommendation_cue",
			cue: "recommend",
		});

		const competitor = entityForFixture(
			bundle,
			"competitor-recommendation-citation-v1",
			"competitor:00000000-0000-4000-8000-000000000001",
		);
		expect(competitor).toMatchObject({
			retrieved: true,
			mentioned: true,
			recommended: true,
			cited: true,
		});

		for (const evidence of bundle.entityEvidence.filter((candidate) => {
			const payload = bundle.responsePayloads.find((response) => response.id === candidate.responsePayloadId);
			return payload?.fixtureId === "broad-category-ambiguity-v1";
		})) {
			expect(evidence).toMatchObject({
				retrieved: true,
				mentioned: false,
				recommended: false,
				cited: false,
			});
		}

		for (const evidence of bundle.entityEvidence.filter((candidate) => {
			const payload = bundle.responsePayloads.find((response) => response.id === candidate.responsePayloadId);
			return payload?.fixtureId === "no-retrieval-no-mention-v1";
		})) {
			expect(evidence).toMatchObject({
				retrieved: false,
				mentioned: false,
				recommended: false,
				cited: false,
			});
		}
	});

	it("classifies first-party, competitor, and independent citations without fetching them", () => {
		const bundle = createReplayAuditBundle(input);
		expect(bundle.citationEvidence.map((citation) => citation.citationType)).toEqual([
			"first_party",
			"competitor",
			"independent",
		]);
		expect(
			bundle.citationEvidence.every(
				(citation) =>
					citation.evidence.verification.status === "not_attempted" &&
					citation.evidence.support.status === "not_assessed",
			),
		).toBe(true);
		expect(
			classifyCitationType("https://docs.zentaviq.example/report", ["zentaviq.example"], ["ledgerlabs.example"]),
		).toBe("first_party");
		expect(classifyCitationType("not-a-url", ["zentaviq.example"], [])).toBe("unknown");
	});

	it("preserves raw fixture provenance, checksums, timestamps, extractor versions, and correlations", () => {
		const fixtures = createReplayFixtures(input);
		const bundle = createReplayAuditBundle(input);
		for (const payload of bundle.responsePayloads) {
			const fixture = fixtures.find((candidate) => candidate.fixtureId === payload.fixtureId);
			expect(fixture).toBeDefined();
			expect(payload.fixtureChecksum).toBe(sha256(fixture));
			expect(payload.payloadChecksum).toBe(sha256(payload.rawPayload));
			expect(payload.fixtureCapturedAt.toISOString()).toBe(fixture?.capturedAt);
			expect(payload.replayedAt).toEqual(input.replayedAt);
		}
		expect(bundle.providerRuns.every((run) => run.correlationId.startsWith(input.correlationId))).toBe(true);
		expect(bundle.providerRuns.every((run) => run.extractorVersion === "1.0.0")).toBe(true);
		expect(bundle.entityEvidence.every((record) => record.schemaVersion === 1)).toBe(true);
		expect(bundle.citationEvidence.every((record) => record.schemaVersion === 1)).toBe(true);
	});

	it("is byte-for-byte deterministic for the same replay input", () => {
		const first = createReplayAuditBundle(input);
		const second = createReplayAuditBundle({
			...input,
			brand: structuredClone(input.brand),
			competitors: structuredClone(input.competitors),
			replayedAt: new Date(input.replayedAt),
		});
		expect(canonicalJson(second)).toBe(canonicalJson(first));
		expect(summarizeReplayAudit(second)).toEqual(summarizeReplayAudit(first));
	});

	it("keeps frozen intent, prompt, and provider identities stable across separate runs", () => {
		const first = createReplayAuditBundle(input);
		const second = createReplayAuditBundle({
			...input,
			correlationId: "test-replay-baseline-002",
			replayedAt: new Date("2026-08-18T01:00:00.000Z"),
		});
		expect(second.auditRun.id).not.toBe(first.auditRun.id);
		expect(second.intentFamilies).toEqual(first.intentFamilies);
		expect(second.promptVariants).toEqual(first.promptVariants);
		expect(second.providerModelVersions).toEqual(first.providerModelVersions);
		expect(second.providerRuns.map((run) => run.id)).not.toEqual(first.providerRuns.map((run) => run.id));
	});

	it("persists idempotently and rejects conflicting mutations to an immutable ID", async () => {
		const bundle = createReplayAuditBundle(input);
		const store = new InMemoryImmutableEvidenceStore();
		await store.persist(bundle);
		await store.persist(createReplayAuditBundle(input));

		const snapshot = store.snapshot();
		expect(snapshot.auditRuns).toHaveLength(1);
		expect(snapshot.providerRuns).toHaveLength(4);
		expect(snapshot.responsePayloads).toHaveLength(4);
		expect(snapshot.entityEvidence).toHaveLength(8);
		expect(snapshot.citationEvidence).toHaveLength(3);

		const conflicting = structuredClone(bundle);
		conflicting.responsePayloads[0].rawPayload.responseText = "Mutated after persistence";
		await expect(store.persist(conflicting)).rejects.toThrow("Immutable evidence conflict");
		expect(store.snapshot().responsePayloads[0].rawPayload.responseText).not.toBe("Mutated after persistence");
	});
});
