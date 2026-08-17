import { describe, expect, it } from "vitest";
import { getEnvValidationState, hasValue } from "./env";

describe("environment values", () => {
	it.each([
		undefined,
		"",
		"   ",
		"your_api_key_here",
		"YOUR_API_KEY_HERE",
		"replace_me",
		"<api-key>",
	])("treats %j as unconfigured", (value) => {
		expect(hasValue(value)).toBe(false);
	});

	it("accepts a non-placeholder value", () => {
		expect(hasValue("configured-value")).toBe(true);
	});

	it("does not require provider credentials for local UI startup", () => {
		const state = getEnvValidationState({
			DEPLOYMENT_MODE: "local",
			DATABASE_URL: "postgres://localhost/app",
			BETTER_AUTH_SECRET: "configured-value",
			SCRAPE_TARGETS: "chatgpt:openai-api:gpt-4o-mini",
			OPENAI_API_KEY: "your_api_key_here",
		});

		expect(state.isValid).toBe(true);
	});
});
