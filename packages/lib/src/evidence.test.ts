import { describe, expect, it } from "vitest";
import {
	acceptedMatchSchema,
	citationEvidenceV1Schema,
	classifyEntities,
	createUnverifiedCitationEvidence,
	entityClassificationSchema,
	httpUrlNormalizationResultSchema,
	normalizeHttpUrl,
	normalizedHttpUrlSchema,
	RECOMMENDATION_CLASSIFICATION_DESCRIPTION,
	RECOMMENDATION_CLASSIFICATION_STATUS,
	recommendationAssessmentSchema,
	rejectedMatchSchema,
	runEvidenceV1Schema,
	type EntityClassification,
	type EntityIdentityInput,
} from "./evidence";

const mint: EntityIdentityInput = {
	id: "brand-mint-accountants",
	role: "brand",
	name: "Mint",
	aliases: ["Mint Accountants", ""],
	domains: ["mintaccountants.com.au", ""],
	contextTerms: ["accounting", "accountants", "tax"],
};

const nucleus: EntityIdentityInput = {
	id: "competitor-nucleus-accounting",
	role: "competitor",
	name: "Nucleus Accounting",
	aliases: [],
	domains: ["nucleusaccounting.com.au"],
};

function classify(content: string, entities: EntityIdentityInput[] = [mint, nucleus]) {
	return classifyEntities({ content, entities });
}

function entity(result: ReturnType<typeof classify>, id: string): EntityClassification {
	const found = result.entities.find((item) => item.identity.id === id);
	if (!found) throw new Error(`Missing classification for ${id}`);
	return found;
}

function analystRecommendedFixture() {
	const content = "Analyst confirms Mint Accountants.";
	const automated = classify(content);
	const brandIndex = automated.entities.findIndex((classified) => classified.identity.id === mint.id);
	const automatedEntity = automated.entities[brandIndex];
	const automatedMatch = automatedEntity.acceptedMatches[0];
	const cue = "confirms";
	const cueStart = content.indexOf(cue);
	const recommendedEntity: EntityClassification = {
		...automatedEntity,
		status: "recommended",
		acceptedMatches: [
			{
				...automatedMatch,
				recommendation: {
					status: "accepted",
					rule: "analyst_confirmed_recommendation",
					cue,
					cueStart,
					cueEnd: cueStart + cue.length,
				},
			},
		],
	};
	return {
		content,
		brandIndex,
		match: recommendedEntity.acceptedMatches[0],
		recommendedEntity,
		evidence: {
			...automated,
			entities: automated.entities.map((classified, index) =>
				index === brandIndex ? recommendedEntity : classified,
			),
		},
	};
}

describe("classifyEntities", () => {
	it.each([
		"Peppermint tea can help after meals.",
		"Keep the records in mint condition.",
		"See https://notmint.com/advice for details.",
	])("does not identify the short generic Mint brand in %j", (content) => {
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.acceptedMatches).toEqual([]);
	});

	it("rejects an uncorroborated generic occurrence and retains exact evidence", () => {
		const content = "Mint makes the office smell fresh.";
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.rejectedMatches).toHaveLength(1);
		expect(brand.rejectedMatches[0]).toMatchObject({
			matchedText: "Mint",
			matchedTerm: "Mint",
			start: 0,
			end: 4,
			rejectionReason: "ambiguous_without_corroboration",
			rule: "short_generic_entity_requires_distinctive_identity_evidence",
		});
		expect(brand.rejectedMatches[0].excerpt).toBe(
			content.slice(brand.rejectedMatches[0].excerptStart, brand.rejectedMatches[0].excerptEnd),
		);
	});

	it("identifies the longest verified alias and rejects the shadowed short name", () => {
		const content = "Mint Accountants helps small businesses.";
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("mentioned");
		expect(brand.acceptedMatches).toHaveLength(1);
		expect(brand.acceptedMatches[0]).toMatchObject({
			matchedText: "Mint Accountants",
			matchedTerm: "Mint Accountants",
			source: "alias",
			start: 0,
			end: 16,
		});
		expect(brand.rejectedMatches).toEqual([
			expect.objectContaining({
				matchedText: "Mint",
				rejectionReason: "shadowed_by_longer_match",
			}),
		]);
	});

	it("identifies exact and subdomain-owned hostname evidence but not lookalikes", () => {
		const exact = entity(classify("Visit https://mintaccountants.com.au/services."), mint.id);
		expect(exact.status).toBe("mentioned");
		expect(exact.acceptedMatches[0]).toMatchObject({
			source: "domain",
			matchedText: "mintaccountants.com.au",
			rule: "owned_domain_exact",
		});

		const subdomain = entity(classify("See https://portal.mintaccountants.com.au/login."), mint.id);
		expect(subdomain.acceptedMatches[0].rule).toBe("owned_domain_subdomain");

		const markdown = entity(classify("Read [the source](https://mintaccountants.com.au/guide)."), mint.id);
		expect(markdown.acceptedMatches[0]).toMatchObject({ source: "domain", rule: "owned_domain_exact" });

		const lookalike = entity(classify("See https://notmintaccountants.com.au."), mint.id);
		expect(lookalike.status).toBe("not_mentioned");
	});

	it("does not treat URL userinfo or email addresses as owned-domain evidence", () => {
		const evil: EntityIdentityInput = {
			id: "competitor-evil",
			role: "competitor",
			name: "Unrelated Evil Holdings",
			domains: ["evil.com"],
		};
		for (const content of [
			"See https://mintaccountants.com.au@evil.com/path.",
			"Email info@mintaccountants.com.au for details.",
			"The token mintaccountants.com.au@evil.com is not a hostname.",
			"The invalid authority mintaccountants.com.au:99999 is not evidence.",
		]) {
			const result = classify(content, [mint, evil]);
			expect(entity(result, mint.id).acceptedMatches).toEqual([]);
			expect(entity(result, evil.id).acceptedMatches).toEqual([]);
		}
	});

	it("scans every URL and bare hostname joined by Markdown or punctuation", () => {
		const content =
			"[first](https://evil.example),[mint](https://mintaccountants.com.au). See(mintaccountants.com.au),then mintaccountants.com.au/path.";
		const brand = entity(classify(content), mint.id);
		const domainMatches = brand.acceptedMatches.filter((match) => match.source === "domain");
		expect(domainMatches).toHaveLength(3);
		expect(domainMatches.map((match) => match.matchedText)).toEqual([
			"mintaccountants.com.au",
			"mintaccountants.com.au",
			"mintaccountants.com.au",
		]);
	});

	it("does not scan unsupported schemes, invalid ports, emails, or userinfo as owned hosts", () => {
		for (const content of [
			"ftp://mintaccountants.com.au/file",
			"mintaccountants.com.au:99999/path",
			"info@mintaccountants.com.au",
			"https://mintaccountants.com.au@evil.example/path",
		]) {
			expect(entity(classify(content), mint.id).acceptedMatches).toEqual([]);
		}
	});

	it.each([
		"info@nucleus.example",
		"https://Nucleus@evil.example",
		"https://evil.example/Nucleus",
		"https://evil.example?q=Nucleus",
		"https://evil.example/path;Nucleus",
		"https://evil.example/?q=x;Nucleus",
		"https://evil.example/#x,Nucleus",
		"evil.example/path;Nucleus",
		"o'connor@nucleus.example",
		"o'connor@nucleus.example;Nucleus",
		"Nucleus'o@example.com",
		"[other](https://evil.example/path;Nucleus)",
		"nucleus.example",
	] as const)("does not use an alias inside the machine-shaped span %j as prose evidence", (content) => {
		const aliasedNucleus: EntityIdentityInput = {
			...nucleus,
			aliases: ["Nucleus"],
		};
		const competitor = entity(classify(content, [aliasedNucleus]), aliasedNucleus.id);
		expect(competitor.status).toBe("not_mentioned");
		expect(competitor.acceptedMatches).toEqual([]);
	});

	it.each([
		["[Nucleus](https://evil.example)", 1],
		["[first](https://evil.example),[Nucleus](https://other.example)", 31],
		["Visit Nucleus at https://evil.example.", 6],
		["Nucleus https://evil.example/path", 0],
	] as const)("retains visible alias prose outside a machine-shaped span in %j", (content, start) => {
		const aliasedNucleus: EntityIdentityInput = {
			...nucleus,
			aliases: ["Nucleus"],
		};
		const competitor = entity(classify(content, [aliasedNucleus]), aliasedNucleus.id);
		expect(competitor.status).toBe("mentioned");
		expect(competitor.acceptedMatches).toEqual([
			expect.objectContaining({
				source: "alias",
				matchedText: "Nucleus",
				start,
				end: start + "Nucleus".length,
			}),
		]);
	});

	it("uses an explicitly owned hostname only as domain evidence", () => {
		const aliasedNucleus: EntityIdentityInput = {
			...nucleus,
			aliases: ["Nucleus"],
			domains: ["nucleus.example"],
		};
		const competitor = entity(classify("nucleus.example", [aliasedNucleus]), aliasedNucleus.id);
		expect(competitor.status).toBe("mentioned");
		expect(competitor.acceptedMatches).toEqual([
			expect.objectContaining({
				source: "domain",
				matchedText: "nucleus.example",
				rule: "owned_domain_exact",
			}),
		]);
	});

	it("keeps a generic occurrence rejected when an owned domain separately identifies the entity", () => {
		const content = "I recommend Mint condition software. See mintaccountants.com.au.";
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("mentioned");
		expect(brand.acceptedMatches).toEqual([
			expect.objectContaining({ source: "domain", matchedText: "mintaccountants.com.au" }),
		]);
		expect(brand.rejectedMatches).toEqual([
			expect.objectContaining({
				matchedText: "Mint",
				rejectionReason: "ambiguous_without_corroboration",
			}),
		]);
	});

	it("does not use configured context terms to corroborate a generic brand", () => {
		const brand = entity(classify("Mint provides accounting services."), mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.acceptedMatches).toEqual([]);
		expect(brand.rejectedMatches[0]).toMatchObject({
			matchedText: "Mint",
			rejectionReason: "ambiguous_without_corroboration",
		});
	});

	it("rejects the same generic single-word name for a competitor", () => {
		const genericCompetitor: EntityIdentityInput = {
			id: "competitor-generic-mint",
			role: "competitor",
			name: "Mint",
			aliases: ["Mint Advisory"],
			contextTerms: ["software"],
		};
		const generic = entity(
			classify("I recommend Mint condition software.", [genericCompetitor]),
			genericCompetitor.id,
		);
		expect(generic.status).toBe("not_mentioned");
		expect(generic.acceptedMatches).toEqual([]);
		expect(generic.rejectedMatches).toEqual([
			expect.objectContaining({ matchedText: "Mint", rejectionReason: "ambiguous_without_corroboration" }),
		]);

		const distinctive = entity(classify("Mint Advisory is listed.", [genericCompetitor]), genericCompetitor.id);
		expect(distinctive.status).toBe("mentioned");
		expect(distinctive.acceptedMatches[0]).toMatchObject({ source: "alias", matchedText: "Mint Advisory" });
	});

	it("rejects every generic occurrence even when an industry word is nearby", () => {
		const content = "Mint condition software and Mint provides accounting services.";
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.acceptedMatches).toEqual([]);
		expect(brand.rejectedMatches).toHaveLength(2);
		expect(brand.rejectedMatches.map((match) => match.start)).toEqual([0, content.lastIndexOf("Mint")]);
		expect(
			brand.rejectedMatches.every((match) => match.rejectionReason === "ambiguous_without_corroboration"),
		).toBe(true);
	});

	it("does not let a competitor identity corroborate or recommend generic Mint", () => {
		const content = "I recommend Mint condition software over Nucleus Accounting.";
		const result = classify(content);
		const brand = entity(result, mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.acceptedMatches).toEqual([]);
		expect(brand.rejectedMatches).toEqual([
			expect.objectContaining({ matchedText: "Mint", rejectionReason: "ambiguous_without_corroboration" }),
		]);
		expect(entity(result, nucleus.id).status).toBe("mentioned");
	});

	it.each([
		"I recommend Mint condition software at accounting.example.",
		"I recommend Mint condition software at https://example.com/accounting.",
		"I recommend Mint condition software at https://example.com/?topic=accounting.",
		"I recommend Mint condition software via info@accounting.example.",
		"I recommend Mint condition software at https://accounting.example@example.com/path.",
	] as const)("does not use machine-shaped context to corroborate generic Mint in %j", (content) => {
		const brand = entity(classify(content), mint.id);
		expect(brand.status).toBe("not_mentioned");
		expect(brand.acceptedMatches).toEqual([]);
		expect(brand.rejectedMatches).toEqual([
			expect.objectContaining({ matchedText: "Mint", rejectionReason: "ambiguous_without_corroboration" }),
		]);
	});

	it("treats recommendation language as mention evidence only", () => {
		const brand = entity(classify("I recommend Mint Accountants."), mint.id);
		expect(brand.status).toBe("mentioned");
		expect(brand.acceptedMatches[0]).toMatchObject({
			matchedText: "Mint Accountants",
			recommendation: {
				status: "not_detected",
				rule: "automated_recommendation_classification_deferred",
			},
		});
	});

	it.each([
		["I recommend Mint Accountants and Nucleus Accounting.", [mint.id, nucleus.id]],
		["Mint Accountants and Nucleus Accounting are recommended.", [mint.id, nucleus.id]],
		["I recommend Mint Accountants and not Nucleus Accounting.", [mint.id, nucleus.id]],
		["I do not recommend Nucleus Accounting and recommend Mint Accountants.", [mint.id, nucleus.id]],
		["Avoid Mint Accountants; I recommend Nucleus Accounting.", [mint.id, nucleus.id]],
		["I would not strongly recommend Mint Accountants.", [mint.id]],
		["I might cautiously recommend Mint Accountants.", [mint.id]],
	] as const)("never emits recommended for recommendation-language content in %j", (content, mentionedIds) => {
		const result = classify(content);
		expect(result.entities.every((classified) => classified.status !== "recommended")).toBe(true);
		for (const id of mentionedIds) {
			const classified = entity(result, id);
			expect(classified.status).toBe("mentioned");
			expect(
				classified.acceptedMatches.every(
					(match) =>
						match.recommendation.status === "not_detected" &&
						match.recommendation.rule === "automated_recommendation_classification_deferred",
				),
			).toBe(true);
		}
	});

	it("marks automated recommendation classification as deferred", () => {
		const result = classify("Mint Accountants is listed.");
		expect(result.classifier.recommendationClassification).toBe(RECOMMENDATION_CLASSIFICATION_STATUS);
		expect(result.classifier.recommendationClassificationDescription).toBe(
			RECOMMENDATION_CLASSIFICATION_DESCRIPTION,
		);
		expect(result.classifier.recommendationClassificationDescription).toContain("not a verified negative");
	});

	it("records shared alias and domain occurrences as collisions", () => {
		const rival: EntityIdentityInput = {
			id: "competitor-shared",
			role: "competitor",
			name: "Shared Advisory",
			aliases: ["Mint Accountants"],
			domains: ["mintaccountants.com.au"],
		};
		const result = classifyEntities({
			content: "Mint Accountants appears at mintaccountants.com.au.",
			entities: [mint, rival],
		});
		for (const classified of result.entities) {
			expect(classified.status).toBe("not_mentioned");
			expect(classified.acceptedMatches).toEqual([]);
			expect(classified.rejectedMatches.map((match) => match.source)).toEqual(
				expect.arrayContaining(["alias", "domain"]),
			);
			expect(classified.rejectedMatches.every((match) => match.rejectionReason === "identity_collision")).toBe(true);
		}
	});

	it("prefers an exact owned domain over a less-specific parent domain", () => {
		const parent: EntityIdentityInput = {
			id: "a-parent",
			role: "brand",
			name: "Parent",
			domains: ["example.com"],
		};
		const child: EntityIdentityInput = {
			id: "z-child",
			role: "competitor",
			name: "Child",
			domains: ["shop.example.com"],
		};
		const result = classify("Visit shop.example.com for details.", [parent, child]);
		expect(entity(result, child.id).acceptedMatches[0]).toMatchObject({
			matchedTerm: "shop.example.com",
			rule: "owned_domain_exact",
		});
		expect(entity(result, parent.id).status).toBe("not_mentioned");
		expect(entity(result, parent.id).rejectedMatches[0].rejectionReason).toBe("shadowed_by_longer_match");
	});

	it("keeps shared parent ownership collided without suppressing a more-specific exact owner", () => {
		const entities: EntityIdentityInput[] = [
			{ id: "parent-one", role: "brand", name: "Parent One", domains: ["example.com"] },
			{ id: "parent-two", role: "competitor", name: "Parent Two", domains: ["example.com"] },
			{ id: "exact-child", role: "competitor", name: "Exact Child", domains: ["shop.example.com"] },
		];
		const result = classify("Visit shop.example.com.", entities);
		expect(entity(result, "exact-child").status).toBe("mentioned");
		expect(entity(result, "exact-child").acceptedMatches[0].rule).toBe("owned_domain_exact");
		for (const id of ["parent-one", "parent-two"]) {
			expect(entity(result, id).status).toBe("not_mentioned");
			expect(entity(result, id).rejectedMatches[0].rejectionReason).toBe("identity_collision");
		}
	});

	it("ignores empty aliases and emits a versioned schema-valid envelope", () => {
		const result = classify("No tracked company appears here.", [mint]);
		expect(result.entities[0].acceptedMatches).toEqual([]);
		expect(result.entities[0].rejectedMatches).toEqual([]);
		expect(result.classifier.confidenceDescription).toContain("not a probability");
		expect(runEvidenceV1Schema.parse(result)).toEqual(result);
	});

	it("preserves Unicode-safe source offsets around emoji", () => {
		const unicodeEntity: EntityIdentityInput = {
			id: "competitor-unicode",
			role: "competitor",
			name: "Café Ledger",
		};
		const content = "📊 We recommend Café Ledger for reporting.";
		const classified = entity(classify(content, [unicodeEntity]), unicodeEntity.id);
		const match = classified.acceptedMatches[0];
		expect(content.slice(match.start, match.end)).toBe("Café Ledger");
		expect(match.start).toBe(content.indexOf("Café Ledger"));
		expect(classified.status).toBe("mentioned");
	});

	it.each([
		["ΟΣ Ledger", "ΟΣ Ledger", "ΟΣ Ledger"],
		["Mint Accountants", "Ｍｉｎｔ Accountants", "Ｍｉｎｔ Accountants"],
		["Office Ledger", "Oﬃce Ledger", "Oﬃce Ledger"],
		["Café Ledger", "Cafe\u0301 Ledger", "Cafe\u0301 Ledger"],
	] as const)("maps normalized identity %j back to exact source text", (name, source, expectedSource) => {
		const unicodeEntity: EntityIdentityInput = {
			id: `unicode-${name}`,
			role: "competitor",
			name,
		};
		const content = `📊 ${source} appears here.`;
		const classified = entity(classify(content, [unicodeEntity]), unicodeEntity.id);
		const match = classified.acceptedMatches[0];
		expect(match.matchedText).toBe(expectedSource);
		expect(content.slice(match.start, match.end)).toBe(expectedSource);
		expect(match.start).toBe(content.indexOf(source));
	});

	it("treats adjacent non-BMP letters as word characters at identity boundaries", () => {
		const brand = entity(classify("𐐀Mint appears here.", [mint]), mint.id);
		expect(brand.acceptedMatches).toEqual([]);
		expect(brand.rejectedMatches).toEqual([]);
	});

	it("scans a large dotless provider response without pathological hostname matching", () => {
		const content = "a".repeat(100_000);
		const startedAt = performance.now();
		const result = classify(content, [{ id: "absent", role: "competitor", name: "Absent", domains: ["example.com"] }]);
		const elapsed = performance.now() - startedAt;
		expect(result.entities[0].status).toBe("not_mentioned");
		expect(elapsed).toBeLessThan(2_000);
	});

	it("scans a large unterminated Markdown destination in one bounded pass", () => {
		const content = "[label](".repeat(12_500);
		const result = classify(content, [{ id: "absent", role: "competitor", name: "Absent" }]);
		expect(result.entities[0].status).toBe("not_mentioned");
	});

	it("classifies tens of thousands of real non-overlapping matches with indexed arbitration", () => {
		const occurrenceCount = 30_000;
		const name = "Distinctive Ledger";
		const content = Array(occurrenceCount).fill(name).join(" and then ");
		const result = classify(content, [{ id: "repeated", role: "competitor", name }]);
		const matches = result.entities[0].acceptedMatches;
		expect(matches).toHaveLength(occurrenceCount);
		expect(matches[0].matchedText).toBe(name);
		expect(matches.at(-1)?.end).toBe(content.length);
	}, 10_000);
});

describe("normalizeHttpUrl", () => {
	it("normalizes conservatively while preserving scheme, path, and query", () => {
		expect(normalizeHttpUrl("http://EXAMPLE.com:80/a/../report?ref=paid&utm_source=x#section")).toEqual({
			status: "normalized",
			originalUrl: "http://EXAMPLE.com:80/a/../report?ref=paid&utm_source=x#section",
			normalizedUrl: "http://example.com/report?ref=paid&utm_source=x",
			normalizedDomain: "example.com",
		});
		expect(normalizeHttpUrl("https://Example.com:443/path?q=1#fragment")).toMatchObject({
			status: "normalized",
			normalizedUrl: "https://example.com/path?q=1",
		});
	});

	it("normalizes Unicode hostnames using URL IDNA handling", () => {
		expect(normalizeHttpUrl("https://BÜCHER.example/über?q=1")).toMatchObject({
			status: "normalized",
			normalizedDomain: "xn--bcher-kva.example",
		});
	});

	it.each([
		["", "empty"],
		["not a URL", "malformed"],
		["https://example.com:99999/path", "malformed"],
		["ftp://example.com/file", "unsupported_scheme"],
		["javascript:alert(1)", "unsupported_scheme"],
	] as const)("rejects %j as %s", (input, error) => {
		const result = normalizeHttpUrl(input);
		expect(result).toEqual({ status: "invalid", originalUrl: input, error });
		expect(httpUrlNormalizationResultSchema.parse(result)).toEqual(result);
	});

	it("rejects URL credentials while preserving non-default ports and meaningful queries", () => {
		expect(normalizeHttpUrl("https://user:secret@example.com/path")).toEqual({
			status: "invalid",
			originalUrl: "https://user:secret@example.com/path",
			error: "credentials_not_allowed",
		});
		expect(normalizeHttpUrl("https://EXAMPLE.com:8443/path?token=public#fragment")).toMatchObject({
			status: "normalized",
			normalizedUrl: "https://example.com:8443/path?token=public",
			normalizedDomain: "example.com",
		});
	});

	it("requires normalized URL schema fields to be exactly canonical", () => {
		const canonical = {
			status: "normalized" as const,
			originalUrl: "https://EXAMPLE.com:443/path#fragment",
			normalizedUrl: "https://example.com/path",
			normalizedDomain: "example.com",
		};
		expect(normalizedHttpUrlSchema.safeParse(canonical).success).toBe(true);
		for (const mismatch of [
			{ ...canonical, normalizedUrl: "https://example.com/other" },
			{ ...canonical, normalizedUrl: "https://EXAMPLE.com/path" },
			{ ...canonical, normalizedUrl: "https://example.com:443/path" },
			{ ...canonical, normalizedUrl: "https://user:secret@example.com/path" },
			{ ...canonical, normalizedUrl: "https://example.com/path#fragment" },
			{ ...canonical, normalizedDomain: "other.example" },
			{ ...canonical, normalizedUrl: "ftp://example.com/path" },
		]) {
			expect(normalizedHttpUrlSchema.safeParse(mismatch).success).toBe(false);
		}
	});

	it("requires invalid URL schema fields to match canonical rejection", () => {
		expect(
			httpUrlNormalizationResultSchema.safeParse({
				status: "invalid",
				originalUrl: "https://example.com",
				error: "malformed",
			}).success,
		).toBe(false);
		expect(
			httpUrlNormalizationResultSchema.safeParse({
				status: "invalid",
				originalUrl: "not a URL",
				error: "unsupported_scheme",
			}).success,
		).toBe(false);
		expect(
			httpUrlNormalizationResultSchema.safeParse({
				status: "invalid",
				originalUrl: "not a URL",
				error: "malformed",
			}).success,
		).toBe(true);
	});

	it("creates an unattempted and unassessed citation envelope without I/O", () => {
		const evidence = createUnverifiedCitationEvidence("https://example.com/a#source");
		expect(evidence).toMatchObject({
			schemaVersion: 1,
			presence: "present",
			url: { status: "normalized", normalizedUrl: "https://example.com/a" },
			verification: { status: "not_attempted" },
			support: { status: "not_assessed", claims: [] },
		});
	});
});

describe("evidence schema invariants", () => {
	it("retains recommended states for separate analyst-confirmed evidence", () => {
		const fixture = analystRecommendedFixture();
		expect(entityClassificationSchema.parse(fixture.recommendedEntity)).toEqual(fixture.recommendedEntity);
		expect(runEvidenceV1Schema.parse(fixture.evidence)).toEqual(fixture.evidence);
		expect(fixture.evidence.classifier.recommendationClassification).toBe("deferred");
	});

	it("rejects contradictory accepted and rejected match shapes", () => {
		const accepted = entity(classify("Mint Accountants is listed."), mint.id).acceptedMatches[0];
		expect(acceptedMatchSchema.safeParse({ ...accepted, rejectionReason: "identity_collision" }).success).toBe(false);
		const { rejectionReason: _rejectionReason, ...rejectedWithoutReason } = entity(
			classify("Mint makes the room smell fresh."),
			mint.id,
		).rejectedMatches[0];
		expect(rejectedMatchSchema.safeParse(rejectedWithoutReason).success).toBe(false);
		expect(
			recommendationAssessmentSchema.safeParse({
				status: "accepted",
				rule: "test",
				cue: "recommend",
				cueStart: 0,
				cueEnd: 9,
				rejectionReason: "negated",
			}).success,
		).toBe(false);
	});

	it("rejects contradictory UTF-16 match, excerpt, and cue offsets", () => {
		const { content, match } = analystRecommendedFixture();
		expect(acceptedMatchSchema.safeParse({ ...match, end: match.end + 1 }).success).toBe(false);
		expect(acceptedMatchSchema.safeParse({ ...match, excerptEnd: match.excerptEnd + 1 }).success).toBe(false);
		expect(
			acceptedMatchSchema.safeParse({
				...match,
				excerptStart: match.start + 1,
				excerpt: content.slice(match.start + 1, match.excerptEnd),
			}).success,
		).toBe(false);
		if (match.recommendation.status === "not_detected") throw new Error("Expected analyst recommendation evidence");
		expect(
			acceptedMatchSchema.safeParse({
				...match,
				recommendation: { ...match.recommendation, cueEnd: match.recommendation.cueStart },
			}).success,
		).toBe(false);
		expect(acceptedMatchSchema.safeParse({ ...match, start: -1 }).success).toBe(false);
	});

	it("rejects every match, excerpt, and cue offset beyond sourceTextLength", () => {
		const { content, evidence: base, brandIndex, match } = analystRecommendedFixture();
		if (match.recommendation.status === "not_detected") throw new Error("Expected analyst recommendation evidence");
		const withMatch = (replacement: typeof match) => ({
			...base,
			entities: base.entities.map((classified, index) =>
				index === brandIndex ? { ...classified, acceptedMatches: [replacement] } : classified,
			),
		});

		const outOfBoundsMatch = {
			...match,
			start: content.length,
			end: content.length + match.matchedText.length,
			excerptStart: content.length,
			excerptEnd: content.length + match.matchedText.length,
			excerpt: match.matchedText,
		};
		const outOfBoundsExcerpt = {
			...match,
			excerptEnd: content.length + 1,
			excerpt: `${match.excerpt}x`,
		};
		const outOfBoundsCue = {
			...match,
			recommendation: {
				...match.recommendation,
				cue: "x",
				cueStart: content.length,
				cueEnd: content.length + 1,
			},
		};
		for (const invalid of [
			{ ...base, sourceTextLength: 0 },
			withMatch(outOfBoundsMatch),
			withMatch(outOfBoundsExcerpt),
			withMatch(outOfBoundsCue),
		]) {
			expect(runEvidenceV1Schema.safeParse(invalid).success).toBe(false);
		}
	});

	it("rejects unknown fields throughout the versioned evidence contract", () => {
		const base = classify("Mint Accountants is listed.");
		const variants = [
			{ ...base, unexpected: true },
			{ ...base, classifier: { ...base.classifier, unexpected: true } },
			{ ...base, citations: { ...base.citations, unexpected: true } },
			{
				...base,
				entities: base.entities.map((classified, index) =>
					index === 0 ? { ...classified, unexpected: true } : classified,
				),
			},
			{
				...base,
				entities: base.entities.map((classified, index) =>
					index === 0
						? { ...classified, identity: { ...classified.identity, unexpected: true } }
						: classified,
				),
			},
		];
		for (const variant of variants) expect(runEvidenceV1Schema.safeParse(variant).success).toBe(false);

		const citation = createUnverifiedCitationEvidence("https://example.com/source");
		expect(citationEvidenceV1Schema.safeParse({ ...citation, unexpected: true }).success).toBe(false);
		expect(
			citationEvidenceV1Schema.safeParse({
				...citation,
				verification: { ...citation.verification, unexpected: true },
			}).success,
		).toBe(false);
		expect(
			citationEvidenceV1Schema.safeParse({
				...citation,
				support: { ...citation.support, unexpected: true },
			}).success,
		).toBe(false);
	});

	it.each(["not_attempted", "unreachable", "failed"] as const)(
		"requires %s citations to remain unassessed",
		(status) => {
			const evidence = createUnverifiedCitationEvidence("https://example.com/source");
			expect(
				citationEvidenceV1Schema.safeParse({
					...evidence,
					verification: { status },
					support: {
						status: "supports",
						claims: [
							{
								entityId: mint.id,
								claim: "mention",
								status: "supports",
								confidence: 0.9,
								confidenceKind: "heuristic_rule_score",
							},
						],
					},
				}).success,
			).toBe(false);
		},
	);

	it("rejects verification of an invalid URL and inconsistent aggregate support", () => {
		const invalid = createUnverifiedCitationEvidence("not a URL");
		expect(
			citationEvidenceV1Schema.safeParse({
				...invalid,
				verification: { status: "verified" },
				support: { status: "not_assessed", claims: [] },
			}).success,
		).toBe(false);
		expect(
			citationEvidenceV1Schema.safeParse({
				...createUnverifiedCitationEvidence("https://example.com/source"),
				verification: { status: "verified", finalUrl: "not a URL" },
			}).success,
		).toBe(false);

		const valid = createUnverifiedCitationEvidence("https://example.com/source");
		expect(
			citationEvidenceV1Schema.safeParse({
				...valid,
				verification: { status: "verified" },
				support: {
					status: "supports",
					claims: [
						{
							entityId: mint.id,
							claim: "mention",
							status: "does_not_support",
							confidence: 0.8,
							confidenceKind: "heuristic_rule_score",
						},
					],
				},
			}).success,
		).toBe(false);
	});

	it("rejects entity and citation aggregate states that contradict their evidence", () => {
		const result = classify("Mint Accountants is listed.");
		expect(
			runEvidenceV1Schema.safeParse({
				...result,
				entities: result.entities.map((classified) =>
					classified.identity.id === mint.id ? { ...classified, status: "not_mentioned" } : classified,
				),
			}).success,
		).toBe(false);
		expect(
			runEvidenceV1Schema.safeParse({
				...result,
				citations: { presence: "none", count: 1 },
			}).success,
		).toBe(false);
	});

	it("rejects duplicate stable entity IDs at classifier and schema boundaries", () => {
		const duplicates: EntityIdentityInput[] = [
			{ id: "duplicate", role: "brand", name: "First", domains: ["shared.example"] },
			{ id: "duplicate", role: "competitor", name: "Second", domains: ["shared.example"] },
		];
		expect(() => classify("shared.example", duplicates)).toThrow("Duplicate stable entity ID: duplicate");

		const valid = classify("Mint Accountants and Nucleus Accounting are listed.");
		const duplicateEnvelope = {
			...valid,
			entities: valid.entities.map((classified, index) =>
				index === 1
					? { ...classified, identity: { ...classified.identity, id: valid.entities[0].identity.id } }
					: classified,
			),
		};
		expect(runEvidenceV1Schema.safeParse(duplicateEnvelope).success).toBe(false);
	});
});
