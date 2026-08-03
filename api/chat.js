// Vercel serverless function: uses LangChain's ChatAnthropic wrapper to talk to
// Claude, so the API key never has to live in browser code.
//
// Set ANTHROPIC_API_KEY as an environment variable in your Vercel project settings.

import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

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

  try {
    const { system, messages, tools } = req.body;

    const model = new ChatAnthropic({
      apiKey,
      model: "claude-sonnet-5",
      maxTokens: 1000,
      temperature: 1,
      // LangChain's ChatAnthropic can compute its own top_p internally and
      // override a plain `topP` constructor option in some versions. Passing
      // it via modelKwargs forces it straight into the raw request body,
      // bypassing that internal computation.
      modelKwargs: {
        top_p: 1,
      },
    });

    // Anthropic's server-side tools (like web_search) aren't a first-class
    // LangChain concept, but ChatAnthropic passes anything bound here straight
    // through to the underlying API request, so this still works.
    const boundModel = tools && tools.length ? model.bind({ tools }) : model;

    const langchainMessages = [
      new SystemMessage(system),
      ...(messages || []).map((m) =>
        m.role === "assistant" ? new AIMessage(m.content) : new HumanMessage(m.content)
      ),
    ];

    const response = await boundModel.invoke(langchainMessages);

    // Normalize LangChain's response shape back into the same
    // { content: [{ type: "text", text }] } shape the frontend already expects,
    // so nothing on the client needs to change.
    let text;
    if (typeof response.content === "string") {
      text = response.content;
    } else if (Array.isArray(response.content)) {
      text = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    } else {
      text = String(response.content ?? "");
    }

    res.status(200).json({ content: [{ type: "text", text }] });
  } catch (err) {
    res.status(500).json({
      error: "Server error contacting Anthropic API via LangChain",
      detail: String(err),
    });
  }
}
