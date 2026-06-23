import { Router } from "express";
import { db } from "../db/index.js";
import Anthropic from "@anthropic-ai/sdk";

export const qaRouter = Router();

const MAX_QUESTION_LENGTH = 2000;

qaRouter.post("/", async (req, res, next) => {
  try {
    const { question, cardId, sourceId } = req.body;
    if (!question || typeof question !== "string") {
      res.status(400).json({ data: null, error: "question is required" });
      return;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      res.status(400).json({ data: null, error: `question must be under ${MAX_QUESTION_LENGTH} characters` });
      return;
    }
    if (cardId !== undefined && (!Number.isInteger(cardId) || cardId <= 0)) {
      res.status(400).json({ data: null, error: "cardId must be a positive integer" });
      return;
    }
    if (sourceId !== undefined && (!Number.isInteger(sourceId) || sourceId <= 0)) {
      res.status(400).json({ data: null, error: "sourceId must be a positive integer" });
      return;
    }

    let context = "";

    // 1. Card context if provided
    if (cardId) {
      const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as any;
      if (card) {
        const note = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(card.note_id) as any;
        context += `Card context:\nQuestion: ${card.question}\nAnswer: ${card.answer}\nFields: ${note?.fields}\n\n`;
      }
    }

    // 2. FTS5 BM25 search for relevant text
    // Strip FTS5 special characters to avoid syntax errors
    const safeTerms = question
      .replace(/[^\w\s\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (safeTerms.length > 0) {
      const matchQuery = safeTerms.map((t) => `"${t}"`).join(" OR ");
      let ftsSql = `
        SELECT notes.fields, notes.tags, notes_fts.rank
        FROM notes_fts
        JOIN notes ON notes_fts.rowid = notes.id
        WHERE notes_fts MATCH ?
      `;
      const ftsParams: any[] = [matchQuery];

      if (sourceId) {
        ftsSql += ` AND notes.source_id = ?`;
        ftsParams.push(sourceId);
      }
      ftsSql += ` ORDER BY rank LIMIT 10`;

      try {
        const results = db.prepare(ftsSql).all(...ftsParams) as any[];
        if (results.length > 0) {
          context += `Related material:\n`;
          for (const r of results) {
            context += `- ${r.fields} ${r.tags ? "(Tags: " + r.tags + ")" : ""}\n`;
          }
        }
      } catch (err: any) {
        console.warn("FTS search failed:", err);
      }
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `You are a helpful AI assistant for a language learning app.
Use the following context to answer the user's question. If the context is not helpful, you can use your general knowledge, but prioritize the context.

Context:
${context}

User's Question:
${question}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    const stream = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }, { signal: abortController.signal, timeout: 15000 });

    for await (const _chunk of stream as any) {
      const chunk = _chunk as any;
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: any) {
    console.error("QA error:", err);
    if (!res.headersSent) {
      res.status(500).json({ data: null, error: err.message });
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});
