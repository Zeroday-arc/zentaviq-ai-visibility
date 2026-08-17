import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDatabase, IconPlayerPlay, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { getLatestReplayBaselineFn, runReplayBaselineFn } from "@/server/replay-audit";

const replayBaselineKey = (brandId: string) => ["replay-baseline", brandId] as const;

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
		onSuccess: (summary) => {
			queryClient.setQueryData(replayBaselineKey(brandId), summary);
		},
	});

	const summary = replayMutation.data ?? replayQuery.data;
	const error = replayMutation.error ?? replayQuery.error;

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
							Persist four bundled evidence scenarios locally. Replay mode performs no provider or external network
							requests.
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
						<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
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
