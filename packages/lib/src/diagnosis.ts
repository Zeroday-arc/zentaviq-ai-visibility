import { createHash } from "node:crypto";

export const DIAGNOSIS_RECORD_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_CLASSIFIER_ID = "zentaviq-deterministic-failure-diagnoser";
export const DIAGNOSIS_CLASSIFIER_VERSION = "1.0.0";
export const REMEDIATION_POLICY_VERSION = "1.0.0";
export const MINIMUM_REPEATED_EVIDENCE_RUNS = 2;

export type LikelyFailureStage =
	| "retrieval_failure"
	| "category_fit_ambiguity"
	| "entity_resolution_ambiguity"
	| "mention_gap"
	| "recommendation_gap"
	| "prominence_ranking_gap"
	| "citation_support_gap"
	| "independent_authority_gap"
	| "competitor_displacement"
	| "human_review_required"
	| "insufficient_evidence"
	| "maintain";

export type RemediationActionCategory =
	| "category_clarification"
	| "targeted_problem_intent_content"
	| "comparison_customer_evidence"
	| "independent_authority_citation_acquisition"
	| "technical_retrieval_access_remediation"
	| "entity_disambiguation"
	| "prominence_recommendation_improvement"
	| "maintain"
	| "human_review_gather_more_evidence";

export type DiagnosisReviewState = "not_required" | "pending" | "accepted" | "rejected";
export type RemediationPriority = "low" | "medium" | "high";
export type RemediationApprovalState =
	| "not_required"
	| "proposed"
	| "pending_human_review"
	| "approved"
	| "rejected";

interface DecisionLike {
	status: "accepted" | "rejected" | "ambiguous" | "not_detected";
	value: boolean | number | string | null;
	reasonCodes: string[];
	sourceEvidenceIds: string[];
}

interface EntityEvidenceLike {
	id: string;
	providerRunId: string;
	entityId: string;
	entityRole: "brand" | "competitor" | "unknown";
	retrieved: boolean;
	mentioned: boolean;
	recommended: boolean;
	cited: boolean;
	prominenceRank: number | null;
	reviewState: DiagnosisReviewState;
	identitySnapshot: { name?: string };
	classificationEvidence: {
		review: { state: DiagnosisReviewState; reasonCodes: string[] };
		decisions: {
			retrieved: DecisionLike;
			mentioned: DecisionLike;
			recommended: DecisionLike;
			prominence: DecisionLike;
			cited: DecisionLike;
			entityType: DecisionLike;
		};
		sources: Array<{ id: string; reasonCodes: string[] }>;
	};
}

interface CitationLike {
	id: string;
	providerRunId: string;
	citationType: "first_party" | "independent" | "competitor" | "unknown";
	normalizedDomain: string | null;
}

interface CitationLinkLike {
	id: string;
	citationEvidenceId: string;
	entityEvidenceId: string;
	claim: "identity" | "mention" | "recommendation";
	status: "accepted" | "rejected" | "ambiguous" | "not_detected";
	reasonCodes: string[];
}

export interface DiagnosisInput {
	auditRun: { id: string; correlationId: string; createdAt: Date };
	intentFamilies: Array<{ id: string; key: string; name: string }>;
	promptVariants: Array<{ id: string; intentFamilyId: string; promptText: string; version: number }>;
	providerRuns: Array<{ id: string; promptVariantId: string; retrievalStatus: "retrieved" | "not_retrieved" }>;
	entityEvidence: EntityEvidenceLike[];
	citationEvidence: CitationLike[];
	citationClaimLinks: CitationLinkLike[];
}

export interface CompetitorCitationGapWinner {
	entityId: string;
	entityName: string;
	providerRunIds: string[];
	independentSourceDomains: string[];
	citationEvidenceIds: string[];
	citationClaimLinkIds: string[];
	citationTypeCounts: Record<"first_party" | "independent" | "competitor" | "unknown", number>;
}

export interface DiagnosisEvidenceSummary {
	sampleSize: number;
	providerRetrievedRuns: number;
	targetEntityEvidenceIds: string[];
	competitorEntityEvidenceIds: string[];
	targetCitationTypes: Array<"first_party" | "independent" | "competitor" | "unknown">;
	competitorCitationGap: {
		minimumSupportingRuns: number;
		repeatedSupportingEvidence: boolean;
		winners: CompetitorCitationGapWinner[];
	};
	promptVariantIds: string[];
	promptVersions: number[];
}

export interface DiagnosisFindingRecord {
	id: string;
	auditRunId: string;
	intentFamilyId: string;
	promptVariantId: string;
	schemaVersion: number;
	findingVersion: number;
	frozenPromptVersion: number;
	likelyFailureStage: LikelyFailureStage;
	confidence: number;
	reasonCodes: string[];
	supportingEvidenceIds: string[];
	contradictingEvidenceIds: string[];
	affectedProviderRunIds: string[];
	reviewState: DiagnosisReviewState;
	classifierId: string;
	classifierVersion: string;
	policyVersion: string;
	diagnosisEvidence: DiagnosisEvidenceSummary;
	correlationId: string;
	createdAt: Date;
}

export interface RemediationRecord {
	id: string;
	auditRunId: string;
	primaryFindingId: string;
	linkedFindingIds: string[];
	schemaVersion: number;
	remediationVersion: number;
	actionCategory: RemediationActionCategory;
	rationale: string;
	acceptanceCriteria: string[];
	priority: RemediationPriority;
	confidence: number;
	expectedEvidenceChange: string[];
	approvalState: RemediationApprovalState;
	policyVersion: string;
	correlationId: string;
	createdAt: Date;
}

export interface DiagnosisResult {
	findings: DiagnosisFindingRecord[];
	remediations: RemediationRecord[];
}

function deterministicUuid(seed: string): string {
	const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
	hex[12] = "5";
	hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
	const value = hex.join("");
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function evidenceForDecision(entity: EntityEvidenceLike | undefined, decision: keyof EntityEvidenceLike["classificationEvidence"]["decisions"]): string[] {
	if (!entity) return [];
	return unique([entity.id, ...entity.classificationEvidence.decisions[decision].sourceEvidenceIds]);
}

function stageLabel(stage: LikelyFailureStage): string {
	return stage === "maintain" ? "MAINTAIN" : stage.replaceAll("_", " ");
}

function remediationForFinding(finding: DiagnosisFindingRecord): RemediationRecord | null {
	if (finding.likelyFailureStage === "insufficient_evidence") return null;
	const repeatedCompetitorAuthority = finding.diagnosisEvidence.competitorCitationGap.repeatedSupportingEvidence;
	let actionCategory: RemediationActionCategory;
	let rationale: string;
	let acceptanceCriteria: string[];
	let expectedEvidenceChange: string[];
	let priority: RemediationPriority = "medium";
	let approvalState: RemediationApprovalState = "proposed";

	switch (finding.likelyFailureStage) {
		case "retrieval_failure":
			actionCategory = "technical_retrieval_access_remediation";
			priority = "high";
			rationale = "The likely retrieval-stage failure repeats across persisted runs; inspect deterministic access and retrieval prerequisites before changing content.";
			acceptanceCriteria = ["At least two replay samples in this intent family are retrieved", "No provider run remains classified as not_retrieved"];
			expectedEvidenceChange = ["provider_runs.retrieval_status changes to retrieved", "target retrieval can be evaluated from non-empty evidence"];
			break;
		case "category_fit_ambiguity":
			actionCategory = "category_clarification";
			rationale = "The response retrieves the broad category but resolves neither the target nor a tracked competitor, so category fit is the evidence-backed likely gap.";
			acceptanceCriteria = ["Replay at least two clarified problem-intent prompts", "A tracked entity is resolved without category-only ambiguity"];
			expectedEvidenceChange = ["category-only matches decrease", "accepted entity retrieval evidence appears"];
			break;
		case "entity_resolution_ambiguity":
			actionCategory = "entity_disambiguation";
			priority = "high";
			approvalState = "pending_human_review";
			rationale = "Identity evidence collides across tracked entities; aliases or entity metadata require review before any visibility remediation is safe.";
			acceptanceCriteria = ["A reviewer resolves the colliding alias", "Replayed identity evidence assigns the term to at most one tracked entity"];
			expectedEvidenceChange = ["ambiguous identity decisions become accepted or rejected", "review_state no longer remains pending"];
			break;
		case "mention_gap":
			actionCategory = "targeted_problem_intent_content";
			rationale = finding.diagnosisEvidence.targetCitationTypes.includes("first_party")
				? "First-party evidence already exists, so the likely gap is target linkage for this specific intent—not a need for more generic content. Reuse existing evidence in intent-specific material."
				: "The response is retrieved but does not resolve a target mention; add evidence tied narrowly to the affected problem intent.";
			acceptanceCriteria = ["Target mention is accepted in two consecutive replay samples", "The accepted mention links to the intended target identity"];
			expectedEvidenceChange = ["target mentioned becomes accepted", "target retrieval evidence references the intended identity"];
			break;
		case "recommendation_gap":
			actionCategory = "comparison_customer_evidence";
			rationale = "The target is mentioned but not recommended; strengthen decision-grade comparison or customer evidence for the affected intent rather than adding generic volume.";
			acceptanceCriteria = ["Target recommendation is accepted in two replay samples", "Recommendation evidence includes a positive, non-negated cue linked to the target"];
			expectedEvidenceChange = ["target recommended becomes accepted", "recommendation source evidence is linked to the target"];
			break;
		case "prominence_ranking_gap":
			actionCategory = "prominence_recommendation_improvement";
			rationale = "The target is recommended but appears below stronger-ranked options, making relative prominence the likely failure stage.";
			acceptanceCriteria = ["Target reaches rank two or better in two replay samples", "No tracked competitor is consistently ranked above the target"];
			expectedEvidenceChange = ["target prominence rank improves", "competitor-above-target evidence decreases"];
			break;
		case "citation_support_gap":
			actionCategory = "independent_authority_citation_acquisition";
			rationale = "The target recommendation has no accepted citation-to-claim support. Pursue verifiable support for the claim type, not a URL merely because it appeared.";
			acceptanceCriteria = ["An accepted citation claim link supports the target recommendation", "Support is reproduced in at least two replay samples"];
			expectedEvidenceChange = ["accepted target recommendation citation links appear", "citation support status is no longer not_detected"];
			break;
		case "independent_authority_gap":
			actionCategory = "independent_authority_citation_acquisition";
			rationale = "Substantial first-party evidence is already present, while the prompt asks for independent support. Seek independently verifiable authority; do not create more generic first-party content by default.";
			acceptanceCriteria = ["Accepted independent citation support appears across two distinct runs", "Each citation is linked to the target claim it supports"];
			expectedEvidenceChange = ["independent target citation count increases", "first-party-only support no longer determines the finding"];
			break;
		case "competitor_displacement":
			priority = "high";
			if (repeatedCompetitorAuthority) {
				actionCategory = "independent_authority_citation_acquisition";
				rationale = "A competitor repeatedly wins this intent with accepted independent citation support across distinct runs. Build independently verifiable support for the target claim; no specific observed URL is prescribed for acquisition.";
				acceptanceCriteria = ["Target gains accepted independent claim support across at least two distinct runs", "Competitor-supported losing prompts fall below two repeated runs"];
				expectedEvidenceChange = ["target independent citation support increases", "repeated competitor displacement evidence decreases"];
			} else {
				actionCategory = "prominence_recommendation_improvement";
				rationale = "A tracked competitor is recommended or ranked above the target, but repeated independent-source support is not established; improve comparative recommendation evidence without targeting a citation URL.";
				acceptanceCriteria = ["Target is recommended at or above the competitor in two replay samples", "No unsupported citation-acquisition action is introduced"];
				expectedEvidenceChange = ["target recommendation/prominence improves", "competitor displacement no longer wins precedence"];
			}
			break;
		case "human_review_required":
			actionCategory = "human_review_gather_more_evidence";
			priority = "high";
			approvalState = "pending_human_review";
			rationale = "The classified evidence is ambiguous or below the confidence threshold, so automated remediation is withheld pending review.";
			acceptanceCriteria = ["A reviewer accepts or rejects the ambiguous evidence", "Additional replay evidence resolves the low-confidence decision"];
			expectedEvidenceChange = ["pending review state is resolved", "diagnosis confidence is supported by accepted evidence"];
			break;
		case "maintain":
			actionCategory = "maintain";
			priority = "low";
			approvalState = "not_required";
			rationale = "Distinctive-intent evidence shows target retrieval, recommendation, prominence, and linked citation support. No major remediation is currently indicated.";
			acceptanceCriteria = ["Repeat the same frozen prompt during the next baseline", "Target recommendation and linked citation support remain accepted"];
			expectedEvidenceChange = ["no major negative evidence change", "accepted target evidence remains stable"];
			break;
	}

	return {
		id: deterministicUuid(`remediation:${finding.id}:${REMEDIATION_POLICY_VERSION}`),
		auditRunId: finding.auditRunId,
		primaryFindingId: finding.id,
		linkedFindingIds: [finding.id],
		schemaVersion: DIAGNOSIS_RECORD_SCHEMA_VERSION,
		remediationVersion: 1,
		actionCategory,
		rationale,
		acceptanceCriteria,
		priority,
		confidence: finding.confidence,
		expectedEvidenceChange,
		approvalState,
		policyVersion: REMEDIATION_POLICY_VERSION,
		correlationId: `${finding.correlationId}:remediation`,
		createdAt: new Date(finding.createdAt),
	};
}

export function diagnoseReplayEvidence(input: DiagnosisInput): DiagnosisResult {
	const promptsById = new Map(input.promptVariants.map((prompt) => [prompt.id, prompt]));
	const intentsById = new Map(input.intentFamilies.map((intent) => [intent.id, intent]));
	const entitiesById = new Map(input.entityEvidence.map((entity) => [entity.id, entity]));
	const citationsById = new Map(input.citationEvidence.map((citation) => [citation.id, citation]));
	const runsByIntent = new Map<string, DiagnosisInput["providerRuns"]>();
	for (const run of input.providerRuns) {
		const prompt = promptsById.get(run.promptVariantId);
		if (!prompt) throw new Error(`Missing frozen prompt for provider run ${run.id}`);
		const runs = runsByIntent.get(prompt.intentFamilyId) ?? [];
		runs.push(run);
		runsByIntent.set(prompt.intentFamilyId, runs);
	}

	const findings: DiagnosisFindingRecord[] = [];
	for (const [intentFamilyId, unsortedRuns] of [...runsByIntent.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const intent = intentsById.get(intentFamilyId);
		if (!intent) throw new Error(`Missing intent family ${intentFamilyId}`);
		const runs = [...unsortedRuns].sort((left, right) => left.id.localeCompare(right.id));
		const prompts = runs.map((run) => promptsById.get(run.promptVariantId)).filter((prompt): prompt is NonNullable<typeof prompt> => Boolean(prompt));
		const promptText = prompts.map((prompt) => prompt.promptText).join(" ").toLocaleLowerCase();
		const runIds = new Set(runs.map((run) => run.id));
		const entities = input.entityEvidence.filter((entity) => runIds.has(entity.providerRunId));
		const targets = entities.filter((entity) => entity.entityRole === "brand");
		const competitors = entities.filter((entity) => entity.entityRole === "competitor");
		const targetByRun = new Map(targets.map((target) => [target.providerRunId, target]));
		const target = [...targets].sort((left, right) => left.id.localeCompare(right.id))[0];
		const targetRecommended = targets.some((entity) => entity.recommended);
		const targetMentioned = targets.some((entity) => entity.mentioned);
		const targetRanks = targets.map((entity) => entity.prominenceRank).filter((rank): rank is number => rank !== null);
		const bestTargetRank = targetRanks.length > 0 ? Math.min(...targetRanks) : null;
		const competitorRecommended = competitors.some((entity) => entity.recommended);
		const competitorAboveTarget = competitors.some(
			(entity) => entity.prominenceRank !== null && (bestTargetRank === null || entity.prominenceRank < bestTargetRank),
		);
		const aliasCollision = targets.some((entity) =>
			entity.classificationEvidence.sources.some((source) => source.reasonCodes.includes("identity_collision")),
		);
		const pendingReview = targets.some((entity) => entity.reviewState === "pending");
		const providerRetrievedRuns = runs.filter((run) => run.retrievalStatus === "retrieved").length;

		const entityIds = new Set(entities.map((entity) => entity.id));
		const acceptedLinks = input.citationClaimLinks.filter(
			(link) => link.status === "accepted" && entityIds.has(link.entityEvidenceId),
		);
		const targetIds = new Set(targets.map((entity) => entity.id));
		const targetLinks = acceptedLinks.filter((link) => targetIds.has(link.entityEvidenceId));
		const targetCitationTypes = unique(
			targetLinks
				.map((link) => citationsById.get(link.citationEvidenceId)?.citationType)
				.filter((type): type is CitationLike["citationType"] => Boolean(type)),
		) as CitationLike["citationType"][];

		const winnerMap = new Map<string, CompetitorCitationGapWinner>();
		for (const link of acceptedLinks) {
			const entity = entitiesById.get(link.entityEvidenceId);
			const citation = citationsById.get(link.citationEvidenceId);
			if (!entity || entity.entityRole !== "competitor" || !citation || link.claim !== "recommendation") continue;
			const winner = winnerMap.get(entity.entityId) ?? {
				entityId: entity.entityId,
				entityName: entity.identitySnapshot.name ?? entity.entityId,
				providerRunIds: [],
				independentSourceDomains: [],
				citationEvidenceIds: [],
				citationClaimLinkIds: [],
				citationTypeCounts: { first_party: 0, independent: 0, competitor: 0, unknown: 0 },
			};
			winner.providerRunIds.push(entity.providerRunId);
			winner.citationEvidenceIds.push(citation.id);
			winner.citationClaimLinkIds.push(link.id);
			winner.citationTypeCounts[citation.citationType]++;
			if (citation.citationType === "independent" && citation.normalizedDomain) {
				winner.independentSourceDomains.push(citation.normalizedDomain);
			}
			winnerMap.set(entity.entityId, winner);
		}
		const winners = [...winnerMap.values()]
			.map((winner) => ({
				...winner,
				providerRunIds: unique(winner.providerRunIds),
				independentSourceDomains: unique(winner.independentSourceDomains),
				citationEvidenceIds: unique(winner.citationEvidenceIds),
				citationClaimLinkIds: unique(winner.citationClaimLinkIds),
			}))
			.sort((left, right) => left.entityId.localeCompare(right.entityId));
		const repeatedCompetitorAuthority = winners.some(
			(winner) => winner.providerRunIds.length >= MINIMUM_REPEATED_EVIDENCE_RUNS && winner.citationTypeCounts.independent >= MINIMUM_REPEATED_EVIDENCE_RUNS,
		);

		let likelyFailureStage: LikelyFailureStage;
		let confidence: number;
		let reasonCodes: string[];
		let reviewState: DiagnosisReviewState = "not_required";
		let supportingEvidenceIds: string[];
		let contradictingEvidenceIds: string[] = [];

		if (aliasCollision) {
			likelyFailureStage = "entity_resolution_ambiguity";
			confidence = 0.9;
			reasonCodes = ["identity_collision_prevents_safe_diagnosis", "human_review_required"];
			reviewState = "pending";
			supportingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "mentioned"));
		} else if (providerRetrievedRuns > 0 && promptText.includes("portable workstation") && !targetMentioned && !competitorRecommended) {
			likelyFailureStage = "category_fit_ambiguity";
			confidence = 0.86;
			reasonCodes = ["broad_category_retrieved_without_tracked_entity", "portable_workstation_category_ambiguous"];
			supportingEvidenceIds = [...runs.map((run) => run.id), ...targets.map((entity) => entity.id)];
		} else if (pendingReview) {
			likelyFailureStage = "human_review_required";
			confidence = 0.5;
			reasonCodes = ["ambiguous_or_low_confidence_classification", "automated_remediation_withheld"];
			reviewState = "pending";
			supportingEvidenceIds = targets.flatMap((entity) => [entity.id, ...entity.classificationEvidence.sources.map((source) => source.id)]);
		} else if (providerRetrievedRuns === 0) {
			supportingEvidenceIds = runs.map((run) => run.id);
			if (runs.length >= MINIMUM_REPEATED_EVIDENCE_RUNS) {
				likelyFailureStage = "retrieval_failure";
				confidence = 0.92;
				reasonCodes = ["repeated_provider_non_retrieval", "minimum_sample_met"];
			} else {
				likelyFailureStage = "insufficient_evidence";
				confidence = 0.55;
				reasonCodes = ["single_non_retrieval_sample", "minimum_sample_not_met", "no_remediation_generated"];
			}
		} else if (repeatedCompetitorAuthority || (competitorRecommended && (!targetRecommended || competitorAboveTarget))) {
			likelyFailureStage = "competitor_displacement";
			confidence = repeatedCompetitorAuthority ? 0.95 : 0.9;
			reasonCodes = repeatedCompetitorAuthority
				? ["competitor_wins_repeated_losing_prompts", "repeated_independent_citation_support"]
				: ["competitor_recommended_or_ranked_above_target", "relative_evidence_gap"];
			supportingEvidenceIds = [
				...competitors.flatMap((entity) => evidenceForDecision(entity, "recommended")),
				...winners.flatMap((winner) => [...winner.citationEvidenceIds, ...winner.citationClaimLinkIds]),
			];
			contradictingEvidenceIds = targets.filter((entity) => entity.recommended).flatMap((entity) => evidenceForDecision(entity, "recommended"));
		} else if (!targetMentioned) {
			likelyFailureStage = "mention_gap";
			confidence = 0.84;
			reasonCodes = targetCitationTypes.includes("first_party")
				? ["target_not_mentioned_for_intent", "first_party_evidence_already_present", "generic_content_not_inferred"]
				: ["retrieved_response_without_target_mention"];
			supportingEvidenceIds = [...runs.map((run) => run.id), ...targets.map((entity) => entity.id)];
			contradictingEvidenceIds = targetLinks.flatMap((link) => [link.id, link.citationEvidenceId]);
		} else if (!targetRecommended) {
			likelyFailureStage = "recommendation_gap";
			confidence = 0.88;
			reasonCodes = ["target_mentioned_without_recommendation", "mention_prevents_mention_gap_precedence"];
			supportingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "mentioned"));
			contradictingEvidenceIds = targetLinks.flatMap((link) => [link.id, link.citationEvidenceId]);
		} else if (bestTargetRank !== null && bestTargetRank > 1) {
			likelyFailureStage = "prominence_ranking_gap";
			confidence = 0.91;
			reasonCodes = ["target_recommended_below_top_rank", `best_target_rank_${bestTargetRank}`];
			supportingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "prominence"));
			contradictingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "recommended"));
		} else if (targetLinks.length === 0) {
			likelyFailureStage = "citation_support_gap";
			confidence = 0.89;
			reasonCodes = ["target_recommended_without_accepted_citation_support", "citation_presence_alone_not_used"];
			supportingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "recommended"));
		} else if (promptText.includes("independent") && targetCitationTypes.every((type) => type === "first_party")) {
			likelyFailureStage = "independent_authority_gap";
			confidence = 0.9;
			reasonCodes = ["independent_support_requested", "target_support_first_party_only", "generic_content_not_inferred"];
			supportingEvidenceIds = targetLinks.flatMap((link) => [link.id, link.citationEvidenceId]);
			contradictingEvidenceIds = targets.flatMap((entity) => evidenceForDecision(entity, "recommended"));
		} else if (targetRecommended && targetLinks.length > 0) {
			likelyFailureStage = "maintain";
			confidence = 0.94;
			reasonCodes = ["distinctive_intent_target_recommended", "accepted_target_citation_support", "no_major_remediation_signal"];
			supportingEvidenceIds = [
				...targets.flatMap((entity) => evidenceForDecision(entity, "recommended")),
				...targetLinks.flatMap((link) => [link.id, link.citationEvidenceId]),
			];
		} else {
			likelyFailureStage = "insufficient_evidence";
			confidence = 0.5;
			reasonCodes = ["precedence_rules_not_satisfied", "minimum_evidence_not_met", "no_remediation_generated"];
			supportingEvidenceIds = [...runs.map((run) => run.id), ...targets.map((entity) => entity.id)];
		}

		const primaryPrompt = [...prompts].sort((left, right) => left.version - right.version || left.id.localeCompare(right.id))[0];
		if (!primaryPrompt) throw new Error(`No prompt variants found for intent ${intentFamilyId}`);
		const findingId = deterministicUuid(`finding:${input.auditRun.id}:${intentFamilyId}:${DIAGNOSIS_CLASSIFIER_VERSION}:${REMEDIATION_POLICY_VERSION}`);
		findings.push({
			id: findingId,
			auditRunId: input.auditRun.id,
			intentFamilyId,
			promptVariantId: primaryPrompt.id,
			schemaVersion: DIAGNOSIS_RECORD_SCHEMA_VERSION,
			findingVersion: 1,
			frozenPromptVersion: primaryPrompt.version,
			likelyFailureStage,
			confidence,
			reasonCodes,
			supportingEvidenceIds: unique(supportingEvidenceIds),
			contradictingEvidenceIds: unique(contradictingEvidenceIds),
			affectedProviderRunIds: unique(runs.map((run) => run.id)),
			reviewState,
			classifierId: DIAGNOSIS_CLASSIFIER_ID,
			classifierVersion: DIAGNOSIS_CLASSIFIER_VERSION,
			policyVersion: REMEDIATION_POLICY_VERSION,
			diagnosisEvidence: {
				sampleSize: runs.length,
				providerRetrievedRuns,
				targetEntityEvidenceIds: unique(targets.map((entity) => entity.id)),
				competitorEntityEvidenceIds: unique(competitors.map((entity) => entity.id)),
				targetCitationTypes,
				competitorCitationGap: {
					minimumSupportingRuns: MINIMUM_REPEATED_EVIDENCE_RUNS,
					repeatedSupportingEvidence: repeatedCompetitorAuthority,
					winners,
				},
				promptVariantIds: unique(prompts.map((prompt) => prompt.id)),
				promptVersions: [...new Set(prompts.map((prompt) => prompt.version))].sort((left, right) => left - right),
			},
			correlationId: `${input.auditRun.correlationId}:finding:${intent.key}:${stageLabel(likelyFailureStage)}`,
			createdAt: new Date(input.auditRun.createdAt),
		});
	}

	const remediations = findings
		.map(remediationForFinding)
		.filter((remediation): remediation is RemediationRecord => remediation !== null);
	return { findings, remediations };
}
