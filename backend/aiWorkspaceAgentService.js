const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const TOOL_MAX_ITERATIONS = 2;
const SHELL_TIMEOUT_MS = 15_000;
const CODEX_TIMEOUT_MS = 90_000;
const CODEX_FAST_TIMEOUT_MS = 20_000;
const SHELL_OUTPUT_LIMIT = 8_000;
const SESSION_TURN_LIMIT = 12;

const sessions = new Map();
let agentInstructionCache = null;

const workspaceRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(workspaceRoot, "dApp");
const backendRoot = path.join(workspaceRoot, "backend");
const chatHistoryDir = path.join(workspaceRoot, "data", "ai-agent-history");

const userHome = os.homedir();
const codexHome = path.join(userHome, ".codex");
const codexExecEnv = {
  ...process.env,
  HOME: userHome,
  CODEX_HOME: codexHome,
};

const blockedCommandPatterns = [
  /\brm\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+checkout\s+--/i,
  /\bgit\s+clean\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bpoweroff\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\b/i,
  /\bcurl\b.*\|\s*(bash|sh)\b/i,
  /\bwget\b.*\|\s*(bash|sh)\b/i,
];

const writeCommandPatterns = [
  />/,
  /\btee\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bnpm\s+install\b/i,
  /\bpnpm\s+install\b/i,
  /\byarn\s+add\b/i,
  /\bsed\s+-i\b/i,
  /\bperl\s+-i\b/i,
  /\becho\s+.+>\s*/i,
];

function trimOutput(value) {
  const text = String(value ?? "").trim();
  if (text.length <= SHELL_OUTPUT_LIMIT) return text;
  return `${text.slice(0, SHELL_OUTPUT_LIMIT)}\n...[truncated]`;
}

function commandLooksBlocked(command) {
  return blockedCommandPatterns.some((pattern) => pattern.test(command));
}

function commandNeedsWriteAccess(command) {
  return writeCommandPatterns.some((pattern) => pattern.test(command));
}

async function loadAgentInstructionFiles() {
  if (agentInstructionCache) return agentInstructionCache;

  const filenames = ["SOUL.md", "USER.md", "MEMORY.md", "AGENTS.md", "TOOLS.md", "DAPP_RUNBOOK.md"];
  const sections = await Promise.all(
    filenames.map(async (filename) => {
      try {
        const content = (await fs.readFile(path.join(workspaceRoot, filename), "utf8")).trim();
        return content ? `### ${filename}\n${content}` : "";
      } catch {
        return "";
      }
    })
  );

  agentInstructionCache = sections.filter(Boolean).join("\n\n");
  return agentInstructionCache;
}

async function runShellCommand(command, allowWrite) {
  const normalized = String(command ?? "").trim();
  if (!normalized) {
    return {
      command,
      cwd: workspaceRoot,
      stdout: "",
      stderr: "Empty shell command.",
      exitCode: 1,
      blocked: true,
    };
  }

  if (commandLooksBlocked(normalized)) {
    return {
      command,
      cwd: workspaceRoot,
      stdout: "",
      stderr: "Command blocked by workspace safety policy.",
      exitCode: 1,
      blocked: true,
    };
  }

  if (!allowWrite && commandNeedsWriteAccess(normalized)) {
    return {
      command,
      cwd: workspaceRoot,
      stdout: "",
      stderr: "Write-capable shell command blocked because write mode is disabled.",
      exitCode: 1,
      blocked: true,
    };
  }

  try {
    const result = await execFileAsync("bash", ["-lc", normalized], {
      cwd: workspaceRoot,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    return {
      command,
      cwd: workspaceRoot,
      stdout: trimOutput(result.stdout),
      stderr: trimOutput(result.stderr),
      exitCode: 0,
      blocked: false,
    };
  } catch (error) {
    return {
      command,
      cwd: workspaceRoot,
      stdout: trimOutput(error.stdout),
      stderr: trimOutput(error.stderr || error.message),
      exitCode: typeof error.code === "number" ? error.code : 1,
      blocked: false,
    };
  }
}

async function getSystemPrompt(allowWrite, mode = "smart") {
  const instructionBundle = mode === "fast" ? "" : await loadAgentInstructionFiles();
  return [
    "You are the embedded workspace/chat agent inside this tokenization dApp.",
    `Workspace root: ${workspaceRoot}`,
    `Frontend path: ${frontendRoot}`,
    `Backend path: ${backendRoot}`,
    "This repo contains Solidity contracts, a React dApp, Hardhat scripts, and Uniswap v4 integration.",
    "Prioritize concrete guidance for operating the dApp and making safe repo changes.",
    "Do not expose chain-of-thought, hidden reasoning, or thinking steps.",
    "Do not start with filler like 'Let me think' or 'I'm analyzing'. Answer directly.",
    "Keep answers short by default unless the user explicitly asks for detail.",
    mode === "fast" ? "Fast mode: answer with the minimum useful response and avoid deep repo exploration unless explicitly requested." : "",
    allowWrite
      ? "Write-capable shell commands are allowed, but you must still avoid destructive actions and describe what changed."
      : "Write-capable shell commands are disabled. Restrict yourself to inspection, builds, typechecks, and diagnostics.",
    "When asked about usage, explain exact role-based flows in the dApp.",
    "When asked to modify code, stay anchored to the real workspace files.",
    instructionBundle,
  ].join("\n");
}

async function getCodexLoginStatus() {
  try {
    const result = await execFileAsync("codex", ["login", "status"], {
      cwd: workspaceRoot,
      env: codexExecEnv,
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
    return text.includes("logged in");
  } catch {
    return false;
  }
}

async function callOpenAi(messages, model, tools, mode = "smart") {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured on the backend.");
  }

  const body = {
    model,
    messages,
  };

  if (mode === "fast") {
    body.max_tokens = 220;
    body.temperature = 0.2;
  }

  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `OpenAI chat completion failed (${response.status})`;
    throw new Error(reason);
  }

  return payload;
}

async function buildCodexPrompt(history, userMessage, allowWrite, mode = "smart") {
  const transcript =
    mode === "fast"
      ? ""
      : history
          .slice(-10)
          .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
          .join("\n\n");
  const instructionBundle = mode === "fast" ? "" : await loadAgentInstructionFiles();

  return [
    "You are the embedded workspace/chat agent inside this tokenization dApp.",
    `Workspace root: ${workspaceRoot}`,
    `Frontend path: ${frontendRoot}`,
    `Backend path: ${backendRoot}`,
    allowWrite
      ? "Write-capable shell work is allowed, but do not use destructive commands."
      : "Stay in read-only mode: inspect, explain, build, and diagnose only.",
    "Be concrete. Help with the dApp operational flows and with Solidity/frontend code changes.",
    "Do not expose chain-of-thought, hidden reasoning, or thinking steps.",
    "Do not start with filler like 'Let me think' or 'I'm analyzing'. Answer directly and briefly.",
    mode === "fast" ? "Fast mode: keep the answer minimal and avoid heavy inspection unless explicitly requested." : "",
    instructionBundle,
    transcript ? `Conversation so far:\n${transcript}` : "",
    `USER: ${userMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callCodexCli(history, userMessage, allowWrite, model, mode = "smart") {
  const loggedIn = await getCodexLoginStatus();
  if (!loggedIn) {
    throw new Error(
      "Codex CLI is not logged in for the backend OS user. Run `codex login --device-auth` in the same terminal user, then restart the agent server."
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-agent-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const prompt = await buildCodexPrompt(history, userMessage, allowWrite, mode);
  const args = ["exec", "-C", workspaceRoot, "--skip-git-repo-check", "-o", outputFile];

  if (model !== "codex-default") args.push("-m", model);

  if (allowWrite) args.push("--full-auto");
  else args.push("--sandbox", "read-only");

  args.push(prompt);

  try {
    await execFileAsync("codex", args, {
      cwd: workspaceRoot,
      env: codexExecEnv,
      timeout: mode === "fast" ? CODEX_FAST_TIMEOUT_MS : CODEX_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const finalText = (await fs.readFile(outputFile, "utf8")).trim();
    if (!finalText) throw new Error("Codex completed without returning a final message.");
    return finalText;
  } catch (error) {
    const reason = trimOutput(error.stderr || error.message || error.stdout);
    throw new Error(reason || "Codex CLI request failed.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveProvider() {
  return process.env.OPENAI_API_KEY ? "openai" : "codex";
}

function resolveAgentModel(provider, requestedModel) {
  const requested = String(requestedModel ?? "").trim();

  if (provider === "codex") {
    if (requested === "fast" || requested === "smart") return "codex-default";
    if (!requested) return "codex-default";
    return requested.startsWith("codex") ? requested : "codex-default";
  }

  if (requested === "fast") return "gpt-5-nano";
  if (requested === "smart") return "gpt-5-mini";
  return requested || process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || "gpt-5-nano";
}

async function persistAgentTurn({ sessionId, provider, model, allowWrite, userMessage, assistantMessage, steps }) {
  await fs.mkdir(chatHistoryDir, { recursive: true });
  const targetFile = path.join(chatHistoryDir, `${sessionId}.jsonl`);
  const row = {
    timestamp: new Date().toISOString(),
    provider,
    model,
    allowWrite,
    userMessage,
    assistantMessage,
    steps,
  };
  await fs.appendFile(targetFile, `${JSON.stringify(row)}\n`, "utf8");
}

function extractAssistantText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text ?? "")
      .join("\n")
      .trim();
  }
  return "";
}

async function chatWithWorkspaceAgent(request) {
  const sessionId = String(request?.sessionId ?? "").trim() || randomUUID();
  const userMessage = String(request?.message ?? "").trim();
  const allowWrite = request?.allowWrite === true;
  const provider = resolveProvider();
  const requestedMode = String(request?.model ?? "").trim() === "fast" ? "fast" : "smart";
  const model = resolveAgentModel(provider, request?.model);

  if (!userMessage) {
    throw new Error("Agent message is required.");
  }

  const history = sessions.get(sessionId) ?? [];

  if (provider === "codex") {
    const finalMessage = await callCodexCli(history, userMessage, allowWrite, model, requestedMode);
    const nextHistory =
      requestedMode === "fast"
        ? []
        : [...history, { role: "user", content: userMessage }, { role: "assistant", content: finalMessage }].slice(-SESSION_TURN_LIMIT);
    sessions.set(sessionId, nextHistory);

    await persistAgentTurn({
      sessionId,
      provider,
      model,
      allowWrite,
      userMessage,
      assistantMessage: finalMessage,
      steps: [],
    });

    return {
      sessionId,
      message: finalMessage,
      steps: [],
      workspaceRoot,
      frontendRoot,
      backendRoot,
      model,
      provider,
    };
  }

  const messages = [
    { role: "system", content: await getSystemPrompt(allowWrite, requestedMode) },
    ...(requestedMode === "fast" ? [] : history.slice(-10).map((turn) => ({ role: turn.role, content: turn.content }))),
    { role: "user", content: userMessage },
  ];

  const tools = allowWrite && requestedMode !== "fast"
    ? [
        {
          type: "function",
          function: {
            name: "run_shell",
            description: "Run a shell command inside the repository workspace root.",
            parameters: {
              type: "object",
              properties: {
                command: {
                  type: "string",
                  description: "A bash command to execute in the workspace root.",
                },
              },
              required: ["command"],
              additionalProperties: false,
            },
          },
        },
      ]
    : [];

  const steps = [];
  let finalMessage = "";

  for (let iteration = 0; iteration < TOOL_MAX_ITERATIONS; iteration += 1) {
    const completion = await callOpenAi(messages, model, tools, requestedMode);
      const assistantMessage = completion?.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new Error("OpenAI did not return an assistant message.");
    }

    if (assistantMessage.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: extractAssistantText(assistantMessage.content),
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall?.function?.name !== "run_shell") continue;

        let command = "";
        try {
          const parsed = JSON.parse(toolCall.function.arguments || "{}");
          command = String(parsed.command ?? "");
        } catch {
          command = "";
        }

        const step = await runShellCommand(command, allowWrite);
        steps.push(step);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(step),
        });
      }

      continue;
    }

    finalMessage = extractAssistantText(assistantMessage.content) || "No response content returned.";
    break;
  }

  if (!finalMessage) {
    finalMessage = "The workspace agent stopped without a final answer.";
  }

  const nextHistory =
    requestedMode === "fast"
      ? []
      : [...history, { role: "user", content: userMessage }, { role: "assistant", content: finalMessage }].slice(-SESSION_TURN_LIMIT);
  sessions.set(sessionId, nextHistory);

  await persistAgentTurn({
    sessionId,
    provider,
    model,
    allowWrite,
    userMessage,
    assistantMessage: finalMessage,
    steps,
  });

  return {
    sessionId,
    message: finalMessage,
    steps,
    workspaceRoot,
    frontendRoot,
    backendRoot,
    model,
    provider,
    mode: requestedMode,
  };
}

async function getWorkspaceAgentHistory(sessionId) {
  if (!sessionId) return null;
  const targetFile = path.join(chatHistoryDir, `${sessionId}.jsonl`);
  let content = "";

  try {
    content = await fs.readFile(targetFile, "utf8");
  } catch {
    return null;
  }

  const turns = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return {
    sessionId,
    turns,
    workspaceRoot,
    frontendRoot,
    backendRoot,
  };
}

module.exports = {
  chatWithWorkspaceAgent,
  getWorkspaceAgentHistory,
  workspaceRoot,
  frontendRoot,
  backendRoot,
};
