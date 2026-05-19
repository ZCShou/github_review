import { afterEach, describe, expect, it } from "vitest";

import { readReviewConfig } from "./config.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("review config", () => {
  it("defaults to DeepSeek v4 pro", () => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;

    const config = readReviewConfig();

    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-v4-pro");
    expect(config.apiBaseUrl).toBe("https://api.deepseek.com");
    expect(config.requestTimeoutMs).toBe(300_000);
  });

  it("supports OpenAI-compatible configuration", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-5.5";
    process.env.AI_BASE_URL = "https://api.openai.com/v1/";
    process.env.AI_API_KEY = "test-key";

    const config = readReviewConfig();

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-5.5");
    expect(config.apiBaseUrl).toBe("https://api.openai.com/v1");
    expect(config.apiKey).toBe("test-key");
  });
});
