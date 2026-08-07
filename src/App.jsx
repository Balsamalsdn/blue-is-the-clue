import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Plus,
  MessageSquare,
  Paperclip,
  X,
  Loader2,
  Circle,
  Sparkles,
  Terminal,
  BarChart3,
  Search,
} from "lucide-react";
import Papa from "papaparse";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const STORAGE_KEY = "vantage:sessions";
const CHART_COLORS = ["#2A5CDE", "#F2A93B", "#7C9CF2", "#E2594B", "#B48EF0", "#5FD1F2"];

const STARTER_PROMPTS = [
  "What tables are available in my Teradata database?",
  "Give me a quick summary of the largest table you can find.",
  "Are there any obvious data quality issues I should know about?",
];

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function newSession() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title: "New chat",
    messages: [],
    createdAt: Date.now(),
  };
}

async function callBackend(system, messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
  return data;
}

function extractText(content) {
  return (content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

// Looks for ```chart ... ``` fenced blocks containing a small JSON spec and
// pulls them out, so the rest of the text can render normally and the chart
// can render as an actual chart.
function extractChartBlocks(text) {
  const chartRegex = /```chart\s*([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = chartRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    try {
      const spec = JSON.parse(match[1]);
      parts.push({ type: "chart", spec });
    } catch {
      parts.push({ type: "text", content: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: "text", content: text }];
}

function ChartBlock({ spec }) {
  if (!spec || !Array.isArray(spec.data)) return null;
  const { chartType = "bar", data, xKey, yKey, title } = spec;

  return (
    <div className="chart-card">
      {title && <div className="chart-title">{title}</div>}
      <ResponsiveContainer width="100%" height={240}>
        {chartType === "line" ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey={xKey} stroke="#8B98A5" fontSize={11} />
            <YAxis stroke="#8B98A5" fontSize={11} />
            <Tooltip contentStyle={{ background: "#151B22", border: "1px solid rgba(255,255,255,0.1)" }} />
            <Line type="monotone" dataKey={yKey} stroke="#2A5CDE" strokeWidth={2} dot={false} />
          </LineChart>
        ) : chartType === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={80}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ background: "#151B22", border: "1px solid rgba(255,255,255,0.1)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey={xKey} stroke="#8B98A5" fontSize={11} />
            <YAxis stroke="#8B98A5" fontSize={11} />
            <Tooltip contentStyle={{ background: "#151B22", border: "1px solid rgba(255,255,255,0.1)" }} />
            <Bar dataKey={yKey} fill="#2A5CDE" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function QueryConsole({ queries }) {
  if (!queries || queries.length === 0) return null;
  return (
    <div className="console-stack">
      {queries.map((q, i) => (
        <div key={i} className="console-card">
          <div className="console-head">
            <span className="console-dot" />
            <span className="console-dot" />
            <span className="console-dot" />
            <span className="console-label">
              <Terminal size={11} /> QUERY {i + 1} {q.succeeded ? "" : "· FAILED"}
            </span>
          </div>
          <pre className="console-sql">{q.sql}</pre>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [sessions, setSessions] = useState(() => {
    const saved = loadSessions();
    return saved.length ? saved : [newSession()];
  });
  const [activeId, setActiveId] = useState(() => sessions[0]?.id);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null); // { name, summary }
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // ignore storage errors
    }
  }, [sessions]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active?.messages, loading]);

  function updateActiveSession(updater) {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
  }

  function handleNewChat() {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setAttachedFile(null);
  }

  function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data;
        const columns = results.meta.fields || [];
        const sample = rows.slice(0, 15);
        const summary =
          `Attached file: ${file.name}\n` +
          `${rows.length} rows, columns: ${columns.join(", ")}\n` +
          `First ${sample.length} rows as JSON:\n${JSON.stringify(sample)}`;
        setAttachedFile({ name: file.name, summary, rowCount: rows.length });
      },
      error: (err) => {
        alert("Couldn't parse that file: " + err.message);
      },
    });
    e.target.value = "";
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    let userVisibleText = trimmed;
    let userSentText = trimmed;
    if (attachedFile) {
      userVisibleText = `📎 ${attachedFile.name}\n\n${trimmed}`;
      userSentText = `${attachedFile.summary}\n\nUser question about this file: ${trimmed}`;
    }

    const userMsg = { role: "user", content: userVisibleText };
    updateActiveSession((s) => ({
      ...s,
      title: s.messages.length === 0 ? trimmed.slice(0, 48) : s.title,
      messages: [...s.messages, userMsg],
    }));
    setInput("");
    setAttachedFile(null);
    setLoading(true);

    const system = `You are Blue, a data-analyst assistant connected to a live Teradata Vantage database and to the person you're chatting with. You can:
- Have a normal, free-form conversation on any topic
- Query the connected Teradata Vantage database using the query_teradata tool whenever the user's question needs real data (explore schemas/tables first if you don't already know them)
- Analyze data the user pastes or attaches directly in the chat
- Suggest and describe charts

When a chart would genuinely help (a comparison, trend, or distribution), include exactly one fenced block like this in your reply, with real data:
\`\`\`chart
{"chartType": "bar", "title": "Short title", "xKey": "category", "yKey": "value", "data": [{"category": "A", "value": 10}, {"category": "B", "value": 20}]}
\`\`\`
chartType can be "bar", "line", or "pie". Only include a chart when it adds real value — most replies won't need one.

Be direct and concise. If Teradata isn't connected or a query fails, say so plainly and suggest what to check, rather than guessing at data.`;

    // Build plain-text history (previous turns) so Claude has conversation memory.
    const history = active.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : extractText(m.content),
    }));

    try {
      const data = await callBackend(system, [...history, { role: "user", content: userSentText }]);
      const text = extractText(data.content);
      updateActiveSession((s) => ({
        ...s,
        messages: [
          ...s.messages,
          { role: "assistant", content: text, queries: data.queries_run || [] },
        ],
      }));
    } catch (err) {
      updateActiveSession((s) => ({
        ...s,
        messages: [
          ...s.messages,
          { role: "assistant", content: `Something went wrong reaching the backend: ${err.message}`, isError: true },
        ],
      }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-root">
      <style>{`
        .app-root {
          --bg: #0C1116;
          --panel: #141B22;
          --panel-2: #10151B;
          --border: rgba(255,255,255,0.08);
          --text: #E7ECEF;
          --muted: #8B98A5;
          --blue: #2A5CDE;
          --amber: #F2A93B;
          --coral: #E2594B;
          font-family: 'Inter', -apple-system, sans-serif;
          background: var(--bg);
          color: var(--text);
          height: 100%;
          display: flex;
          border-radius: 12px;
          overflow: hidden;
        }

        /* Sidebar */
        .sidebar {
          width: 240px;
          flex-shrink: 0;
          background: var(--panel-2);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
        }
        .sidebar-header {
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          font-size: 14px;
          border-bottom: 1px solid var(--border);
        }
        .wordmark-blue { color: var(--blue); }
        .wordmark-white { color: var(--text); }
        .new-chat-btn {
          margin: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          background: rgba(42,92,222,0.1);
          border: 1px solid rgba(42,92,222,0.3);
          color: var(--blue);
          padding: 9px;
          border-radius: 7px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.03em;
          cursor: pointer;
        }
        .new-chat-btn:hover { background: rgba(42,92,222,0.18); }
        .session-list {
          flex: 1;
          overflow-y: auto;
          padding: 0 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .session-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-item:hover { background: rgba(255,255,255,0.04); }
        .session-item.active { background: rgba(42,92,222,0.1); color: var(--text); }
        .session-item svg { flex-shrink: 0; opacity: 0.6; }

        /* Connection status footer */
        .conn-status {
          padding: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .conn-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          letter-spacing: 0.1em;
          color: var(--muted);
          margin-bottom: 2px;
        }
        .conn-row {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
        }
        .conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .conn-dot.on { background: var(--blue); box-shadow: 0 0 6px var(--blue); }
        .conn-dot.off { background: var(--coral); }

        /* Main chat area */
        .main {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .main-header {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--muted);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .chat-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 20px;
          text-align: center;
          padding: 20px;
        }
        .empty-title {
          font-family: 'JetBrains Mono', monospace;
          font-size: 20px;
          font-weight: 700;
        }
        .empty-sub { color: var(--muted); font-size: 14px; max-width: 380px; }
        .starter-chips {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          max-width: 440px;
        }
        .starter-chip {
          text-align: left;
          background: var(--panel);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 13.5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .starter-chip:hover { border-color: var(--blue); }

        .msg-row { display: flex; }
        .msg-row.user { justify-content: flex-end; }
        .bubble {
          max-width: 78%;
          padding: 11px 15px;
          border-radius: 12px;
          font-size: 14.5px;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .bubble.user { background: var(--blue); color: #FFFFFF; border-radius: 12px 12px 2px 12px; }
        .bubble.assistant { background: var(--panel); border: 1px solid var(--border); border-radius: 12px 12px 12px 2px; }
        .bubble.assistant.error { border-color: rgba(226,89,75,0.4); }

        .console-stack { display: flex; flex-direction: column; gap: 8px; max-width: 78%; margin-top: 4px; }
        .console-card { background: #0A0E12; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
        .console-head { display: flex; align-items: center; gap: 5px; padding: 7px 10px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); }
        .console-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.15); }
        .console-label {
          margin-left: 6px;
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--muted);
        }
        .console-sql {
          margin: 0;
          padding: 10px 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--blue);
          white-space: pre-wrap;
          word-break: break-word;
        }

        .chart-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; max-width: 78%; margin-top: 4px; }
        .chart-title { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); margin-bottom: 8px; }

        .loading-row { display: flex; align-items: center; gap: 8px; color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 12px; }

        /* Input bar */
        .input-bar { padding: 16px 24px 20px; border-top: 1px solid var(--border); }
        .attached-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(42,92,222,0.1);
          border: 1px solid rgba(42,92,222,0.3);
          color: var(--blue);
          padding: 5px 9px;
          border-radius: 6px;
          font-size: 12px;
          margin-bottom: 8px;
        }
        .attached-chip button { background: none; border: none; color: var(--blue); cursor: pointer; display: flex; }
        .input-row { display: flex; gap: 10px; align-items: center; }
        .icon-btn {
          background: var(--panel);
          border: 1px solid var(--border);
          color: var(--muted);
          width: 42px;
          height: 42px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .icon-btn:hover { color: var(--text); border-color: var(--blue); }
        .text-input {
          flex: 1;
          background: var(--panel);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 14.5px;
          outline: none;
        }
        .text-input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(42,92,222,0.15); }
        .send-btn {
          background: var(--blue);
          border: none;
          color: #FFFFFF;
          width: 42px;
          height: 42px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        @media (max-width: 720px) {
          .sidebar { width: 76px; }
          .sidebar-header span, .session-item span, .conn-row span, .new-chat-btn span { display: none; }
        }
      `}</style>

      <div className="sidebar">
        <div className="sidebar-header">
          <Search size={16} color="#2A5CDE" />
          <span>
            <span className="wordmark-blue">BLUE</span>
            <span className="wordmark-white"> IS THE CLUE</span>
          </span>
        </div>
        <button className="new-chat-btn" onClick={handleNewChat}>
          <Plus size={14} /> <span>New chat</span>
        </button>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={"session-item" + (s.id === activeId ? " active" : "")}
              onClick={() => setActiveId(s.id)}
            >
              <MessageSquare size={13} />
              <span>{s.title}</span>
            </div>
          ))}
        </div>
        <div className="conn-status">
          <div className="conn-title">CONNECTED</div>
          <div className="conn-row">
            <span className="conn-dot on" />
            <span>Claude (claude-sonnet-5)</span>
          </div>
          <div className="conn-row">
            <span className="conn-dot on" />
            <span>Teradata Vantage</span>
          </div>
        </div>
      </div>

      <div className="main">
        <div className="main-header">
          <Sparkles size={14} /> {active?.title || "New chat"}
        </div>

        {(!active || active.messages.length === 0) ? (
          <div className="empty-state">
            <div className="empty-title">Ask me anything about your data</div>
            <div className="empty-sub">
              I can chat freely, query your connected Teradata Vantage database, analyze files you attach, and chart results.
            </div>
            <div className="starter-chips">
              {STARTER_PROMPTS.map((p, i) => (
                <button key={i} className="starter-chip" onClick={() => sendMessage(p)}>
                  <BarChart3 size={14} color="#2A5CDE" /> {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-body" ref={scrollRef}>
            {active.messages.map((m, i) => (
              <React.Fragment key={i}>
                <div className={"msg-row " + m.role}>
                  {m.role === "assistant" ? (
                    <div className={"bubble assistant" + (m.isError ? " error" : "")}>
                      {extractChartBlocks(m.content).map((part, pi) =>
                        part.type === "chart" ? (
                          <ChartBlock key={pi} spec={part.spec} />
                        ) : (
                          <span key={pi}>{part.content}</span>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="bubble user">{m.content}</div>
                  )}
                </div>
                {m.role === "assistant" && <QueryConsole queries={m.queries} />}
              </React.Fragment>
            ))}
            {loading && (
              <div className="loading-row">
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                Working on it…
              </div>
            )}
          </div>
        )}

        <div className="input-bar">
          {attachedFile && (
            <div className="attached-chip">
              <Paperclip size={12} /> {attachedFile.name} ({attachedFile.rowCount} rows)
              <button onClick={() => setAttachedFile(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <form
            className="input-row"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <button type="button" className="icon-btn" onClick={() => fileInputRef.current.click()} title="Attach a CSV">
              <Paperclip size={16} />
            </button>
            <input
              className="text-input"
              placeholder="Ask about your data, or anything else…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="send-btn" type="submit" disabled={loading || (!input.trim() && !attachedFile)}>
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
