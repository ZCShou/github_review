import fs from "node:fs";

function parseEnv(path) {
  const env = {};

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    let value = match[2].trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

const env = parseEnv(".env");
const provider = env.AI_PROVIDER || "deepseek";
const defaultBaseUrl = provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com";
const defaultModel = provider === "openai" ? "gpt-5.5" : "deepseek-v4-pro";
const model = env.AI_MODEL || defaultModel;
const baseUrl = (env.AI_BASE_URL || defaultBaseUrl).replace(/\/$/, "");
const apiKey = env.AI_API_KEY;

if (!apiKey) {
  console.error("AI_API_KEY is not set.");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
const started = Date.now();

try {
  let response;

  if (provider === "openai") {
    response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "user", content: [{ type: "input_text", text: "Return {\"ok\":true,\"message\":\"pong\"}" }] },
        ],
        max_output_tokens: 128,
        text: { format: { type: "json_object" } },
        store: false,
      }),
    });
  } else {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Return valid JSON only." },
          { role: "user", content: "Return {\"ok\":true,\"message\":\"pong\"}." },
        ],
        response_format: { type: "json_object" },
        max_tokens: 128,
        stream: false,
      }),
    });
  }

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined;
  }

  if (provider === "openai") {
    console.log(JSON.stringify({
      provider,
      model,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      outputText: payload?.output_text?.slice(0, 120),
      error: payload?.error?.message,
    }, null, 2));
  } else {
    console.log(JSON.stringify({
      provider,
      model,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      hasChoices: Boolean(payload?.choices?.length),
      finishReason: payload?.choices?.[0]?.finish_reason,
      contentPreview: payload?.choices?.[0]?.message?.content?.slice(0, 120),
      error: payload?.error?.message,
    }, null, 2));
  }

  if (!response.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    provider,
    model,
    ok: false,
    elapsedMs: Date.now() - started,
    errorName: error.name,
    errorMessage: error.message,
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
