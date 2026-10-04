import assert from "node:assert/strict";
import test from "node:test";
import { dist } from "../../units.ts";
import { DEFAULT_MODEL, DEFAULT_VOICE, speakable, speechConfig, speechFor, synthesize } from "../elevenlabs.ts";

const withKey = (env: Record<string, string>, fn: () => Promise<void>) => async () => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    await fn();
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

test("speakable: distances read aloud, no @-signs or markdown", () => {
  assert.equal(speakable(`On my way, @dave. ${dist(0.0254 * 40)} to go.`, "imperial"), "On my way, dave. 3 feet 4 inches to go.");
  assert.equal(speakable(`Only ${dist(0.0254)} left.`, "imperial"), "Only 1 inch left.");
  assert.equal(speakable(`About ${dist(0.36)}, **really**.`, "metric"), "About 36 centimeters, really.");
  const long = "This is a sentence. ".repeat(60);
  const s = speakable(long, "imperial");
  assert.ok(s.length <= 600 && s.endsWith("."), "long lines are cut at a sentence end");
});

test("config: off without a key; defaults for voice and model; quotes trimmed", withKey({ ELEVENLABS_API_KEY: ' "sk_abc" ' }, async () => {
  const c = speechConfig();
  assert.equal(c.apiKey, "sk_abc");
  assert.equal(c.voice, DEFAULT_VOICE);
  assert.equal(c.model, DEFAULT_MODEL);
}));

test("synthesize: posts the text with the key in a header, never in the URL", withKey({ ELEVENLABS_API_KEY: "sk_test", ELEVENLABS_VOICE_ID: "voice1" }, async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  const out = await synthesize("Hello there.", fake);
  assert.equal(out.bytes.byteLength, 3);
  assert.match(seen!.url, /\/v1\/text-to-speech\/voice1\?output_format=mp3/);
  assert.ok(!seen!.url.includes("sk_test"));
  assert.equal((seen!.init.headers as Record<string, string>)["xi-api-key"], "sk_test");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { text: "Hello there.", model_id: DEFAULT_MODEL });
}));

test("synthesize: plain-language errors", withKey({ ELEVENLABS_API_KEY: "sk_test" }, async () => {
  const failing = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await assert.rejects(synthesize("x", failing(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } })), /rejected the API key/);
  await assert.rejects(synthesize("x", failing(401, { detail: { status: "quota_exceeded", message: "This request exceeds your quota" } })), /out of credits/);
  await assert.rejects(synthesize("x", failing(404, { detail: { message: "voice not found" } })), /ELEVENLABS_VOICE_ID/);
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(synthesize("x", down), /Couldn't reach ElevenLabs/);
}));

test("no key: synthesize refuses without calling out", async () => {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.XI_API_KEY;
  let called = false;
  const fake = (async () => {
    called = true;
    return new Response("");
  }) as unknown as typeof fetch;
  await assert.rejects(synthesize("x", fake), /not set/);
  assert.equal(called, false);
});

test("speechFor: one ElevenLabs call per line, shared by every listener; failures are retried", withKey({ ELEVENLABS_API_KEY: "sk_test" }, async () => {
  let calls = 0;
  let fail = true;
  const fake = (async () => {
    calls++;
    if (fail) return new Response("{}", { status: 500 });
    return new Response(new Uint8Array([9]), { headers: { "content-type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  await assert.rejects(speechFor("m-test-1", "Hi.", "imperial", fake));
  fail = false;
  const [a, b] = await Promise.all([speechFor("m-test-1", "Hi.", "imperial", fake), speechFor("m-test-1", "Hi.", "imperial", fake)]);
  assert.equal(a, b);
  assert.equal(calls, 2, "the failure wasn't cached; the two listeners shared one call");
  await speechFor("m-test-1", "Hi.", "metric", fake);
  assert.equal(calls, 3, "metric viewers hear metric distances");
}));
