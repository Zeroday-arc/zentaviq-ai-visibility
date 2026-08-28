import { describe, expect, it } from "vitest";
import {
	AUDIT_REPORT_GENERATION_VERSION,
	compareFrozenBaselineToRetest,
	createDeterministicRetestBundle,
	createDeterministicRetestFixtures,
	createFrozenAuditReport,
	summarizeComparisonOutcomes,
	verifyAuditComparisonChecksum,
	verifyFrozenAuditReportChecksum,
} from "./audit-report";
import { assertCompleteComparisonSet } from "./db/audit-report-store";
import { canonicalJson, createReplayAuditBundle, type ReplayAuditInput, sha256 } from "./replay-audit";

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
	correlationId: "test-frozen-baseline-001",
	replayedAt: new Date("2026-08-18T00:00:00.000Z"),
};

function createFlow() {
	const baseline = createReplayAuditBundle(input);
	const frozenReport = createFrozenAuditReport({
		baseline,
		brand: input.brand,
		competitors: input.competitors,
		frozenAt: new Date("2026-08-18T01:00:00.000Z"),
	});
	const retest = createDeterministicRetestBundle({
		frozenReport,
		brand: input.brand,
		competitors: input.competitors,
		retestedAt: new Date("2026-08-18T02:00:00.000Z"),
	});
	const comparisons = compareFrozenBaselineToRetest({
		frozenReport,
		baseline,
		retest,
		createdAt: new Date("2026-08-18T02:00:00.000Z"),
	});
	return { baseline, frozenReport, retest, comparisons };
}

function outcomesByIntent(flow: ReturnType<typeof createFlow>) {
	const intents = new Map(flow.baseline.intentFamilies.map((intent) => [intent.id, intent.key]));
	return Object.fromEntries(
		flow.comparisons.map((comparison) => [intents.get(comparison.intentFamilyId), comparison.outcome]),
	);
}

describe("frozen audit report and deterministic retest", () => {
	it("freezes every canonical evidence and policy input behind a deterministic checksum", () => {
		const { baseline, frozenReport } = createFlow();
		expect(frozenReport).toMatchObject({
			brandId: input.brand.id,
			baselineAuditRunId: baseline.auditRun.id,
			reportGenerationVersion: AUDIT_REPORT_GENERATION_VERSION,
			benchmarkVersion: "zentaviq-fixture-benchmark-v1",
		});
		expect(frozenReport.intentVersionSnapshot).toHaveLength(16);
		expect(frozenReport.promptVersionSnapshot).toHaveLength(18);
		expect(frozenReport.fixtureManifest).toHaveLength(18);
		expect(frozenReport.findingIds).toHaveLength(16);
		expect(frozenReport.remediationIds).toHaveLength(15);
		expect(frozenReport.decisionSnapshot).toHaveLength(16);
		expect(frozenReport.snapshotChecksum).toHaveLength(64);
		expect(verifyFrozenAuditReportChecksum(frozenReport)).toBe(true);
	});

	it("preserves exact intent and prompt versions while persisting retest as a separate audit", () => {
		const { baseline, retest } = createFlow();
		expect(retest.auditRun).toMatchObject({ runKind: "retest", executionMode: "fixture_replay" });
		expect(retest.auditRun.id).not.toBe(baseline.auditRun.id);
		expect([...retest.intentFamilies].sort((left, right) => left.id.localeCompare(right.id))).toEqual(
			[...baseline.intentFamilies].sort((left, right) => left.id.localeCompare(right.id)),
		);
		expect([...retest.promptVariants].sort((left, right) => left.id.localeCompare(right.id))).toEqual(
			[...baseline.promptVariants].sort((left, right) => left.id.localeCompare(right.id)),
		);
		expect(retest.providerRuns.map((run) => run.id)).not.toEqual(baseline.providerRuns.map((run) => run.id));
	});

	it("classifies all required fixture families with explicit precedence", () => {
		const flow = createFlow();
		expect(outcomesByIntent(flow)).toEqual({
			"alias-name-collision": "pending_human_review",
			"ambiguous-category-human-review": "pending_human_review",
			"broad-category-discovery": "pending_human_review",
			"competitor-comparison": "unchanged",
			"competitor-ranked-above-target": "improved",
			"mention-without-recommendation": "improved",
			"no-target-retrieval": "improved",
			"recommendation-low-prominence": "regressed",
			"repeated-competitor-independent-support": "unchanged",
			"repeated-retrieval-failure": "improved",
			"strong-business-match": "unchanged",
			"substantial-first-party-independent-gap": "insufficient_evidence",
			"target-domain-citation-without-recommendation": "unchanged",
			"target-recommended-without-citation": "improved",
			"unanswered-query": "insufficient_evidence",
			"unrelated-citation-near-target-mention": "unchanged",
		});
		expect(summarizeComparisonOutcomes(flow.comparisons)).toEqual({
			improved: 5,
			unchanged: 5,
			regressed: 1,
			insufficient_evidence: 2,
			pending_human_review: 3,
		});
	});

	it("does not treat extra mentions or unrelated citations as target improvement", () => {
		const flow = createFlow();
		const intents = new Map(flow.baseline.intentFamilies.map((intent) => [intent.key, intent.id]));
		const mentionOnly = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("unrelated-citation-near-target-mention"),
		);
		expect(mentionOnly).toMatchObject({ outcome: "unchanged" });
		expect(mentionOnly?.reasonCodes).toContain("higher_mention_count_alone_not_improvement");
		const unrelatedCitation = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("target-domain-citation-without-recommendation"),
		);
		expect(unrelatedCitation).toMatchObject({ outcome: "unchanged" });
		expect(unrelatedCitation?.retestMetrics.targetRecommendationCitationLinks).toBe(0);
	});

	it("requires accepted target-linked independent citation support", () => {
		const flow = createFlow();
		const intent = flow.baseline.intentFamilies.find(
			(candidate) => candidate.key === "target-recommended-without-citation",
		);
		const comparison = flow.comparisons.find((candidate) => candidate.intentFamilyId === intent?.id);
		expect(comparison).toMatchObject({ outcome: "improved" });
		expect(comparison?.retestMetrics.targetIndependentRecommendationCitationLinks).toBe(2);
		expect(comparison?.reasonCodes).toContain("linked_independent_target_recommendation_support_observed");
	});

	it("keeps competitor displacement unchanged until the target ranks above the competitor", () => {
		const flow = createFlow();
		const intents = new Map(flow.baseline.intentFamilies.map((intent) => [intent.key, intent.id]));
		const stillBelow = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("repeated-competitor-independent-support"),
		);
		expect(stillBelow).toMatchObject({ outcome: "unchanged" });
		expect(stillBelow?.reasonCodes).toContain("competitor_remains_ranked_above_target");
		const nowAbove = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("competitor-ranked-above-target"),
		);
		expect(nowAbove).toMatchObject({ outcome: "improved" });
		expect(nowAbove?.retestMetrics.competitorAboveTarget).toBe(false);
	});

	it("returns human review or insufficient evidence before directional outcomes", () => {
		const flow = createFlow();
		const intents = new Map(flow.baseline.intentFamilies.map((intent) => [intent.key, intent.id]));
		const collision = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("alias-name-collision"),
		);
		expect(collision).toMatchObject({ outcome: "pending_human_review", confidence: 0.5 });
		const incompatible = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("substantial-first-party-independent-gap"),
		);
		expect(incompatible).toMatchObject({ outcome: "insufficient_evidence" });
		expect(incompatible?.reasonCodes).toContain("provider_model_or_benchmark_mismatch");
		expect(incompatible?.providerConfigurationSnapshot.comparable).toBe(false);
		const tooSmall = flow.comparisons.find(
			(comparison) => comparison.intentFamilyId === intents.get("unanswered-query"),
		);
		expect(tooSmall).toMatchObject({ outcome: "insufficient_evidence" });
	});

	it("preserves raw retest excerpts, offsets, fixture checksums, and evidence IDs", () => {
		const fixtures = createDeterministicRetestFixtures(input);
		const { retest } = createFlow();
		for (const payload of retest.responsePayloads) {
			const fixture = fixtures.find((candidate) => candidate.fixtureId === payload.fixtureId);
			expect(fixture).toBeDefined();
			expect(payload.fixtureChecksum).toBe(sha256(fixture));
			expect(payload.payloadChecksum).toBe(sha256(payload.rawPayload));
		}
		for (const entity of retest.entityEvidence) {
			const payload = retest.responsePayloads.find((candidate) => candidate.id === entity.responsePayloadId);
			expect(payload).toBeDefined();
			for (const source of entity.classificationEvidence.sources) {
				expect(payload?.rawPayload.responseText.slice(source.start, source.end)).toBe(source.excerpt);
				expect(source.sourceEvidenceIds).toEqual(expect.any(Array));
			}
		}
	});

	it("is byte-for-byte deterministic and checksum-verifiable", () => {
		const first = createFlow();
		const second = createFlow();
		expect(canonicalJson(second.frozenReport)).toBe(canonicalJson(first.frozenReport));
		expect(canonicalJson(second.retest)).toBe(canonicalJson(first.retest));
		expect(canonicalJson(second.comparisons)).toBe(canonicalJson(first.comparisons));
		expect(first.comparisons.every(verifyAuditComparisonChecksum)).toBe(true);
		expect(first.comparisons.every((comparison) => comparison.reasonCodes.includes("caused_by_remediation"))).toBe(
			false,
		);
	});

	it("rejects partial or duplicate comparison sets as incomplete", () => {
		const { frozenReport, comparisons } = createFlow();
		const expected = frozenReport.decisionSnapshot.map((decision) => decision.intentFamilyId);
		expect(() => assertCompleteComparisonSet(comparisons, expected)).not.toThrow();
		expect(() => assertCompleteComparisonSet(comparisons.slice(1), expected)).toThrow("incomplete");
		expect(() => assertCompleteComparisonSet([...comparisons, comparisons[0]], expected)).toThrow("duplicate");
	});

	it("rejects cross-tenant report and comparison linkage", () => {
		const baseline = createReplayAuditBundle(input);
		expect(() =>
			createFrozenAuditReport({
				baseline,
				brand: { ...input.brand, id: "other-brand" },
				competitors: input.competitors,
				frozenAt: new Date("2026-08-18T01:00:00.000Z"),
			}),
		).toThrow("Baseline brand does not match");
		expect(() =>
			createFrozenAuditReport({
				baseline,
				brand: { ...input.brand, name: "Wrong identity version" },
				competitors: input.competitors,
				frozenAt: new Date("2026-08-18T01:00:00.000Z"),
			}),
		).toThrow("Baseline evidence identity does not match");
	});

	it("rejects retests against a changed frozen business identity", () => {
		const { frozenReport } = createFlow();
		expect(() =>
			createDeterministicRetestBundle({
				frozenReport,
				brand: { ...input.brand, name: "A different brand version" },
				competitors: input.competitors,
				retestedAt: new Date("2026-08-18T02:00:00.000Z"),
			}),
		).toThrow("business identity does not match");
		expect(() =>
			createDeterministicRetestBundle({
				frozenReport,
				brand: input.brand,
				competitors: [{ ...input.competitors[0], domains: ["wrong-business.example"] }],
				retestedAt: new Date("2026-08-18T02:00:00.000Z"),
			}),
		).toThrow("business identity does not match");
	});
});
