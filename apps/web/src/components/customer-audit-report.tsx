import { IconAlertTriangle, IconFileDescription, IconPrinter, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import type { CustomerAuditReportView } from "@/server/audit-report";

function label(value: string): string {
	return value === "maintain" ? "MAINTAIN" : value.replaceAll("_", " ");
}

function metric(value: number | boolean | null): string {
	if (value === null) return "none";
	return String(value);
}

export function CustomerAuditReport({ report }: { report: CustomerAuditReportView }) {
	return (
		<section className="space-y-5 rounded-lg border bg-background p-4 print:border-0 print:p-0" aria-label="Customer audit report">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<IconFileDescription className="h-5 w-5 text-primary" />
						<h2 className="text-lg font-semibold">Zentaviq customer audit report</h2>
					</div>
					<p className="text-sm text-muted-foreground">
						{report.business.name} · frozen evidence baseline versus deterministic fixture retest
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
					<IconPrinter className="mr-2 h-4 w-4" /> Print report
				</Button>
			</header>

			<div className="grid gap-3 md:grid-cols-3">
				<div className="rounded-md border p-3">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Executive summary</p>
					<p className="mt-2 text-sm">
						{report.baselineSummary.diagnosisFindingCount} evidence-backed likely diagnoses across{" "}
						{report.results.length} intent families.
					</p>
					{report.outcomeCounts ? (
						<p className="mt-2 text-xs text-muted-foreground">
							Improved {report.outcomeCounts.improved} · unchanged {report.outcomeCounts.unchanged} · regressed{" "}
							{report.outcomeCounts.regressed} · review {report.outcomeCounts.pending_human_review} · insufficient{" "}
							{report.outcomeCounts.insufficient_evidence}
						</p>
					) : (
						<p className="mt-2 text-xs text-muted-foreground">Retest not yet persisted.</p>
					)}
				</div>
				<div className="rounded-md border p-3">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Audit scope</p>
					<p className="mt-2 text-sm">
						{report.baselineSummary.providerRunCount} runs · {report.baselineSummary.retrievedRuns} retrieved ·{" "}
						{report.baselineSummary.recommendedEntities} recommendations
					</p>
					<p className="mt-2 text-xs text-muted-foreground">
						{report.baselineSummary.citationEvidenceCount} citations · {report.baselineSummary.citationClaimLinkCount}{" "}
						claim links
					</p>
				</div>
				<div className="rounded-md border p-3">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Frozen baseline</p>
					<div className="mt-2 flex items-center gap-2 text-sm">
						<IconShieldCheck className="h-4 w-4 text-emerald-600" />
						Checksum {report.frozen.verified ? "verified" : "invalid"}
					</div>
					<p className="mt-2 break-all text-[10px] text-muted-foreground">{report.frozen.snapshotChecksum}</p>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<h3 className="text-sm font-semibold">Scope and methodology</h3>
					<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
						{report.methodology.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
				<div className="space-y-2">
					<h3 className="text-sm font-semibold">Provider, model and benchmark disclosure</h3>
					{report.providerDisclosure.map((provider) => (
						<div key={`${provider.providerId}:${provider.modelId}:${provider.modelVersion}`} className="rounded border p-2 text-xs">
							<p className="font-medium">
								{provider.providerId} / {provider.modelId} / {provider.modelVersion}
							</p>
							<p className="text-muted-foreground">
								Benchmark {provider.benchmarkVersion ?? "not recorded"} · network {provider.networkAccess ?? "not recorded"}
							</p>
						</div>
					))}
				</div>
			</div>

			<div className="space-y-3">
				<div>
					<h3 className="text-sm font-semibold">Results by intent family</h3>
					<p className="text-xs text-muted-foreground">
						Observed evidence, deterministic classification, likely diagnosis, action decision and measured retest outcome are shown separately.
					</p>
				</div>
				{report.results.map((result) => (
					<details key={result.intentFamilyId} className="rounded-md border p-3 print:break-inside-avoid">
						<summary className="cursor-pointer text-sm font-medium">
							{result.intentName} · {result.comparison ? label(result.comparison.outcome) : "baseline frozen"}
						</summary>
						<div className="mt-3 space-y-3 text-xs">
							<div className="grid gap-2 md:grid-cols-2">
								<div className="rounded bg-muted/40 p-2">
									<p className="font-medium">Observed baseline evidence</p>
									<p className="text-muted-foreground">
										Retrieved {result.baselineMetrics.targetRetrievedRuns}/{result.baselineMetrics.sampleSize} · mentioned{" "}
										{result.baselineMetrics.targetMentionedRuns} · recommended {result.baselineMetrics.targetRecommendedRuns} · rank{" "}
										{metric(result.baselineMetrics.targetBestProminenceRank)} · target support{" "}
										{result.baselineMetrics.targetRecommendationCitationLinks}
									</p>
								</div>
								<div className="rounded bg-muted/40 p-2">
									<p className="font-medium">Retest observation</p>
									{result.retestMetrics ? (
										<p className="text-muted-foreground">
											Retrieved {result.retestMetrics.targetRetrievedRuns}/{result.retestMetrics.sampleSize} · mentioned{" "}
											{result.retestMetrics.targetMentionedRuns} · recommended {result.retestMetrics.targetRecommendedRuns} · rank{" "}
											{metric(result.retestMetrics.targetBestProminenceRank)} · target support{" "}
											{result.retestMetrics.targetRecommendationCitationLinks}
										</p>
									) : (
										<p className="text-muted-foreground">No retest has been persisted.</p>
									)}
								</div>
							</div>

							<div className="rounded border-l-4 border-l-primary p-2">
								<p className="font-medium">Likely diagnosis · {label(result.diagnosis.likelyFailureStage)}</p>
								<p className="text-muted-foreground">
									Confidence {result.diagnosis.confidence} · {result.diagnosis.reasonCodes.join(", ")}
								</p>
								<p className="mt-1 break-all text-[10px] text-muted-foreground">
									Supporting: {result.diagnosis.supportingEvidenceIds.join(", ")}
								</p>
								{result.diagnosis.contradictingEvidenceIds.length > 0 && (
									<p className="break-all text-[10px] text-muted-foreground">
										Contradicting: {result.diagnosis.contradictingEvidenceIds.join(", ")}
									</p>
								)}
							</div>

							{result.remediation ? (
								<div className="rounded border p-2">
									<p className="font-medium">
										{label(result.remediation.actionCategory)} · {result.remediation.approvalAtFreeze}
									</p>
									<p className="text-muted-foreground">{result.remediation.rationale}</p>
									<p className="mt-2 font-medium">Acceptance and retest criteria</p>
									<ul className="list-disc pl-5 text-muted-foreground">
										{result.remediation.acceptanceCriteria.map((criterion) => (
											<li key={criterion}>{criterion}</li>
										))}
									</ul>
								</div>
							) : (
								<div className="rounded border p-2">
									<p className="font-medium">Insufficient evidence · no remediation generated</p>
								</div>
							)}

							{result.comparison && (
								<div className="rounded bg-primary/5 p-2">
									<p className="font-medium">
										Measured outcome · {label(result.comparison.outcome)} · confidence {result.comparison.confidence}
									</p>
									<p className="text-muted-foreground">{result.comparison.reasonCodes.join(", ")}</p>
									<ul className="mt-2 list-disc pl-5 text-muted-foreground">
										{result.comparison.observedChanges.map((change) => (
											<li key={change}>{change}</li>
										))}
									</ul>
									<p className="mt-2 text-[10px] text-muted-foreground">
										Observed change associated with the retest; no causal claim is made. Comparator v
										{result.comparison.comparatorVersion}.
									</p>
								</div>
							)}

							{result.competitorCitationGap.winners.map((winner) => (
								<div key={winner.entityId} className="rounded border border-dashed p-2">
									<p className="font-medium">Competitor citation gap · {winner.entityName}</p>
									<p className="text-muted-foreground">
										Independent {winner.citationTypeCounts.independent} · competitor-owned{" "}
										{winner.citationTypeCounts.competitor} · first-party {winner.citationTypeCounts.first_party} · unknown{" "}
										{winner.citationTypeCounts.unknown}. No cited URL is prescribed for acquisition.
									</p>
								</div>
							))}

							<details className="rounded border p-2">
								<summary className="cursor-pointer font-medium">Traceability: raw responses, classifications and citations</summary>
								<div className="mt-2 space-y-2">
									{result.trace.map((trace) => (
										<div key={`${trace.phase}:${trace.providerRunId}`} className="rounded bg-muted/30 p-2">
											<p className="font-medium">
												{trace.phase} · {trace.fixtureId}
											</p>
											<pre className="mt-1 whitespace-pre-wrap rounded bg-background p-2 font-mono text-[10px]">
												{trace.rawResponse || "[no response retrieved]"}
											</pre>
											{trace.entities.map((entity) => (
												<p key={entity.id} className="mt-1 text-muted-foreground">
													{entity.name}: retrieved {String(entity.retrieved)}, mentioned {String(entity.mentioned)}, recommended{" "}
													{String(entity.recommended)}, rank {entity.prominenceRank ?? "none"}, cited {String(entity.cited)}
												</p>
											))}
											{trace.citations.map((citation) => (
												<p key={citation.id} className="break-all text-muted-foreground">
													Citation {citation.type}: {citation.url} · accepted target/entity links{" "}
													{citation.acceptedClaimLinkIds.length}
												</p>
											))}
										</div>
									))}
								</div>
							</details>
							<p className="text-[10px] text-muted-foreground">
								Finding {result.diagnosis.findingId} · classifier v{result.diagnosis.classifierVersion} · policy v
								{result.diagnosis.policyVersion}
							</p>
						</div>
					</details>
				))}
			</div>

			<div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
				<div className="flex items-center gap-2 text-sm font-medium">
					<IconAlertTriangle className="h-4 w-4 text-amber-600" /> Evidence limitations
				</div>
				<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
					{report.limitations.map((limitation) => (
						<li key={limitation}>{limitation}</li>
					))}
				</ul>
			</div>

			<footer className="border-t pt-3 text-[10px] text-muted-foreground">
				Frozen {new Date(report.frozen.frozenAt).toLocaleString()} · report {report.frozen.reportGenerationVersion} · benchmark{" "}
				{report.frozen.benchmarkVersion} · correlation {report.frozen.correlationId}
			</footer>
		</section>
	);
}
