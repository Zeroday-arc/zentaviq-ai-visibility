import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconDatabase, IconPlayerPlay, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { getLatestReplayBaselineFn, getLatestReplayEvidenceFn, runReplayBaselineFn } from "@/server/replay-audit";

const replayBaselineKey = (brandId: string) => ["replay-baseline", brandId] as const;
const replayEvidenceKey = (brandId: string) => ["replay-evidence", brandId] as const;

function policyLabel(value: string): string {
	return value === "maintain" ? "MAINTAIN" : value.replaceAll("_", " ");
}

export function ReplayBaselineCard({ brandId }: { brandId: string }) {
	const queryClient = useQueryClient();
	const replayQuery = useQuery({
		queryKey: replayBaselineKey(brandId),
		queryFn: () => getLatestReplayBaselineFn({ data: { brandId } }),
		retry: false,
		refetchOnWindowFocus: false,
	});
	const replayMutation = useMutation({
		mutationFn: () => runReplayBaselineFn({ data: { brandId } }),
		onSuccess: (result) => {
			queryClient.setQueryData(replayBaselineKey(brandId), result.summary);
			queryClient.setQueryData(replayEvidenceKey(brandId), result);
		},
	});
	const evidenceQuery = useQuery({
		queryKey: replayEvidenceKey(brandId),
		queryFn: () => getLatestReplayEvidenceFn({ data: { brandId } }),
		retry: false,
		refetchOnWindowFocus: false,
	});

	const summary = replayMutation.data?.summary ?? replayQuery.data;
	const evidence = replayMutation.data ?? evidenceQuery.data;
	const error = replayMutation.error ?? replayQuery.error ?? evidenceQuery.error;

	return (
		<Card className="w-full text-left shadow-none border-dashed">
			<CardHeader className="pb-3">
				<div className="flex items-start gap-3">
					<div className="rounded-md bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400">
						<IconDatabase className="h-5 w-5" />
					</div>
					<div className="space-y-1">
						<CardTitle className="text-base">Fixture replay baseline</CardTitle>
						<p className="text-sm text-muted-foreground">
							Persist bundled evidence-classification scenarios locally. Replay mode performs no provider or external
							network requests.
						</p>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{summary && (
					<div className="rounded-md border bg-muted/30 p-3">
						<div className="mb-2 flex items-center gap-2 text-sm font-medium">
							<IconShieldCheck className="h-4 w-4 text-emerald-600" />
							Immutable evidence persisted
						</div>
						<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-7">
							<span>
								<strong className="text-foreground">{summary.fixtureCount}</strong> fixtures
							</span>
							<span>
								<strong className="text-foreground">{summary.retrievedRuns}</strong> retrieved
							</span>
							<span>
								<strong className="text-foreground">{summary.recommendedEntities}</strong> recommended
							</span>
							<span>
								<strong className="text-foreground">{summary.citationEvidenceCount}</strong> citations
							</span>
							<span>
								<strong className="text-foreground">{summary.pendingReviewEntities}</strong> review
							</span>
							<span>
								<strong className="text-foreground">{summary.diagnosisFindingCount}</strong> findings
							</span>
							<span>
								<strong className="text-foreground">{summary.maintainDecisionCount}</strong> maintain
							</span>
						</div>
					</div>
				)}

				{evidence && evidence.diagnoses.length > 0 && (
					<div className="space-y-3">
						<div>
							<h3 className="text-sm font-semibold">Likely failure diagnosis and remediation</h3>
							<p className="text-xs text-muted-foreground">
								Deterministic, evidence-backed likely stages only. Actions are created after diagnosis and never directly
								from a visibility score.
							</p>
						</div>
						<div className="max-h-[48rem] space-y-2 overflow-y-auto pr-1">
							{evidence.diagnoses.map((diagnosis) => (
								<details key={diagnosis.id} className="rounded-md border bg-background p-3">
									<summary className="cursor-pointer text-sm font-medium">
										{diagnosis.intentName} · {policyLabel(diagnosis.likelyFailureStage)}
									</summary>
									<div className="mt-3 space-y-3 text-xs">
										<div className="flex flex-wrap items-center gap-2">
											<span className="rounded bg-muted px-1.5 py-0.5">
												Likely diagnosis: {policyLabel(diagnosis.likelyFailureStage)}
											</span>
											<span>confidence {diagnosis.confidence}</span>
											{diagnosis.reviewState === "pending" && (
												<span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
													<IconAlertTriangle className="h-3 w-3" /> Human review required
												</span>
											)}
										</div>
										<div>
											<p className="font-medium">Frozen prompt v{diagnosis.frozenPromptVersion}</p>
											<p className="text-muted-foreground">{diagnosis.promptText}</p>
										</div>
										{diagnosis.affectedRuns.map((run) => (
											<div key={run.providerRunId} className="rounded border p-2">
												<p className="font-medium">Raw response · {run.fixtureId}</p>
												<pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">
													{run.rawResponse || "[no response retrieved]"}
												</pre>
												<div className="mt-2 space-y-1">
													{run.entities.map((entity) => (
														<p key={`${run.providerRunId}:${entity.name}`} className="text-muted-foreground">
															Classification · {entity.name} ({entity.role}): retrieved {String(entity.retrieved)}, mentioned{" "}
															{String(entity.mentioned)}, recommended {String(entity.recommended)}, rank{" "}
															{entity.prominenceRank ?? "none"}, cited {String(entity.cited)}
														</p>
													))}
												</div>
											</div>
										))}
										<div className="rounded border-l-4 border-l-primary p-2">
											<p className="font-medium">Finding · {policyLabel(diagnosis.likelyFailureStage)}</p>
											<p className="text-muted-foreground">Reasons: {diagnosis.reasonCodes.join(", ")}</p>
											<p className="break-all text-[10px] text-muted-foreground">
												Supporting evidence: {diagnosis.supportingEvidenceIds.join(", ")}
											</p>
											{diagnosis.contradictingEvidenceIds.length > 0 && (
												<p className="break-all text-[10px] text-muted-foreground">
													Contradicting evidence: {diagnosis.contradictingEvidenceIds.join(", ")}
												</p>
											)}
										</div>
										{diagnosis.evidence.competitorCitationGap.winners.map((winner) => (
											<div key={winner.entityId} className="rounded border border-dashed p-2">
												<p className="font-medium">Competitor citation gap · {winner.entityName}</p>
												<p className="text-muted-foreground">
													{winner.providerRunIds.length} supporting runs · independent {winner.citationTypeCounts.independent} ·
													competitor-owned {winner.citationTypeCounts.competitor} · first-party{" "}
													{winner.citationTypeCounts.first_party} · unknown {winner.citationTypeCounts.unknown}
												</p>
												<p className="text-muted-foreground">
													Independent sources: {winner.independentSourceDomains.join(", ") || "none"}
												</p>
											</div>
										))}
										{diagnosis.remediation ? (
											<div className="rounded bg-muted/40 p-2">
												<p className="font-medium">
													{policyLabel(diagnosis.remediation.actionCategory)} · {diagnosis.remediation.priority} priority
												</p>
												<p className="mt-1 text-muted-foreground">{diagnosis.remediation.rationale}</p>
												<p className="mt-2 font-medium">Acceptance / retest criteria</p>
												<ul className="list-disc space-y-1 pl-4 text-muted-foreground">
													{diagnosis.remediation.acceptanceCriteria.map((criterion) => (
														<li key={criterion}>{criterion}</li>
													))}
												</ul>
											</div>
										) : (
											<div className="rounded bg-muted/40 p-2">
												<p className="font-medium">Insufficient evidence · no remediation generated</p>
												<p className="text-muted-foreground">
													Gather another persisted replay sample for this frozen intent before proposing an action.
												</p>
											</div>
										)}
										<p className="text-[10px] text-muted-foreground">
											{diagnosis.classifierId} v{diagnosis.classifierVersion} · policy v{diagnosis.policyVersion} ·{" "}
											{diagnosis.correlationId}
										</p>
									</div>
								</details>
							))}
						</div>
					</div>
				)}

				{evidence && evidence.scenarios.length > 0 && (
					<div className="space-y-3">
						<div>
							<h3 className="text-sm font-semibold">Evidence trace</h3>
							<p className="text-xs text-muted-foreground">
								Open a replay to trace every decision to the raw response, exact offsets, citation link and classifier
								version.
							</p>
						</div>
						<div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
							{evidence.scenarios.map((scenario) => (
								<details key={scenario.fixtureId} className="rounded-md border bg-background p-3">
									<summary className="cursor-pointer text-sm font-medium">{scenario.fixtureId}</summary>
									<div className="mt-3 space-y-3 text-xs">
										<div>
											<p className="font-medium">Frozen prompt</p>
											<p className="text-muted-foreground">{scenario.promptText}</p>
										</div>
										<div>
											<p className="font-medium">Raw replay response</p>
											<pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">
												{scenario.rawResponse || "[no response retrieved]"}
											</pre>
										</div>
										<div className="space-y-2">
											{scenario.entities.map((entity) => (
												<div key={entity.id} className="rounded border p-2">
													<div className="flex flex-wrap items-center gap-2">
														<strong>{entity.name}</strong>
														<span className="rounded bg-muted px-1.5 py-0.5">{entity.trace.entityType}</span>
														{entity.reviewState === "pending" && (
															<span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
																<IconAlertTriangle className="h-3 w-3" /> Human review
															</span>
														)}
													</div>
													<div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
														{Object.entries(entity.trace.decisions).map(([name, item]) => (
															<div key={name} className="rounded bg-muted/40 px-2 py-1">
																<span className="font-medium">{name}</span>: {item.status}
																{typeof item.value === "number" ? ` (#${item.value})` : ""}
															</div>
														))}
													</div>
													<div className="mt-2 space-y-1">
														{entity.trace.sources.map((source) => (
															<div key={source.id} className="border-l-2 pl-2 text-muted-foreground">
																<p>
																	{source.disposition} · {source.matchRule} · v{source.classifierVersion} · confidence{" "}
																	{source.confidence}
																</p>
																<code>
																	[{source.start}–{source.end}] {source.excerpt || "[empty response]"}
																</code>
															</div>
														))}
													</div>
												</div>
											))}
										</div>
										{scenario.citations.map((citation) => (
											<div key={citation.id} className="rounded border border-dashed p-2">
												<p className="font-medium">Citation · {citation.type}</p>
												<code className="break-all text-muted-foreground">{citation.url}</code>
												{citation.links.map((link) => (
													<p key={`${link.entityEvidenceId}:${link.claim}`} className="mt-1 text-muted-foreground">
														{link.status} for {link.entityName} · {link.claim} · {link.rule} · v{link.classifierVersion}{" "}
														· [{link.start}–{link.end}]
													</p>
												))}
											</div>
										))}
										<p className="text-[10px] text-muted-foreground">
											{scenario.extractorId} v{scenario.extractorVersion} · {scenario.correlationId}
										</p>
									</div>
								</details>
							))}
						</div>
					</div>
				)}

				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error instanceof Error ? error.message : "Fixture replay failed"}
					</p>
				)}

				<Button
					type="button"
					variant="secondary"
					className="w-full"
					disabled={replayMutation.isPending || replayQuery.isLoading}
					onClick={() => replayMutation.mutate()}
				>
					<IconPlayerPlay className="mr-2 h-4 w-4" />
					{replayMutation.isPending
						? "Persisting fixture evidence…"
						: summary
							? "Replay baseline again"
							: "Run fixture baseline"}
				</Button>
			</CardContent>
		</Card>
	);
}
