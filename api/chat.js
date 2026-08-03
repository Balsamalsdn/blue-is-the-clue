// Vercel serverless function: proxies requests to the Anthropic API
// so the API key never has to live in browser code.
//
// Set ANTHROPIC_API_KEY as an environment variable in your Vercel project settings.

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

    const body = {
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system,
      messages,
    };
    if (tools) body.tools = tools;

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
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error contacting Anthropic API", detail: String(err) });
  }
}
