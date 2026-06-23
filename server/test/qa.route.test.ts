import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { qaRouter } from "../src/routes/qa.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/qa", qaRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

// These cover request validation, which runs (and short-circuits) before the
// Anthropic client is ever constructed — no network access or API key
// required to exercise these paths.
describe("POST /api/qa validation", () => {
  it("rejects a missing question with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/question is required/);
  });

  it("rejects a non-string question with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/question is required/);
  });

  it("rejects a question over the max length with 400 before touching the Anthropic client", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "a".repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/under 2000 characters/);
  });

  it("accepts a question at exactly the max length without a length error", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "a".repeat(2000) }),
    });
    // No ANTHROPIC_API_KEY in the test env, so the request fails downstream —
    // but it must not be rejected for length, and must not crash the process.
    expect(res.status).not.toBe(400);
  });

  it("rejects a non-integer cardId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "What does 猫 mean?", cardId: "abc" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cardId must be a positive integer/);
  });

  it("rejects a zero/negative cardId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test", cardId: 0 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cardId/);
  });

  it("rejects a non-integer sourceId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test", sourceId: 1.5 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sourceId must be a positive integer/);
  });

  it("rejects a negative sourceId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test", sourceId: -5 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sourceId/);
  });
});
