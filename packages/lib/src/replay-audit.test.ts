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

function entitiesForFixture(
	bundle: ReturnType<typeof createReplayAuditBundle>,
	fixtureId: string,
): EntityIdentityEvidenceRecord[] {
	const payload = bundle.responsePayloads.find((candidate) => candidate.fixtureId === fixtureId);
	if (!payload) throw new Error(`Missing payload for ${fixtureId}`);
	return bundle.entityEvidence.filter((candidate) => candidate.responsePayloadId === payload.id);
}

describe("fixture replay audit", () => {
	it("retains the original foundation scenarios in the expanded fixture set", () => {
		const bundle = createReplayAuditBundle(input);

		expect(bundle.intentFamilies).toHaveLength(12);
		expect(bundle.promptVariants).toHaveLength(12);
		expect(bundle.providerRuns).toHaveLength(12);
		expect(bundle.responsePayloads).toHaveLength(12);
		expect(bundle.entityEvidence).toHaveLength(26);
		expect(bundle.citationEvidence).toHaveLength(5);
		expect(bundle.citationClaimLinks).toHaveLength(6);

		const strongBrand = entityForFixture(bundle, "strong-business-first-party-v2", "brand:brand-zentaviq");
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
			"competitor-recommendation-citation-v2",
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
			return payload?.fixtureId === "broad-category-ambiguity-v2" && candidate.entityRole !== "unknown";
		})) {
			expect(evidence).toMatchObject({
				retrieved: false,
				mentioned: false,
				recommended: false,
				cited: false,
			});
		}

		for (const evidence of bundle.entityEvidence.filter((candidate) => {
			const payload = bundle.responsePayloads.find((response) => response.id === candidate.responsePayloadId);
			return payload?.fixtureId === "no-retrieval-no-mention-v2";
		})) {
			expect(evidence).toMatchObject({
				retrieved: false,
				mentioned: false,
				recommended: false,
				cited: false,
			});
		}
	});

	it("classifies the eight milestone scenarios with explicit review states", () => {
		const bundle = createReplayAuditBundle(input);
		const targetId = "brand:brand-zentaviq";
		const competitorId = "competitor:00000000-0000-4000-8000-000000000001";

		const mentionOnly = entityForFixture(bundle, "mention-without-recommendation-v2", targetId);
		expect(mentionOnly).toMatchObject({ retrieved: true, mentioned: true, recommended: false, cited: false });
		expect(mentionOnly.classificationEvidence.decisions.recommended.status).toBe("not_detected");

		const lowProminence = entityForFixture(bundle, "recommendation-low-prominence-v2", targetId);
		expect(lowProminence).toMatchObject({ retrieved: true, mentioned: true, recommended: true, prominenceRank: 3 });
		expect(lowProminence.classificationEvidence.decisions.prominence).toMatchObject({
			status: "accepted",
			value: 3,
		});

		const rankedTarget = entityForFixture(bundle, "competitor-ranked-above-target-v2", targetId);
		const rankedCompetitor = entityForFixture(bundle, "competitor-ranked-above-target-v2", competitorId);
		expect(rankedCompetitor).toMatchObject({ prominenceRank: 1, recommended: true });
		expect(rankedTarget).toMatchObject({ prominenceRank: 2, recommended: false });

		for (const collision of entitiesForFixture(bundle, "alias-name-collision-v2")) {
			expect(collision).toMatchObject({
				retrieved: false,
				mentioned: false,
				recommended: false,
				reviewState: "pending",
			});
			expect(collision.classificationEvidence.decisions.mentioned.status).toBe("ambiguous");
			expect(collision.classificationEvidence.decisions.recommended.status).toBe("ambiguous");
			expect(collision.classificationEvidence.sources).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						disposition: "ambiguous",
						matchedAlias: "Visibility Core",
						reasonCodes: ["identity_collision"],
					}),
				]),
			);
		}

		const domainCitation = entityForFixture(bundle, "target-domain-citation-without-recommendation-v2", targetId);
		expect(domainCitation).toMatchObject({ retrieved: true, mentioned: false, recommended: false, cited: true });

		const unrelatedEntities = entitiesForFixture(bundle, "unrelated-citation-near-target-mention-v2");
		const unrelatedTarget = unrelatedEntities.find((entity) => entity.entityId === targetId);
		const unknown = unrelatedEntities.find((entity) => entity.entityRole === "unknown");
		expect(unrelatedTarget).toMatchObject({ mentioned: true, cited: false });
		expect(unrelatedTarget?.classificationEvidence.decisions.cited.status).toBe("rejected");
		expect(unknown).toMatchObject({ entityRole: "unknown", retrieved: true, cited: true });
		expect(unknown?.classificationEvidence.entityType).toBe("unrelated_unknown");

		const ambiguous = entityForFixture(bundle, "ambiguous-category-human-review-v2", targetId);
		expect(ambiguous).toMatchObject({ retrieved: false, mentioned: false, reviewState: "pending" });
		expect(ambiguous.classificationEvidence.decisions.retrieved.status).toBe("ambiguous");
		expect(ambiguous.classificationEvidence.decisions.mentioned.status).toBe("ambiguous");

		const absentTarget = entityForFixture(bundle, "no-target-retrieval-v2", targetId);
		const retrievedCompetitor = entityForFixture(bundle, "no-target-retrieval-v2", competitorId);
		expect(absentTarget).toMatchObject({ retrieved: false, mentioned: false, recommended: false, cited: false });
		expect(absentTarget.classificationEvidence.decisions.retrieved.status).toBe("not_detected");
		expect(retrievedCompetitor.retrieved).toBe(true);
	});

	it("preserves exact source excerpts, offsets, rules, confidence and source IDs", () => {
		const bundle = createReplayAuditBundle(input);
		for (const entity of bundle.entityEvidence) {
			const payload = bundle.responsePayloads.find((candidate) => candidate.id === entity.responsePayloadId);
			if (!payload) throw new Error(`Missing payload for ${entity.id}`);
			expect(entity.identitySnapshot).toEqual(entity.matchEvidence.identity);
			const sourceIds = new Set(entity.classificationEvidence.sources.map((source) => source.id));
			for (const source of entity.classificationEvidence.sources) {
				expect(payload.rawPayload.responseText.slice(source.start, source.end)).toBe(source.excerpt);
				expect(source.matchRule).not.toBe("");
				expect(source.classifierVersion).not.toBe("");
				expect(source.confidence).toBeGreaterThanOrEqual(0);
				expect(source.confidence).toBeLessThanOrEqual(1);
			}
			for (const classification of Object.values(entity.classificationEvidence.decisions)) {
				for (const sourceId of classification.sourceEvidenceIds) expect(sourceIds.has(sourceId)).toBe(true);
			}
		}
	});

	it("links a citation only to the entity and claim its deterministic evidence supports", () => {
		const bundle = createReplayAuditBundle(input);
		const targetId = "brand:brand-zentaviq";
		const domainTarget = entityForFixture(bundle, "target-domain-citation-without-recommendation-v2", targetId);
		expect(bundle.citationClaimLinks.find((link) => link.entityEvidenceId === domainTarget.id)).toMatchObject({
			claim: "identity",
			status: "accepted",
		});

		const unrelatedTarget = entityForFixture(bundle, "unrelated-citation-near-target-mention-v2", targetId);
		expect(bundle.citationClaimLinks.find((link) => link.entityEvidenceId === unrelatedTarget.id)).toMatchObject({
			claim: "mention",
			status: "rejected",
			reasonCodes: ["citation_domain_not_owned_by_entity", "proximity_does_not_establish_support"],
		});
		expect(unrelatedTarget.cited).toBe(false);
	});

	it("classifies first-party, competitor, and independent citations without fetching them", () => {
		const bundle = createReplayAuditBundle(input);
		expect(bundle.citationEvidence.map((citation) => citation.citationType)).toEqual([
			"first_party",
			"competitor",
			"independent",
			"first_party",
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
		expect(bundle.providerRuns.every((run) => run.extractorVersion === "2.0.0")).toBe(true);
		expect(bundle.entityEvidence.every((record) => record.schemaVersion === 2)).toBe(true);
		expect(bundle.citationEvidence.every((record) => record.schemaVersion === 2)).toBe(true);
		expect(bundle.citationClaimLinks.every((record) => record.schemaVersion === 2)).toBe(true);
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
		expect(snapshot.providerRuns).toHaveLength(12);
		expect(snapshot.responsePayloads).toHaveLength(12);
		expect(snapshot.entityEvidence).toHaveLength(26);
		expect(snapshot.citationEvidence).toHaveLength(5);
		expect(snapshot.citationClaimLinks).toHaveLength(6);

		const conflicting = structuredClone(bundle);
		conflicting.responsePayloads[0].rawPayload.responseText = "Mutated after persistence";
		await expect(store.persist(conflicting)).rejects.toThrow("Immutable evidence conflict");
		expect(store.snapshot().responsePayloads[0].rawPayload.responseText).not.toBe("Mutated after persistence");
	});
});
