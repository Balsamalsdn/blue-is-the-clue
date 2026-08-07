// Vercel serverless function.
//
// Talks to Claude, and gives Claude a "query_teradata" tool it can call whenever
// it needs real data. When Claude calls that tool, this function runs the SQL
// against Teradata Vantage and feeds the results back to Claude, looping until
// Claude has a final answer (a standard "agent loop" pattern).
//
// Required environment variables (set in Vercel Project Settings):
//   ANTHROPIC_API_KEY  — your Claude API key
//   TERADATA_HOST      — your Vantage instance hostname
//   TERADATA_USER      — your Teradata username
//   TERADATA_PASSWORD  — your Teradata password
//
// ⚠️ IMPORTANT — READ THIS:
// The `teradatasql` package relies on native bindings (ffi-napi) to talk to
// Teradata. Native bindings are known to be unreliable in serverless
// environments like Vercel — they sometimes fail to install, compile, or run
// correctly there. This was a known, accepted risk when this file was
// written, and it has NOT been tested end-to-end (no network access was
// available while building it). If the query_teradata tool consistently
// fails, that's the most likely cause — see the README for a fallback plan
// (a small always-on Python/Node backend elsewhere, e.g. Render or Railway,
// instead of Vercel's serverless functions).

import teradata from "teradatasql";

const TERADATA_TOOL = {
  name: "query_teradata",
  description:
    "Run a read-only SQL SELECT query against the connected Teradata Vantage database and return the results. Use this whenever the user asks about specific data, tables, schemas, or wants an analysis grounded in real numbers. Always start by exploring available tables/columns if you're unsure of the schema (e.g. querying DBC.TablesV) before writing a detailed query.",
  input_schema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "A single SQL SELECT statement to run against Teradata Vantage. Must not modify data.",
      },
    },
    required: ["sql"],
  },
};

function isReadOnlySelect(sql) {
  const trimmed = sql.trim().toLowerCase();
  if (!trimmed.startsWith("select")) return false;
  // block obvious data-modifying keywords appearing anywhere in the statement
  const forbidden = ["insert", "update", "delete", "drop", "alter", "truncate", "create", "grant", "revoke", "merge"];
  return !forbidden.some((kw) => new RegExp(`\\b${kw}\\b`).test(trimmed));
}

async function runTeradataQuery(sql) {
  if (!isReadOnlySelect(sql)) {
    throw new Error("Only single, read-only SELECT statements are allowed.");
  }

  const connectParams = JSON.stringify({
    host: process.env.TERADATA_HOST,
    user: process.env.TERADATA_USER,
    password: process.env.TERADATA_PASSWORD,
  });

  const conn = teradata.connect(connectParams);
  try {
    const cursor = conn.cursor();
    await cursor.execute(sql);
    const rows = await cursor.fetchall();
    const columns = (cursor.description || []).map((d) => d.name);
    // cap what we send back to Claude so a huge table doesn't blow the context window
    const cappedRows = (rows || []).slice(0, 200);
    return { columns, row_count: rows ? rows.length : 0, rows: cappedRows };
  } finally {
    conn.close();
  }
}

async function callAnthropic(apiKey, body) {
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return { ok: upstream.ok, status: upstream.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
    return;
  }

  const teradataConfigured =
    process.env.TERADATA_HOST && process.env.TERADATA_USER && process.env.TERADATA_PASSWORD;

  try {
    const { system, messages } = req.body;
    let convo = [...(messages || [])];
    let finalData = null;
    const queriesRun = [];

    // Agent loop: keep going while Claude wants to call the query tool,
    // capped so a stuck loop can't run forever.
    for (let step = 0; step < 6; step++) {
      const body = {
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system,
        messages: convo,
      };
      if (teradataConfigured) body.tools = [TERADATA_TOOL];

      const result = await callAnthropic(apiKey, body);
      if (!result.ok) {
        res.status(result.status).json(result.data);
        return;
      }

      const toolUse = (result.data.content || []).find((c) => c.type === "tool_use");
      if (!toolUse) {
        finalData = result.data;
        break;
      }

      let toolResultText;
      let succeeded = true;
      try {
        const queryResult = await runTeradataQuery(toolUse.input.sql);
        toolResultText = JSON.stringify(queryResult);
      } catch (err) {
        succeeded = false;
        toolResultText = `Query failed: ${String(err && err.message ? err.message : err)}`;
      }
      queriesRun.push({ sql: toolUse.input.sql, succeeded, result: toolResultText });

      convo = [
        ...convo,
        { role: "assistant", content: result.data.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResultText }],
        },
      ];
    }

    if (!finalData) {
      res.status(200).json({
        content: [
          {
            type: "text",
            text: "That took more steps than expected to work through — try breaking your question into smaller parts.",
          },
        ],
        queries_run: queriesRun,
      });
      return;
    }

    finalData.queries_run = queriesRun;
    res.status(200).json(finalData);
  } catch (err) {
    res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
