require("dotenv").config();

const cors = require("cors");
const express = require("express");
const {
  chatWithWorkspaceAgent,
  getWorkspaceAgentHistory,
  workspaceRoot,
  frontendRoot,
  backendRoot,
} = require("./aiWorkspaceAgentService");

const app = express();
const PORT = Number(process.env.AGENT_SERVER_PORT || 8787);
const HOST = process.env.AGENT_SERVER_HOST || "127.0.0.1";

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    workspaceRoot,
    frontendRoot,
    backendRoot,
    provider: process.env.OPENAI_API_KEY ? "openai" : "codex",
    fastMode: "available",
  });
});

app.post("/ai/workspace-agent/chat", async (req, res) => {
  try {
    const result = await chatWithWorkspaceAgent(req.body || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error?.message || "Workspace agent request failed.",
    });
  }
});

app.get("/ai/workspace-agent/history", async (req, res) => {
  try {
    const result = await getWorkspaceAgentHistory(String(req.query.sessionId || "").trim() || undefined);
    res.json({ history: result });
  } catch (error) {
    res.status(500).json({
      error: error?.message || "Workspace agent history request failed.",
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[ai-agent] listening on http://${HOST}:${PORT}`);
});
