import { z } from "zod";

export const EVIDENCE_SCHEMA_VERSION = 1 as const;
export const ENTITY_CLASSIFIER_ID = "zentaviq-deterministic-entity-classifier";
export const ENTITY_CLASSIFIER_VERSION = "1.0.0";
export const HEURISTIC_SCORE_DESCRIPTION =
	"Deterministic heuristic rule score from 0 to 1; it is not a probability.";
export const RECOMMENDATION_CLASSIFICATION_STATUS = "deferred" as const;
export const RECOMMENDATION_CLASSIFICATION_DESCRIPTION =
	"Automated recommendation classification is deferred; absence of recommended status is not a verified negative.";
export const MAX_EVIDENCE_EXCERPT_LENGTH = 160;

export const entityStatusSchema = z.enum(["not_mentioned", "mentioned", "recommended"]);
export const entityRoleSchema = z.enum(["brand", "competitor"]);
export const citationPresenceStatusSchema = z.enum(["none", "present"]);
export const urlNormalizationStatusSchema = z.enum(["normalized", "invalid"]);
export const citationVerificationStatusSchema = z.enum([
	"not_attempted",
	"verified",
	"unreachable",
	"failed",
]);
export const citationSupportStatusSchema = z.enum([
	"not_assessed",
	"supports",
	"does_not_support",
	"mixed",
]);
export const matchSourceSchema = z.enum(["name", "alias", "domain"]);
export const matchRejectionReasonSchema = z.enum([
	"ambiguous_without_corroboration",
	"identity_collision",
	"shadowed_by_longer_match",
]);
export const recommendationAssessmentStatusSchema = z.enum([
	"not_detected",
	"accepted",
	"rejected",
]);
export const recommendationRejectionReasonSchema = z.enum([
	"negated",
	"ambiguous",
	"unsupported",
]);

export type EntityStatus = z.infer<typeof entityStatusSchema>;
export type EntityRole = z.infer<typeof entityRoleSchema>;
export type CitationPresenceStatus = z.infer<typeof citationPresenceStatusSchema>;
export type UrlNormalizationStatus = z.infer<typeof urlNormalizationStatusSchema>;
export type CitationVerificationStatus = z.infer<typeof citationVerificationStatusSchema>;
export type CitationSupportStatus = z.infer<typeof citationSupportStatusSchema>;
export type MatchSource = z.infer<typeof matchSourceSchema>;
export type MatchRejectionReason = z.infer<typeof matchRejectionReasonSchema>;
export type RecommendationAssessmentStatus = z.infer<typeof recommendationAssessmentStatusSchema>;
export type RecommendationRejectionReason = z.infer<typeof recommendationRejectionReasonSchema>;

export const entityIdentitySnapshotSchema = z.object({
	id: z.string().min(1),
	role: entityRoleSchema,
	name: z.string(),
	aliases: z.array(z.string()),
	domains: z.array(z.string()),
	contextTerms: z.array(z.string()),
}).strict();

export type EntityIdentitySnapshot = z.infer<typeof entityIdentitySnapshotSchema>;

export interface EntityIdentityInput {
	id: string;
	role: EntityRole;
	name: string;
	aliases?: string[];
	domains?: string[];
	/**
	 * Retained in the versioned identity snapshot for compatibility. V0.1 does
	 * not use context terms to accept generic single-word entity names.
	 */
	contextTerms?: string[];
}

const sourceSpanShape = {
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	excerptStart: z.number().int().nonnegative(),
	excerptEnd: z.number().int().nonnegative(),
	excerpt: z.string().max(MAX_EVIDENCE_EXCERPT_LENGTH),
	matchedText: z.string().min(1),
	matchedTerm: z.string().min(1),
	source: matchSourceSchema,
	rule: z.string().min(1),
	confidence: z.number().min(0).max(1),
};

const recommendationCueShape = {
	rule: z.string().min(1),
	cue: z.string().min(1),
	cueStart: z.number().int().nonnegative(),
	cueEnd: z.number().int().nonnegative(),
};

export const recommendationAssessmentSchema = z
	.discriminatedUnion("status", [
		z.object({ status: z.literal("not_detected"), rule: z.string().min(1) }).strict(),
		z.object({ status: z.literal("accepted"), ...recommendationCueShape }).strict(),
		z
			.object({
				status: z.literal("rejected"),
				...recommendationCueShape,
				rejectionReason: recommendationRejectionReasonSchema,
			})
			.strict(),
	])
	.superRefine((assessment, context) => {
		if (assessment.status !== "not_detected") {
			if (assessment.cueEnd < assessment.cueStart) {
				context.addIssue({ code: "custom", message: "Recommendation cue offsets must be ordered" });
			}
			if (assessment.cueEnd - assessment.cueStart !== assessment.cue.length) {
				context.addIssue({ code: "custom", message: "Recommendation cue offsets must match the cue text length" });
			}
		}
	});

export type RecommendationAssessment = z.infer<typeof recommendationAssessmentSchema>;

function validateSourceSpan(
	span: {
		start: number;
		end: number;
		excerptStart: number;
		excerptEnd: number;
		excerpt: string;
		matchedText: string;
	},
	context: z.RefinementCtx,
): void {
	if (span.end <= span.start || span.excerptEnd < span.excerptStart) {
		context.addIssue({ code: "custom", message: "Evidence offsets must be ordered" });
	}
	if (span.end - span.start !== span.matchedText.length) {
		context.addIssue({ code: "custom", message: "Match offsets must equal the matched text UTF-16 length" });
	}
	if (span.excerptEnd - span.excerptStart !== span.excerpt.length) {
		context.addIssue({ code: "custom", message: "Excerpt offsets must equal the excerpt UTF-16 length" });
	}
	if (span.excerptStart > span.start || span.excerptEnd < span.end) {
		context.addIssue({ code: "custom", message: "Evidence excerpt must fully contain the matched span" });
	}
}

export const acceptedMatchSchema = z
	.object({
		...sourceSpanShape,
		disposition: z.literal("accepted"),
		recommendation: recommendationAssessmentSchema,
	})
	.strict()
	.superRefine(validateSourceSpan);

export const rejectedMatchSchema = z
	.object({
		...sourceSpanShape,
		disposition: z.literal("rejected"),
		rejectionReason: matchRejectionReasonSchema,
	})
	.strict()
	.superRefine(validateSourceSpan);

export type AcceptedMatch = z.infer<typeof acceptedMatchSchema>;
export type RejectedMatch = z.infer<typeof rejectedMatchSchema>;

export const entityClassificationSchema = z
	.object({
		identity: entityIdentitySnapshotSchema,
		status: entityStatusSchema,
		confidence: z.number().min(0).max(1),
		confidenceKind: z.literal("heuristic_rule_score"),
		confidenceDescription: z.literal(HEURISTIC_SCORE_DESCRIPTION),
		acceptedMatches: z.array(acceptedMatchSchema),
		rejectedMatches: z.array(rejectedMatchSchema),
	})
	.strict()
	.superRefine((classification, context) => {
		const hasAccepted = classification.acceptedMatches.length > 0;
		const hasRecommendation = classification.acceptedMatches.some(
			(match) => match.recommendation.status === "accepted",
		);
		if (classification.status === "not_mentioned" && hasAccepted) {
			context.addIssue({ code: "custom", message: "Not-mentioned entities cannot have accepted matches" });
		}
		if (classification.status !== "not_mentioned" && !hasAccepted) {
			context.addIssue({ code: "custom", message: "Mentioned entities require an accepted match" });
		}
		if (classification.status === "recommended" && !hasRecommendation) {
			context.addIssue({ code: "custom", message: "Recommended entities require an accepted recommendation" });
		}
		if (classification.status !== "recommended" && hasRecommendation) {
			context.addIssue({ code: "custom", message: "Accepted recommendations require recommended entity status" });
		}
	});

export type EntityClassification = z.infer<typeof entityClassificationSchema>;

export const runEvidenceV1Schema = z
	.object({
		schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
		classifier: z.object({
			id: z.literal(ENTITY_CLASSIFIER_ID),
			version: z.literal(ENTITY_CLASSIFIER_VERSION),
			confidenceKind: z.literal("heuristic_rule_score"),
			confidenceDescription: z.literal(HEURISTIC_SCORE_DESCRIPTION),
			recommendationClassification: z.literal(RECOMMENDATION_CLASSIFICATION_STATUS),
			recommendationClassificationDescription: z.literal(RECOMMENDATION_CLASSIFICATION_DESCRIPTION),
		}).strict(),
		sourceTextLength: z.number().int().nonnegative(),
		entities: z.array(entityClassificationSchema),
		citations: z.object({
			presence: citationPresenceStatusSchema,
			count: z.number().int().nonnegative(),
		}).strict(),
	})
	.strict()
	.superRefine((evidence, context) => {
		if ((evidence.citations.count === 0) !== (evidence.citations.presence === "none")) {
			context.addIssue({ code: "custom", message: "Citation presence must agree with citation count" });
		}
		const entityIds = new Set<string>();
		for (const [index, entity] of evidence.entities.entries()) {
			if (entityIds.has(entity.identity.id)) {
				context.addIssue({
					code: "custom",
					message: "Evidence entities must have unique stable IDs",
					path: ["entities", index, "identity", "id"],
				});
			}
			entityIds.add(entity.identity.id);
			for (const [collectionName, matches] of [
				["acceptedMatches", entity.acceptedMatches],
				["rejectedMatches", entity.rejectedMatches],
			] as const) {
				for (const [matchIndex, match] of matches.entries()) {
					for (const [field, offset] of [
						["start", match.start],
						["end", match.end],
						["excerptStart", match.excerptStart],
						["excerptEnd", match.excerptEnd],
					] as const) {
						if (offset > evidence.sourceTextLength) {
							context.addIssue({
								code: "custom",
								message: "Evidence offsets must be within sourceTextLength",
								path: ["entities", index, collectionName, matchIndex, field],
							});
						}
					}
					if ("recommendation" in match && match.recommendation.status !== "not_detected") {
						for (const [field, offset] of [
							["cueStart", match.recommendation.cueStart],
							["cueEnd", match.recommendation.cueEnd],
						] as const) {
							if (offset > evidence.sourceTextLength) {
								context.addIssue({
									code: "custom",
									message: "Recommendation cue offsets must be within sourceTextLength",
									path: ["entities", index, collectionName, matchIndex, "recommendation", field],
								});
							}
						}
					}
				}
			}
		}
	});

export type RunEvidenceV1 = z.infer<typeof runEvidenceV1Schema>;

export const normalizedHttpUrlSchema = z
	.object({
		status: z.literal("normalized"),
		originalUrl: z.string(),
		normalizedUrl: z.string().url(),
		normalizedDomain: z.string().min(1),
	})
	.strict()
	.superRefine((result, context) => {
		let parsed: URL;
		try {
			parsed = new URL(result.normalizedUrl);
		} catch {
			return;
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			context.addIssue({ code: "custom", message: "Normalized URLs must use HTTP or HTTPS" });
		}
		if (parsed.username || parsed.password) {
			context.addIssue({ code: "custom", message: "Normalized URLs cannot contain credentials" });
		}
		if (parsed.hash) context.addIssue({ code: "custom", message: "Normalized URLs cannot contain fragments" });
		if (parsed.hostname !== result.normalizedDomain) {
			context.addIssue({ code: "custom", message: "Normalized domain must match the normalized URL hostname" });
		}
		const canonical = normalizeHttpUrl(result.originalUrl);
		if (
			canonical.status !== "normalized" ||
			canonical.normalizedUrl !== result.normalizedUrl ||
			canonical.normalizedDomain !== result.normalizedDomain
		) {
			context.addIssue({ code: "custom", message: "Normalized URL fields must be canonical" });
		}
	});

export const invalidHttpUrlSchema = z
	.object({
		status: z.literal("invalid"),
		originalUrl: z.string(),
		error: z.enum(["empty", "malformed", "unsupported_scheme", "credentials_not_allowed"]),
	})
	.strict()
	.superRefine((result, context) => {
		const canonical = normalizeHttpUrl(result.originalUrl);
		if (canonical.status !== "invalid" || canonical.error !== result.error) {
			context.addIssue({ code: "custom", message: "Invalid URL fields must match canonical normalization" });
		}
	});

export const httpUrlNormalizationResultSchema = z.union([normalizedHttpUrlSchema, invalidHttpUrlSchema]);

export type HttpUrlNormalizationResult = z.infer<typeof httpUrlNormalizationResultSchema>;
export type NormalizedHttpUrl = z.infer<typeof normalizedHttpUrlSchema>;
export type InvalidHttpUrl = z.infer<typeof invalidHttpUrlSchema>;

export const citationClaimSupportSchema = z.object({
	entityId: z.string().min(1),
	claim: z.enum(["mention", "recommendation"]),
	status: z.enum(["supports", "does_not_support"]),
	confidence: z.number().min(0).max(1),
	confidenceKind: z.literal("heuristic_rule_score"),
	evidenceExcerpt: z.string().max(MAX_EVIDENCE_EXCERPT_LENGTH).optional(),
}).strict();

export type CitationClaimSupport = z.infer<typeof citationClaimSupportSchema>;

const httpUrlStringSchema = z.string().url().superRefine((value, context) => {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		context.addIssue({ code: "custom", message: "Citation URLs must use HTTP or HTTPS" });
	}
	if (parsed.username || parsed.password) {
		context.addIssue({ code: "custom", message: "Citation URLs cannot contain credentials" });
	}
});

const verificationAttemptShape = {
	attemptedAt: z.string().datetime().optional(),
	finalUrl: httpUrlStringSchema.optional(),
	httpStatus: z.number().int().min(100).max(599).optional(),
};

const citationVerificationSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("not_attempted") }).strict(),
	z
		.object({
			status: z.literal("verified"),
			...verificationAttemptShape,
			contentHash: z.string().min(1).optional(),
			contentExcerpt: z.string().max(MAX_EVIDENCE_EXCERPT_LENGTH).optional(),
		})
		.strict(),
	z
		.object({
			status: z.literal("unreachable"),
			...verificationAttemptShape,
			errorCode: z.string().min(1).optional(),
		})
		.strict(),
	z
		.object({
			status: z.literal("failed"),
			...verificationAttemptShape,
			errorCode: z.string().min(1).optional(),
		})
		.strict(),
]);

const citationSupportSchema = z
	.discriminatedUnion("status", [
		z.object({ status: z.literal("not_assessed"), claims: z.array(citationClaimSupportSchema).length(0) }).strict(),
		z.object({ status: z.literal("supports"), claims: z.array(citationClaimSupportSchema).min(1) }).strict(),
		z.object({ status: z.literal("does_not_support"), claims: z.array(citationClaimSupportSchema).min(1) }).strict(),
		z.object({ status: z.literal("mixed"), claims: z.array(citationClaimSupportSchema).min(2) }).strict(),
	])
	.superRefine((support, context) => {
		const statuses = new Set(support.claims.map((claim) => claim.status));
		if (support.status === "supports" && statuses.has("does_not_support")) {
			context.addIssue({ code: "custom", message: "Supports evidence cannot contain unsupported claims" });
		}
		if (support.status === "does_not_support" && statuses.has("supports")) {
			context.addIssue({ code: "custom", message: "Unsupported evidence cannot contain supporting claims" });
		}
		if (support.status === "mixed" && !(statuses.has("supports") && statuses.has("does_not_support"))) {
			context.addIssue({ code: "custom", message: "Mixed evidence must contain both claim outcomes" });
		}
	});

export const citationEvidenceV1Schema = z
	.object({
		schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
		presence: z.literal("present"),
		url: httpUrlNormalizationResultSchema,
		verification: citationVerificationSchema,
		support: citationSupportSchema,
	})
	.strict()
	.superRefine((citation, context) => {
		if (citation.verification.status === "verified" && citation.url.status === "invalid") {
			context.addIssue({ code: "custom", message: "Invalid URLs cannot be verified", path: ["verification"] });
		}
		if (citation.verification.status !== "verified" && citation.support.status !== "not_assessed") {
			context.addIssue({
				code: "custom",
				message: "Unverified citations cannot contain assessed support",
				path: ["support"],
			});
		}
	});

export type CitationEvidenceV1 = z.infer<typeof citationEvidenceV1Schema>;

export function normalizeHttpUrl(originalUrl: string): HttpUrlNormalizationResult {
	const candidate = originalUrl.trim();
	if (!candidate) return { status: "invalid", originalUrl, error: "empty" };

	let parsed: URL;
	try {
		parsed = new URL(candidate);
	} catch {
		return { status: "invalid", originalUrl, error: "malformed" };
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { status: "invalid", originalUrl, error: "unsupported_scheme" };
	}
	if (parsed.username || parsed.password) {
		return { status: "invalid", originalUrl, error: "credentials_not_allowed" };
	}

	parsed.hash = "";
	parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
	if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
		parsed.port = "";
	}

	return {
		status: "normalized",
		originalUrl,
		normalizedUrl: parsed.toString(),
		normalizedDomain: parsed.hostname,
	};
}

export function createUnverifiedCitationEvidence(originalUrl: string): CitationEvidenceV1 {
	return {
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		presence: "present",
		url: normalizeHttpUrl(originalUrl),
		verification: { status: "not_attempted" },
		support: { status: "not_assessed", claims: [] },
	};
}

interface NormalizedText {
	value: string;
	starts: number[];
	ends: number[];
}

interface CandidateMatch {
	entityIndex: number;
	entityId: string;
	source: MatchSource;
	matchedTerm: string;
	identityKey: string;
	start: number;
	end: number;
	matchedText: string;
	rule: string;
	confidence: number;
	generic: boolean;
	identityLength: number;
	domainRelationship?: "exact" | "subdomain";
}

const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const GENERIC_WORD = /^[\p{L}\p{M}]+$/u;

function normalizeForMatching(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
}

function buildNormalizedText(content: string): NormalizedText {
	let fallbackIndex = 0;
	const segments = typeof Intl.Segmenter === "function"
		? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(content)].map((part) => ({
			segment: part.segment,
			index: part.index,
		}))
		: [...content].map((segment) => {
			const index = fallbackIndex;
			fallbackIndex += segment.length;
			return { segment, index };
		});

	const mappedSegments = segments.map((part) => ({
		start: part.index,
		end: part.index + part.segment.length,
		normalized: part.segment.normalize("NFKC"),
	}));
	const nfkcValue = mappedSegments.map((part) => part.normalized).join("");
	if (nfkcValue !== content.normalize("NFKC")) {
		throw new Error("Unable to map Unicode normalization to exact source offsets");
	}

	const lowerValue = nfkcValue.toLocaleLowerCase("en");
	const lowerStarts: number[] = [];
	const lowerEnds: number[] = [];
	let lowerOffset = 0;
	for (const part of mappedSegments) {
		const lowerLength = part.normalized.toLocaleLowerCase("en").length;
		for (let unit = 0; unit < lowerLength; unit++) {
			lowerStarts.push(part.start);
			lowerEnds.push(part.end);
		}
		lowerOffset += lowerLength;
	}
	if (lowerOffset !== lowerValue.length) {
		throw new Error("Unable to map Unicode case normalization to exact source offsets");
	}

	let value = "";
	const starts: number[] = [];
	const ends: number[] = [];
	let pendingWhitespace: { start: number; end: number } | null = null;
	for (let offset = 0; offset < lowerValue.length; ) {
		const character = codePointAt(lowerValue, offset);
		const characterEnd = offset + character.length;
		const start = lowerStarts[offset];
		const end = lowerEnds[characterEnd - 1];
		if (/^\s+$/u.test(character)) {
			pendingWhitespace = pendingWhitespace
				? { start: pendingWhitespace.start, end }
				: { start, end };
		} else {
			if (pendingWhitespace && value.length > 0) {
				value += " ";
				starts.push(pendingWhitespace.start);
				ends.push(pendingWhitespace.end);
			}
			pendingWhitespace = null;
			value += character;
			for (let unit = 0; unit < character.length; unit++) {
				starts.push(start);
				ends.push(end);
			}
		}
		offset = characterEnd;
	}

	return { value, starts, ends };
}

function codePointBefore(value: string, index: number): string {
	if (index <= 0) return "";
	const lastUnit = value.charCodeAt(index - 1);
	if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && index >= 2) return value.slice(index - 2, index);
	return value.slice(index - 1, index);
}

function codePointAt(value: string, index: number): string {
	if (index >= value.length) return "";
	const firstUnit = value.charCodeAt(index);
	if (firstUnit >= 0xd800 && firstUnit <= 0xdbff) return value.slice(index, index + 2);
	return value.slice(index, index + 1);
}

function isBoundary(value: string, start: number, end: number, term: string): boolean {
	const termCodePoints = [...term];
	const termStartsWithWord = WORD_CHARACTER.test(termCodePoints[0] ?? "");
	const termEndsWithWord = WORD_CHARACTER.test(termCodePoints.at(-1) ?? "");
	const before = codePointBefore(value, start);
	const after = codePointAt(value, end);
	return (!termStartsWithWord || !WORD_CHARACTER.test(before)) && (!termEndsWithWord || !WORD_CHARACTER.test(after));
}

function findTermMatches(content: string, normalizedContent: NormalizedText, term: string): Array<{ start: number; end: number; matchedText: string }> {
	const normalizedTerm = normalizeForMatching(term);
	if (!normalizedTerm) return [];

	const matches: Array<{ start: number; end: number; matchedText: string }> = [];
	let searchFrom = 0;
	while (searchFrom <= normalizedContent.value.length - normalizedTerm.length) {
		const normalizedStart = normalizedContent.value.indexOf(normalizedTerm, searchFrom);
		if (normalizedStart === -1) break;
		const normalizedEnd = normalizedStart + normalizedTerm.length;
		if (isBoundary(normalizedContent.value, normalizedStart, normalizedEnd, normalizedTerm)) {
			const start = normalizedContent.starts[normalizedStart];
			const end = normalizedContent.ends[normalizedEnd - 1];
			if (start !== undefined && end !== undefined) {
				matches.push({ start, end, matchedText: content.slice(start, end) });
			}
		}
		searchFrom = normalizedStart + Math.max(1, normalizedTerm.length);
	}
	return matches;
}

function normalizeHostname(hostname: string): string | null {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	if (!normalized.includes(".")) return null;
	const labels = normalized.split(".");
	if (
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > 63 ||
				label.startsWith("-") ||
				label.endsWith("-") ||
				!/^[a-z0-9-]+$/u.test(label),
		)
	) {
		return null;
	}
	return normalized.replace(/^www\./u, "");
}

function canonicalDomain(value: string): string | null {
	const candidate = value.trim();
	if (!candidate) return null;
	try {
		const parsed = new URL(/^https?:\/\//iu.test(candidate) ? candidate : `https://${candidate}`);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		if (parsed.username || parsed.password) return null;
		return normalizeHostname(parsed.hostname);
	} catch {
		return null;
	}
}

interface HostnameSpan {
	host: string;
	start: number;
	end: number;
	matchedText: string;
}

interface SourceSpan {
	start: number;
	end: number;
}

interface MachineSpanScan {
	hostnames: HostnameSpan[];
	excluded: SourceSpan[];
}

const HOSTNAME_START_CHARACTER = /[\p{L}\p{N}]/u;
const HOSTNAME_CHARACTER = /[\p{L}\p{N}.-]/u;

function isMachineTokenBoundary(character: string): boolean {
	return !character || /[\s\p{Cc}]/u.test(character);
}

function codePointLengthAt(value: string, index: number): number {
	return codePointAt(value, index).length;
}

function mergeSpans(spans: SourceSpan[]): SourceSpan[] {
	const ordered = [...spans].filter((span) => span.end > span.start).sort((left, right) => left.start - right.start);
	const merged: SourceSpan[] = [];
	for (const span of ordered) {
		const previous = merged.at(-1);
		if (previous && span.start <= previous.end) {
			previous.end = Math.max(previous.end, span.end);
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

function overlapsSortedSpan(spans: SourceSpan[], target: SourceSpan): boolean {
	let low = 0;
	let high = spans.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (spans[middle].end <= target.start) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return Boolean(spans[low] && spans[low].start < target.end);
}

function containingSortedSpan(spans: SourceSpan[], offset: number): SourceSpan | undefined {
	let low = 0;
	let high = spans.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (spans[middle].end <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	const span = spans[low];
	return span && span.start <= offset ? span : undefined;
}

function authorityHost(authority: string): string | null {
	if (!authority || authority.includes("@") || authority.startsWith("[")) return null;
	const colon = authority.lastIndexOf(":");
	if (colon === -1) return authority;
	const port = authority.slice(colon + 1);
	if (!/^\d+$/u.test(port)) return null;
	return authority.slice(0, colon);
}

function httpHostnameSpan(token: { value: string; start: number }): HostnameSpan | null {
	let parsed: URL;
	try {
		parsed = new URL(token.value);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	if (parsed.username || parsed.password) return null;
	const authorityStart = token.value.indexOf("://") + 3;
	if (authorityStart < 3) return null;
	const authorityEndOffset = token.value.slice(authorityStart).search(/[/?#]/u);
	const authorityEnd = authorityEndOffset === -1 ? token.value.length : authorityStart + authorityEndOffset;
	const rawHost = authorityHost(token.value.slice(authorityStart, authorityEnd));
	const host = normalizeHostname(parsed.hostname);
	if (!rawHost || !host) return null;
	const start = token.start + authorityStart;
	const end = start + rawHost.length;
	return { host, start, end, matchedText: rawHost };
}

function schemeStartBefore(content: string, marker: number): number | null {
	let start = marker;
	while (start > 0 && /[A-Za-z0-9+.-]/u.test(content[start - 1])) start--;
	const scheme = content.slice(start, marker);
	return /^[A-Za-z][A-Za-z0-9+.-]*$/u.test(scheme) ? start : null;
}

function machineTokenEnd(content: string, start: number): number {
	let end = start;
	while (end < content.length && !isMachineTokenBoundary(codePointAt(content, end))) {
		end += codePointLengthAt(content, end);
	}
	return end;
}

function trimUrlEnd(content: string, start: number, end: number): number {
	while (end > start && /[.!?]/u.test(content[end - 1])) end--;
	return end;
}

function markdownDestinationHostnameSpan(content: string, span: SourceSpan): HostnameSpan | null {
	let start = span.start;
	let end = span.end;
	while (start < end && /\s/u.test(codePointAt(content, start))) start += codePointLengthAt(content, start);
	while (end > start && /\s/u.test(content[end - 1])) end--;
	if (content[start] === "<" && content[end - 1] === ">") {
		start++;
		end--;
	}
	if (start >= end) return null;
	const value = content.slice(start, end);
	if (/^https?:\/\//iu.test(value)) return httpHostnameSpan({ value, start });
	if (value.includes("://") || value.includes("@")) return null;

	let hostEnd = start;
	while (hostEnd < end && HOSTNAME_CHARACTER.test(codePointAt(content, hostEnd))) {
		hostEnd += codePointLengthAt(content, hostEnd);
	}
	while (hostEnd > start && content[hostEnd - 1] === ".") hostEnd--;
	const rawHost = content.slice(start, hostEnd);
	if (!rawHost.includes(".")) return null;
	let authorityEnd = hostEnd;
	if (content[authorityEnd] === ":") {
		let portEnd = authorityEnd + 1;
		while (portEnd < end && /\d/u.test(content[portEnd])) portEnd++;
		if (portEnd === authorityEnd + 1) return null;
		authorityEnd = portEnd;
	}
	if (authorityEnd < end && !/[/?#]/u.test(content[authorityEnd])) return null;
	try {
		const parsed = new URL(`https://${content.slice(start, authorityEnd)}`);
		const host = normalizeHostname(parsed.hostname);
		return host ? { host, start, end: hostEnd, matchedText: rawHost } : null;
	} catch {
		return null;
	}
}

function markdownMachineSpans(content: string): MachineSpanScan {
	const hostnames: HostnameSpan[] = [];
	const excluded: SourceSpan[] = [];
	let labelStart: number | null = null;
	let offset = 0;
	while (offset < content.length) {
		const character = content[offset];
		if (character === "\\") {
			offset += Math.min(2, content.length - offset);
			continue;
		}
		if (character === "[") labelStart = offset;
		if (character !== "]" || labelStart === null || content[offset + 1] !== "(") {
			offset += codePointLengthAt(content, offset);
			continue;
		}

		const destinationStart = offset + 2;
		let cursor = destinationStart;
		let depth = 1;
		while (cursor < content.length) {
			const destinationCharacter = content[cursor];
			if (destinationCharacter === "\\") {
				cursor += Math.min(2, content.length - cursor);
				continue;
			}
			if (destinationCharacter === "(") depth++;
			if (destinationCharacter === ")") {
				depth--;
				if (depth === 0) break;
			}
			cursor += codePointLengthAt(content, cursor);
		}
		if (depth !== 0) {
			break;
		}

		const destination = { start: destinationStart, end: cursor };
		if (destination.end > destination.start) {
			excluded.push(destination);
			const hostname = markdownDestinationHostnameSpan(content, destination);
			if (hostname) hostnames.push(hostname);
		}
		labelStart = null;
		offset = cursor + 1;
	}
	return { hostnames, excluded };
}

function urlMachineSpans(content: string, preExcluded: SourceSpan[]): MachineSpanScan {
	const hostnames: HostnameSpan[] = [];
	const excluded: SourceSpan[] = [];
	let searchFrom = 0;
	while (searchFrom < content.length) {
		const marker = content.indexOf("://", searchFrom);
		if (marker === -1) break;
		const containing = containingSortedSpan(preExcluded, marker);
		if (containing) {
			searchFrom = containing.end;
			continue;
		}
		const start = schemeStartBefore(content, marker);
		if (start === null) {
			searchFrom = marker + 3;
			continue;
		}
		const end = machineTokenEnd(content, marker + 3);
		excluded.push({ start, end });
		const scheme = content.slice(start, marker).toLowerCase();
		if (scheme === "http" || scheme === "https") {
			const parsedEnd = trimUrlEnd(content, start, end);
			const hostname = httpHostnameSpan({ value: content.slice(start, parsedEnd), start });
			if (hostname) hostnames.push(hostname);
		}
		searchFrom = Math.max(end, marker + 3);
	}
	return { hostnames, excluded };
}

function emailAndUserinfoSpans(content: string, preExcluded: SourceSpan[]): SourceSpan[] {
	const spans: SourceSpan[] = [];
	let offset = 0;
	let exclusionIndex = 0;
	while (offset < content.length) {
		while (preExcluded[exclusionIndex] && preExcluded[exclusionIndex].end <= offset) exclusionIndex++;
		const containing = preExcluded[exclusionIndex];
		if (containing && offset >= containing.start && offset < containing.end) {
			offset = containing.end;
			continue;
		}
		if (isMachineTokenBoundary(codePointAt(content, offset))) {
			offset += codePointLengthAt(content, offset);
			continue;
		}
		const start = offset;
		let containsAt = false;
		while (
			offset < content.length &&
			!isMachineTokenBoundary(codePointAt(content, offset)) &&
			(!containing || offset < containing.start)
		) {
			if (content[offset] === "@") containsAt = true;
			offset += codePointLengthAt(content, offset);
		}
		if (containsAt) spans.push({ start, end: offset });
	}
	return spans;
}

function bareHostnameSpans(content: string, preExcluded: SourceSpan[]): MachineSpanScan {
	const hostnames: HostnameSpan[] = [];
	const excluded: SourceSpan[] = [];
	let offset = 0;
	let exclusionIndex = 0;
	while (offset < content.length) {
		while (preExcluded[exclusionIndex] && preExcluded[exclusionIndex].end <= offset) exclusionIndex++;
		const containing = preExcluded[exclusionIndex];
		if (containing && offset >= containing.start && offset < containing.end) {
			offset = containing.end;
			continue;
		}
		const first = codePointAt(content, offset);
		if (!HOSTNAME_START_CHARACTER.test(first)) {
			offset += first.length;
			continue;
		}
		const start = offset;
		while (offset < content.length && HOSTNAME_CHARACTER.test(codePointAt(content, offset))) {
			offset += codePointLengthAt(content, offset);
		}
		let hostEnd = offset;
		while (hostEnd > start && content[hostEnd - 1] === ".") hostEnd--;
		const rawHost = content.slice(start, hostEnd);
		if (!rawHost.includes(".")) continue;

		let authorityEnd = hostEnd;
		let validPort = true;
		if (content[authorityEnd] === ":") {
			let portEnd = authorityEnd + 1;
			while (portEnd < content.length && /\d/u.test(content[portEnd])) portEnd++;
			validPort = portEnd > authorityEnd + 1;
			authorityEnd = validPort ? portEnd : authorityEnd;
		}
		const machineEnd = machineTokenEnd(content, authorityEnd);
		excluded.push({ start, end: Math.max(machineEnd, hostEnd) });
		if (!validPort) {
			offset = Math.max(offset, machineEnd);
			continue;
		}

		const authority = content.slice(start, authorityEnd);
		let parsed: URL;
		try {
			parsed = new URL(`https://${authority}`);
		} catch {
			offset = Math.max(offset, machineEnd);
			continue;
		}
		const host = normalizeHostname(parsed.hostname);
		if (host) hostnames.push({ host, start, end: hostEnd, matchedText: rawHost });
		offset = Math.max(offset, machineEnd);
	}
	return { hostnames, excluded };
}

function scanMachineSpans(content: string): MachineSpanScan {
	const markdown = markdownMachineSpans(content);
	const markdownExcluded = mergeSpans(markdown.excluded);
	const urls = urlMachineSpans(content, markdownExcluded);
	const urlExcluded = mergeSpans([...markdownExcluded, ...urls.excluded]);
	const emailAndUserinfo = emailAndUserinfoSpans(content, urlExcluded);
	const initialExcluded = mergeSpans([...urlExcluded, ...emailAndUserinfo]);
	const bare = bareHostnameSpans(content, initialExcluded);
	return {
		hostnames: [...markdown.hostnames, ...urls.hostnames, ...bare.hostnames].sort(
			(left, right) => left.start - right.start,
		),
		excluded: mergeSpans([...initialExcluded, ...bare.excluded]),
	};
}

function isShortGenericEntityTerm(term: string): boolean {
	const normalized = normalizeForMatching(term);
	return !normalized.includes(" ") && GENERIC_WORD.test(normalized) && [...normalized].length <= 5;
}

function excerptFor(content: string, start: number, end: number): Pick<AcceptedMatch, "excerptStart" | "excerptEnd" | "excerpt"> {
	const surrounding = Math.max(0, Math.floor((MAX_EVIDENCE_EXCERPT_LENGTH - (end - start)) / 2));
	let excerptStart = Math.max(0, start - surrounding);
	let excerptEnd = Math.min(content.length, end + surrounding);
	if (excerptEnd - excerptStart > MAX_EVIDENCE_EXCERPT_LENGTH) {
		excerptEnd = excerptStart + MAX_EVIDENCE_EXCERPT_LENGTH;
	}
	if (excerptStart > 0 && /[\uDC00-\uDFFF]/u.test(content[excerptStart])) excerptStart++;
	if (excerptEnd < content.length && /[\uDC00-\uDFFF]/u.test(content[excerptEnd])) excerptEnd--;
	return { excerptStart, excerptEnd, excerpt: content.slice(excerptStart, excerptEnd) };
}

function snapshotIdentity(input: EntityIdentityInput): EntityIdentitySnapshot {
	return entityIdentitySnapshotSchema.parse({
		id: input.id,
		role: input.role,
		name: input.name,
		aliases: [...(input.aliases ?? [])],
		domains: [...(input.domains ?? [])],
		contextTerms: [...(input.contextTerms ?? [])],
	});
}

function collectCandidates(
	content: string,
	identities: EntityIdentitySnapshot[],
	normalizedContent: NormalizedText,
	hostSpans: HostnameSpan[],
	excludedMachineSpans: SourceSpan[],
): CandidateMatch[] {
	const candidates: CandidateMatch[] = [];

	identities.forEach((identity, entityIndex) => {
		const terms = new Map<string, { term: string; source: MatchSource }>();
		for (const [term, source] of [
			[identity.name, "name"],
			...identity.aliases.map((alias) => [alias, "alias"]),
		] as Array<[string, MatchSource]>) {
			const normalized = normalizeForMatching(term);
			if (!normalized || terms.has(normalized)) continue;
			terms.set(normalized, { term: term.trim(), source });
		}

		for (const [normalizedTerm, term] of terms) {
			for (const match of findTermMatches(content, normalizedContent, term.term)) {
				if (overlapsSortedSpan(excludedMachineSpans, match)) continue;
				const generic = isShortGenericEntityTerm(term.term);
				candidates.push({
					entityIndex,
					entityId: identity.id,
					source: term.source,
					matchedTerm: term.term,
					identityKey: `term:${normalizedTerm}`,
					...match,
					rule: generic ? "short_generic_identity_term" : "unicode_bounded_identity_term",
					confidence: generic ? 0.45 : term.source === "name" ? 0.92 : 0.9,
					generic,
					identityLength: [...normalizedTerm].length,
				});
			}
		}

		const domains = new Set(identity.domains.map(canonicalDomain).filter((domain): domain is string => Boolean(domain)));
		for (const domain of domains) {
			for (const span of hostSpans) {
				if (span.host !== domain && !span.host.endsWith(`.${domain}`)) continue;
				const domainRelationship = span.host === domain ? "exact" : "subdomain";
				candidates.push({
					entityIndex,
					entityId: identity.id,
					source: "domain",
					matchedTerm: domain,
					identityKey: `domain:${domain}`,
					...span,
					rule: domainRelationship === "exact" ? "owned_domain_exact" : "owned_domain_subdomain",
					confidence: 0.99,
					generic: false,
					identityLength: domain.length,
					domainRelationship,
				});
			}
		}
	});

	return candidates;
}

function candidateToRejected(content: string, candidate: CandidateMatch, reason: MatchRejectionReason, rule = candidate.rule): RejectedMatch {
	return {
		disposition: "rejected",
		start: candidate.start,
		end: candidate.end,
		...excerptFor(content, candidate.start, candidate.end),
		matchedText: candidate.matchedText,
		matchedTerm: candidate.matchedTerm,
		source: candidate.source,
		rule,
		confidence: candidate.confidence,
		rejectionReason: reason,
	};
}

class SpanOccupancyIndex {
	private readonly coordinateIndexes: Map<number, number>;
	private readonly any: Uint8Array;
	private readonly full: Uint8Array;
	private readonly segmentCount: number;

	constructor(candidates: CandidateMatch[]) {
		const coordinates = [...new Set(candidates.flatMap((candidate) => [candidate.start, candidate.end]))].sort(
			(left, right) => left - right,
		);
		this.coordinateIndexes = new Map(coordinates.map((coordinate, index) => [coordinate, index]));
		this.segmentCount = Math.max(0, coordinates.length - 1);
		const treeSize = Math.max(1, this.segmentCount * 4);
		this.any = new Uint8Array(treeSize);
		this.full = new Uint8Array(treeSize);
	}

	add(candidate: CandidateMatch): void {
		const range = this.range(candidate);
		if (range) this.setRange(1, 0, this.segmentCount - 1, range.start, range.end);
	}

	overlaps(candidate: CandidateMatch): boolean {
		const range = this.range(candidate);
		return range ? this.hasAny(1, 0, this.segmentCount - 1, range.start, range.end) : false;
	}

	private range(candidate: CandidateMatch): { start: number; end: number } | null {
		if (this.segmentCount === 0) return null;
		const start = this.coordinateIndexes.get(candidate.start);
		const endBoundary = this.coordinateIndexes.get(candidate.end);
		return start === undefined || endBoundary === undefined || endBoundary <= start
			? null
			: { start, end: endBoundary - 1 };
	}

	private setRange(node: number, left: number, right: number, start: number, end: number): void {
		if (end < left || right < start || this.full[node] === 1) return;
		if (start <= left && right <= end) {
			this.any[node] = 1;
			this.full[node] = 1;
			return;
		}
		const middle = Math.floor((left + right) / 2);
		this.setRange(node * 2, left, middle, start, end);
		this.setRange(node * 2 + 1, middle + 1, right, start, end);
		this.any[node] = this.any[node * 2] | this.any[node * 2 + 1];
		this.full[node] = this.full[node * 2] & this.full[node * 2 + 1];
	}

	private hasAny(node: number, left: number, right: number, start: number, end: number): boolean {
		if (end < left || right < start || this.any[node] === 0) return false;
		if (this.full[node] === 1 || (start <= left && right <= end)) return true;
		const middle = Math.floor((left + right) / 2);
		return (
			this.hasAny(node * 2, left, middle, start, end) ||
			this.hasAny(node * 2 + 1, middle + 1, right, start, end)
		);
	}
}

export interface ClassifyEntitiesInput {
	content: string;
	entities: EntityIdentityInput[];
	citationCount?: number;
}

/**
 * Deterministically classify brand and competitor evidence in one response.
 * Confidence values are documented heuristic rule scores, never probabilities.
 */
export function classifyEntities(input: ClassifyEntitiesInput): RunEvidenceV1 {
	const entityIds = new Set<string>();
	for (const entity of input.entities) {
		if (entityIds.has(entity.id)) throw new Error(`Duplicate stable entity ID: ${entity.id}`);
		entityIds.add(entity.id);
	}
	const identities = input.entities.map(snapshotIdentity);
	const normalizedContent = buildNormalizedText(input.content);
	const machineSpans = scanMachineSpans(input.content);
	const candidates = collectCandidates(
		input.content,
		identities,
		normalizedContent,
		machineSpans.hostnames,
		machineSpans.excluded,
	);
	const identityOwners = new Map<string, Set<string>>();
	for (const candidate of candidates) {
		const owners = identityOwners.get(candidate.identityKey) ?? new Set<string>();
		owners.add(candidate.entityId);
		identityOwners.set(candidate.identityKey, owners);
	}

	const acceptedCandidates = new Set<CandidateMatch>();
	const rejectedByCandidate = new Map<CandidateMatch, { reason: MatchRejectionReason; rule?: string }>();

	for (const candidate of candidates) {
		if ((identityOwners.get(candidate.identityKey)?.size ?? 0) > 1) {
			rejectedByCandidate.set(candidate, { reason: "identity_collision", rule: "shared_identity_term_collision" });
		}
	}
	const collisionCandidates = candidates.filter(
		(candidate) => rejectedByCandidate.get(candidate)?.reason === "identity_collision",
	);
	if (collisionCandidates.length > 0) {
		const collisionIndex = new SpanOccupancyIndex(candidates);
		const orderedCollisions = [...collisionCandidates].sort(
			(left, right) => right.identityLength - left.identityLength,
		);
		const nonCollisions = candidates
			.filter((candidate) => !rejectedByCandidate.has(candidate))
			.sort((left, right) => right.identityLength - left.identityLength);
		let collisionIndexCursor = 0;
		for (const candidate of nonCollisions) {
			while (
				orderedCollisions[collisionIndexCursor] &&
				orderedCollisions[collisionIndexCursor].identityLength >= candidate.identityLength
			) {
				collisionIndex.add(orderedCollisions[collisionIndexCursor]);
				collisionIndexCursor++;
			}
			if (!collisionIndex.overlaps(candidate)) continue;
			rejectedByCandidate.set(candidate, {
				reason: "identity_collision",
				rule: "overlap_with_shared_identity_collision",
			});
		}
	}

	const eligible = candidates
		.filter((candidate) => !rejectedByCandidate.has(candidate))
		.sort((left, right) => {
			if (left.source === "domain" && right.source === "domain") {
				const relationshipDifference =
					(right.domainRelationship === "exact" ? 1 : 0) - (left.domainRelationship === "exact" ? 1 : 0);
				if (relationshipDifference !== 0) return relationshipDifference;
				if (left.identityLength !== right.identityLength) return right.identityLength - left.identityLength;
			}
			const lengthDifference = right.end - right.start - (left.end - left.start);
			if (lengthDifference !== 0) return lengthDifference;
			if (left.identityLength !== right.identityLength) return right.identityLength - left.identityLength;
			if (left.start !== right.start) return left.start - right.start;
			if (left.source === "domain" && right.source !== "domain") return -1;
			if (right.source === "domain" && left.source !== "domain") return 1;
			return left.entityId.localeCompare(right.entityId);
		});

	const acceptedIndex = new SpanOccupancyIndex(candidates);
	for (const candidate of eligible) {
		if (acceptedIndex.overlaps(candidate)) {
			rejectedByCandidate.set(candidate, {
				reason: "shadowed_by_longer_match",
				rule: "overlap_resolved_to_longest_identity_term",
			});
			continue;
		}
		acceptedCandidates.add(candidate);
		acceptedIndex.add(candidate);
	}

	for (const candidate of [...acceptedCandidates]) {
		if (!candidate.generic) continue;
		acceptedCandidates.delete(candidate);
		rejectedByCandidate.set(candidate, {
			reason: "ambiguous_without_corroboration",
			rule: "short_generic_entity_requires_distinctive_identity_evidence",
		});
	}

	const orderedAcceptedCandidates = [...acceptedCandidates].sort((left, right) => left.start - right.start);
	const acceptedByEntity = identities.map((): AcceptedMatch[] => []);
	for (const candidate of orderedAcceptedCandidates) {
		acceptedByEntity[candidate.entityIndex].push({
			disposition: "accepted",
			start: candidate.start,
			end: candidate.end,
			...excerptFor(input.content, candidate.start, candidate.end),
			matchedText: candidate.matchedText,
			matchedTerm: candidate.matchedTerm,
			source: candidate.source,
			rule: candidate.rule,
			confidence: candidate.confidence,
			recommendation: {
				status: "not_detected",
				rule: "automated_recommendation_classification_deferred",
			},
		});
	}
	const rejectedByEntity = identities.map((): RejectedMatch[] => []);
	for (const [candidate, rejection] of [...rejectedByCandidate.entries()].sort(
		([left], [right]) => left.start - right.start,
	)) {
		rejectedByEntity[candidate.entityIndex].push(
			candidateToRejected(input.content, candidate, rejection.reason, rejection.rule),
		);
	}

	const entities: EntityClassification[] = identities.map((identity, entityIndex) => {
		const acceptedMatches = acceptedByEntity[entityIndex];
		const rejectedMatches = rejectedByEntity[entityIndex];
		const status: EntityStatus = acceptedMatches.length === 0 ? "not_mentioned" : "mentioned";
		const strongestAccepted = Math.max(0, ...acceptedMatches.map((match) => match.confidence));
		const strongestRejected = Math.max(0, ...rejectedMatches.map((match) => match.confidence));
		const confidence = acceptedMatches.length > 0 ? strongestAccepted : rejectedMatches.length > 0 ? 1 - strongestRejected : 1;

		return {
			identity,
			status,
			confidence: Math.round(confidence * 100) / 100,
			confidenceKind: "heuristic_rule_score",
			confidenceDescription: HEURISTIC_SCORE_DESCRIPTION,
			acceptedMatches,
			rejectedMatches,
		};
	});

	const requestedCitationCount = input.citationCount ?? 0;
	const citationCount = Number.isFinite(requestedCitationCount)
		? Math.max(0, Math.trunc(requestedCitationCount))
		: 0;
	return {
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		classifier: {
			id: ENTITY_CLASSIFIER_ID,
			version: ENTITY_CLASSIFIER_VERSION,
			confidenceKind: "heuristic_rule_score",
			confidenceDescription: HEURISTIC_SCORE_DESCRIPTION,
			recommendationClassification: RECOMMENDATION_CLASSIFICATION_STATUS,
			recommendationClassificationDescription: RECOMMENDATION_CLASSIFICATION_DESCRIPTION,
		},
		sourceTextLength: input.content.length,
		entities,
		citations: { presence: citationCount > 0 ? "present" : "none", count: citationCount },
	};
}
