import type { CustomerAuditReportView } from "../server/audit-report";

type Result = CustomerAuditReportView["results"][number];
type ActionResult = Result & { remediation: NonNullable<Result["remediation"]> };

export const actionTitles: Record<ActionResult["remediation"]["actionCategory"], string> = {
	category_clarification: "Make your business category clearer",
	targeted_problem_intent_content: "Answer the customer questions that are missing",
	comparison_customer_evidence: "Strengthen comparisons with customer evidence",
	independent_authority_citation_acquisition: "Build credible independent coverage",
	technical_retrieval_access_remediation: "Resolve barriers to accessing your content",
	entity_disambiguation: "Make your business identity unambiguous",
	prominence_recommendation_improvement: "Strengthen evidence for recommending your business",
	maintain: "Keep what is working and monitor it",
	human_review_gather_more_evidence: "Gather more evidence before making changes",
};

const priorityOrder = { high: 0, medium: 1, low: 2 };

export function summarizeCustomerReport(report: Pick<CustomerAuditReportView, "frozen" | "results">) {
	const candidates = report.results.filter(
		(result): result is ActionResult =>
			result.remediation !== null &&
			result.remediation.actionCategory !== "maintain" &&
			result.remediation.approvalAtFreeze !== "rejected" &&
			result.diagnosis.reviewState !== "rejected",
	);
	const reviewNeeded = report.results.some(
		(result) =>
			!result.remediation ||
			result.diagnosis.reviewState === "pending" ||
			result.diagnosis.reviewState === "rejected" ||
			result.remediation.approvalAtFreeze === "rejected" ||
			result.remediation.approvalAtFreeze === "pending_human_review" ||
			result.remediation.actionCategory === "human_review_gather_more_evidence",
	);
	const actions = report.frozen.verified
		? candidates
				.sort((a, b) => priorityOrder[a.remediation.priority] - priorityOrder[b.remediation.priority])
				.slice(0, 3)
				.map((result) => ({
					result,
					needsReview:
						result.diagnosis.reviewState === "pending" ||
						result.remediation.approvalAtFreeze === "pending_human_review" ||
						result.remediation.actionCategory === "human_review_gather_more_evidence",
				}))
		: [];
	const verdict = !report.frozen.verified
		? "Verify this report before acting"
		: !report.results.length
			? "There is not enough evidence to recommend changes"
			: reviewNeeded
				? "Some findings need review before you act"
				: candidates.length
					? "There are opportunities to improve your AI visibility"
					: "Keep what is working and monitor it";
	const explanation = !report.frozen.verified
		? "The saved evidence did not pass its integrity check. Recommendations are withheld until the report is verified."
		: !report.results.length
			? "No customer-question groups are available in this report. Gather evidence before deciding what to change."
			: reviewNeeded
				? "Some evidence is missing, disputed or awaiting review. Resolve those questions before treating the related suggestions as ready to implement."
				: candidates.length
					? "Start with the highest-priority suggestions below, then use a follow-up audit to check whether the evidence changes."
					: "The saved scenarios recommend maintaining the current approach. This does not establish that your live visibility needs no improvement.";
	return { verdict, explanation, actions, actionCount: report.frozen.verified ? candidates.length : 0 };
}
