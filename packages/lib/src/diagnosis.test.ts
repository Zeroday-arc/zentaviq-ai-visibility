import { describe, expect, it } from "vitest";
import { MINIMUM_REPEATED_EVIDENCE_RUNS, REMEDIATION_POLICY_VERSION } from "./diagnosis";
import { canonicalJson, createReplayAuditBundle, type ReplayAuditInput } from "./replay-audit";

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
	correlationId: "test-diagnosis-baseline-001",
	replayedAt: new Date("2026-08-18T00:00:00.000Z"),
};

function outcomeByIntent(bundle: ReturnType<typeof createReplayAuditBundle>) {
	const intents = new Map(bundle.intentFamilies.map((intent) => [intent.id, intent]));
	return Object.fromEntries(
		bundle.findings.map((finding) => [
			intents.get(finding.intentFamilyId)?.key,
			{
				stage: finding.likelyFailureStage,
				action: bundle.remediations.find((remediation) => remediation.primaryFindingId === finding.id)?.actionCategory ?? null,
			},
		]),
	);
}

describe("deterministic failure diagnosis and remediation", () => {
	it("applies one explicit primary stage per intent family in precedence order", () => {
		const outcomes = outcomeByIntent(createReplayAuditBundle(input));
		expect(outcomes).toEqual({
			"alias-name-collision": { stage: "entity_resolution_ambiguity", action: "entity_disambiguation" },
			"ambiguous-category-human-review": {
				stage: "human_review_required",
				action: "human_review_gather_more_evidence",
			},
			"broad-category-discovery": { stage: "category_fit_ambiguity", action: "category_clarification" },
			"competitor-comparison": {
				stage: "competitor_displacement",
				action: "prominence_recommendation_improvement",
			},
			"competitor-ranked-above-target": {
				stage: "competitor_displacement",
				action: "prominence_recommendation_improvement",
			},
			"mention-without-recommendation": {
				stage: "recommendation_gap",
				action: "comparison_customer_evidence",
			},
			"no-target-retrieval": { stage: "mention_gap", action: "targeted_problem_intent_content" },
			"recommendation-low-prominence": {
				stage: "prominence_ranking_gap",
				action: "prominence_recommendation_improvement",
			},
			"repeated-competitor-independent-support": {
				stage: "competitor_displacement",
				action: "independent_authority_citation_acquisition",
			},
			"repeated-retrieval-failure": {
				stage: "retrieval_failure",
				action: "technical_retrieval_access_remediation",
			},
			"strong-business-match": { stage: "maintain", action: "maintain" },
			"substantial-first-party-independent-gap": {
				stage: "independent_authority_gap",
				action: "independent_authority_citation_acquisition",
			},
			"target-domain-citation-without-recommendation": {
				stage: "mention_gap",
				action: "targeted_problem_intent_content",
			},
			"target-recommended-without-citation": {
				stage: "citation_support_gap",
				action: "independent_authority_citation_acquisition",
			},
			"unanswered-query": { stage: "insufficient_evidence", action: null },
			"unrelated-citation-near-target-mention": {
				stage: "recommendation_gap",
				action: "comparison_customer_evidence",
			},
		});
	});

	it("persists traceable evidence IDs, frozen prompt versions and policy metadata", () => {
		const bundle = createReplayAuditBundle(input);
		const knownEvidenceIds = new Set([
			...bundle.providerRuns.map((record) => record.id),
			...bundle.entityEvidence.map((record) => record.id),
			...bundle.citationEvidence.map((record) => record.id),
			...bundle.citationClaimLinks.map((record) => record.id),
			...bundle.entityEvidence.flatMap((record) => record.classificationEvidence.sources.map((source) => source.id)),
		]);
		const prompts = new Map(bundle.promptVariants.map((prompt) => [prompt.id, prompt]));
		const runIds = new Set(bundle.providerRuns.map((run) => run.id));

		for (const finding of bundle.findings) {
			expect(finding.policyVersion).toBe(REMEDIATION_POLICY_VERSION);
			expect(finding.frozenPromptVersion).toBe(prompts.get(finding.promptVariantId)?.version);
			expect(finding.supportingEvidenceIds.length).toBeGreaterThan(0);
			expect(finding.supportingEvidenceIds.every((id) => knownEvidenceIds.has(id))).toBe(true);
			expect(finding.contradictingEvidenceIds.every((id) => knownEvidenceIds.has(id))).toBe(true);
			expect(finding.affectedProviderRunIds.every((id) => runIds.has(id))).toBe(true);
			expect(finding.confidence).toBeGreaterThan(0);
			expect(finding.confidence).toBeLessThanOrEqual(1);
		}
	});

	it("constructs remediation only after a finding and with bounded retest criteria", () => {
		const bundle = createReplayAuditBundle(input);
		const findingIds = new Set(bundle.findings.map((finding) => finding.id));
		for (const remediation of bundle.remediations) {
			expect(findingIds.has(remediation.primaryFindingId)).toBe(true);
			expect(remediation.linkedFindingIds.every((id) => findingIds.has(id))).toBe(true);
			expect(remediation.rationale.length).toBeGreaterThan(20);
			expect(remediation.acceptanceCriteria.length).toBeGreaterThan(0);
			expect(remediation.expectedEvidenceChange.length).toBeGreaterThan(0);
			expect(remediation.policyVersion).toBe(REMEDIATION_POLICY_VERSION);
		}
		const insufficient = bundle.findings.find((finding) => finding.likelyFailureStage === "insufficient_evidence");
		expect(insufficient).toBeDefined();
		expect(bundle.remediations.some((remediation) => remediation.primaryFindingId === insufficient?.id)).toBe(false);
		expect(insufficient?.reasonCodes).toContain("no_remediation_generated");
	});

	it("requires repeated accepted independent support before suggesting an authority action for competitor displacement", () => {
		const bundle = createReplayAuditBundle(input);
		const intents = new Map(bundle.intentFamilies.map((intent) => [intent.id, intent]));
		const repeated = bundle.findings.find(
			(finding) => intents.get(finding.intentFamilyId)?.key === "repeated-competitor-independent-support",
		);
		expect(repeated?.diagnosisEvidence.competitorCitationGap).toMatchObject({
			minimumSupportingRuns: MINIMUM_REPEATED_EVIDENCE_RUNS,
			repeatedSupportingEvidence: true,
		});
		expect(repeated?.diagnosisEvidence.competitorCitationGap.winners).toEqual([
			expect.objectContaining({
				entityName: "Ledger Labs",
				independentSourceDomains: ["research-one.example", "research-two.example"],
				citationTypeCounts: { first_party: 0, independent: 2, competitor: 0, unknown: 0 },
			}),
		]);
		const remediation = bundle.remediations.find((candidate) => candidate.primaryFindingId === repeated?.id);
		expect(remediation?.actionCategory).toBe("independent_authority_citation_acquisition");
		expect(remediation?.rationale).not.toMatch(/https?:\/\//);
		expect(remediation?.rationale).toContain("no specific observed URL is prescribed");

		const single = bundle.findings.find(
			(finding) => intents.get(finding.intentFamilyId)?.key === "competitor-comparison",
		);
		expect(single?.diagnosisEvidence.competitorCitationGap.repeatedSupportingEvidence).toBe(false);
		expect(bundle.remediations.find((candidate) => candidate.primaryFindingId === single?.id)?.actionCategory).toBe(
			"prominence_recommendation_improvement",
		);
	});

	it("does not infer a need for generic content when substantial first-party evidence exists", () => {
		const bundle = createReplayAuditBundle(input);
		const intents = new Map(bundle.intentFamilies.map((intent) => [intent.id, intent]));
		const finding = bundle.findings.find(
			(candidate) => intents.get(candidate.intentFamilyId)?.key === "substantial-first-party-independent-gap",
		);
		expect(finding).toMatchObject({
			likelyFailureStage: "independent_authority_gap",
			reasonCodes: ["independent_support_requested", "target_support_first_party_only", "generic_content_not_inferred"],
		});
		const remediation = bundle.remediations.find((candidate) => candidate.primaryFindingId === finding?.id);
		expect(remediation?.rationale).toContain("do not create more generic first-party content");
	});

	it("holds ambiguous evidence for review instead of forcing a remediation conclusion", () => {
		const bundle = createReplayAuditBundle(input);
		const reviewFindings = bundle.findings.filter((finding) => finding.reviewState === "pending");
		expect(reviewFindings.map((finding) => finding.likelyFailureStage).sort()).toEqual([
			"entity_resolution_ambiguity",
			"human_review_required",
		]);
		expect(
			reviewFindings.every(
				(finding) =>
					bundle.remediations.find((remediation) => remediation.primaryFindingId === finding.id)?.approvalState ===
					"pending_human_review",
			),
		).toBe(true);
	});

	it("is byte-for-byte deterministic for the same immutable evidence input", () => {
		const first = createReplayAuditBundle(input);
		const second = createReplayAuditBundle({
			...input,
			brand: structuredClone(input.brand),
			competitors: structuredClone(input.competitors),
			replayedAt: new Date(input.replayedAt),
		});
		expect(canonicalJson(second.findings)).toBe(canonicalJson(first.findings));
		expect(canonicalJson(second.remediations)).toBe(canonicalJson(first.remediations));
	});
});
