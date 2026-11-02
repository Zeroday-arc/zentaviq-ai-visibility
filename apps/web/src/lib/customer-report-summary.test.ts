import { describe, expect, it } from "vitest";
import type { CustomerAuditReportView } from "../server/audit-report";
import { summarizeCustomerReport } from "./customer-report-summary";

type Result = CustomerAuditReportView["results"][number];
function result(
	id: string,
	priority: "low" | "medium" | "high" = "medium",
	category = "category_clarification",
): Result {
	return {
		intentFamilyId: id,
		diagnosis: { reviewState: "not_required" },
		remediation: { actionCategory: category, priority, approvalAtFreeze: "proposed" },
	} as Result;
}
function summarize(results: Result[], verified = true) {
	return summarizeCustomerReport({ results, frozen: { verified } as CustomerAuditReportView["frozen"] });
}

describe("customer report overview", () => {
	it("withholds actions when integrity verification fails", () => {
		const summary = summarize([result("one")], false);
		expect(summary.actions).toEqual([]);
		expect(summary.verdict).toBe("Verify this report before acting");
	});
	it("does not interpret an empty report as a healthy result", () => {
		expect(summarize([]).verdict).toBe("There is not enough evidence to recommend changes");
	});
	it("shows the three highest recorded priorities without mutating evidence order", () => {
		const results = [result("low", "low"), result("medium"), result("high", "high"), result("high-two", "high")];
		const summary = summarize(results);
		expect(summary.actions.map(({ result }) => result.intentFamilyId)).toEqual(["high", "high-two", "medium"]);
		expect(summary.actionCount).toBe(4);
		expect(results[0].intentFamilyId).toBe("low");
	});
	it("keeps maintenance out of the change list", () => {
		const summary = summarize([result("maintain", "low", "maintain")]);
		expect(summary.actions).toEqual([]);
		expect(summary.verdict).toBe("Keep what is working and monitor it");
	});
	it("marks pending and gather-evidence actions as requiring review", () => {
		const pending = result("pending");
		pending.diagnosis.reviewState = "pending";
		const summary = summarize([pending, result("gather", "high", "human_review_gather_more_evidence")]);
		expect(summary.actions.every((action) => action.needsReview)).toBe(true);
		expect(summary.verdict).toBe("Some findings need review before you act");
	});
	it("does not recommend rejected actions or call missing evidence healthy", () => {
		const rejected = result("rejected");
		rejected.remediation!.approvalAtFreeze = "rejected";
		const missing = result("missing");
		missing.remediation = null;
		const summary = summarize([rejected, missing]);
		expect(summary.actions).toEqual([]);
		expect(summary.verdict).toBe("Some findings need review before you act");
	});
});
