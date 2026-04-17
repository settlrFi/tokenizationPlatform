const { execFile, spawn } = require("node:child_process");
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
const SESSION_MEMORY_LIMIT = 280;

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

function sanitizeCodexOutput(value) {
  return String(value ?? "")
    .replace(/^Reading additional input from stdin\.\.\.\s*$/gim, "")
    .replace(/\s+/g, " ")
    .trim();
}

function commandLooksBlocked(command) {
  return blockedCommandPatterns.some((pattern) => pattern.test(command));
}

function commandNeedsWriteAccess(command) {
  return writeCommandPatterns.some((pattern) => pattern.test(command));
}

async function loadAgentInstructionFiles() {
  if (agentInstructionCache) return agentInstructionCache;

  const filenames = ["SOUL.md", "USER.md", "MEMORY.md"];
  const sections = await Promise.all(
    filenames.map(async (filename) => {
      try {
        const content = (await fs.readFile(path.join(workspaceRoot, filename), "utf8")).trim();
        return content || "";
      } catch {
        return "";
      }
    })
  );

  agentInstructionCache = sections
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
  return agentInstructionCache;
}

function compactText(value, limit = 140) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function extractHints(text) {
  const raw = String(text ?? "");
  const fileMatches = raw.match(/[A-Za-z0-9_./-]+\.(sol|js|jsx|ts|tsx|md|json)/g) || [];
  const addressMatches = raw.match(/0x[a-fA-F0-9]{40}/g) || [];
  const commandMatches = raw.match(/\b(make [a-zA-Z0-9:_-]+|npm run [a-zA-Z0-9:_-]+|npx [a-zA-Z0-9:_-]+)/g) || [];
  return Array.from(new Set([...fileMatches, ...addressMatches.slice(0, 2), ...commandMatches.slice(0, 2)]))
    .slice(0, 6)
    .join(" ");
}

function updateSessionMemory(currentMemory, userMessage, assistantMessage) {
  const parts = [
    compactText(currentMemory, 80),
    compactText(userMessage, 80),
    extractHints(userMessage),
    compactText(assistantMessage, 80),
    extractHints(assistantMessage),
  ]
    .filter(Boolean)
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim();

  return parts.slice(-SESSION_MEMORY_LIMIT);
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
    "You are Seta, the embedded workspace/chat agent for this tokenization dApp.",
    `Workspace root: ${workspaceRoot}`,
    "Repo: Solidity + Hardhat + React/Vite dApp for tokenization.",
    "Answer directly and briefly.",
    mode === "fast" ? "Fast mode: answer with the minimum useful response and avoid deep repo exploration unless explicitly requested." : "",
    allowWrite
      ? "Write-capable shell commands are allowed. Avoid destructive actions."
      : "Stay read-only: inspect, explain, build, diagnose.",
    "No chain-of-thought. No filler.",
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

async function runCodexCommand(args, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: workspaceRoot,
      env: codexExecEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const error = new Error("Codex CLI timed out.");
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      error.stdout = stdout;
      error.stderr = stderr;
      finish(error);
    });
    child.on("close", (code) => {
      const output = {
        stdout: sanitizeCodexOutput(stdout),
        stderr: sanitizeCodexOutput(stderr),
        code: code ?? 1,
      };
      if (code === 0) {
        finish(null, output);
        return;
      }
      const error = new Error(output.stderr || output.stdout || `Codex CLI exited with code ${output.code}.`);
      error.stdout = output.stdout;
      error.stderr = output.stderr;
      error.code = output.code;
      finish(error);
    });
  });
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

async function buildCodexPrompt(sessionState, userMessage, allowWrite, mode = "smart") {
  const memory = mode === "fast" ? "" : compactText(sessionState?.memory || "", 220);
  const instructionBundle = mode === "fast" ? "" : await loadAgentInstructionFiles();

  return [
    "You are Seta, the embedded workspace/chat agent for this tokenization dApp.",
    `Workspace root: ${workspaceRoot}`,
    allowWrite
      ? "Write-capable shell work is allowed, but do not use destructive commands."
      : "Stay in read-only mode: inspect, explain, build, and diagnose only.",
    "Be concrete. Help with dApp flows and repo changes.",
    "No chain-of-thought. No filler.",
    mode === "fast" ? "Fast mode: keep the answer minimal and avoid heavy inspection unless explicitly requested." : "",
    instructionBundle,
    memory ? `Session memory:\n${memory}` : "",
    `USER: ${userMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callCodexCli(sessionState, userMessage, allowWrite, model, mode = "smart") {
  const loggedIn = await getCodexLoginStatus();
  if (!loggedIn) {
    throw new Error(
        "Codex CLI is not logged in for the backend OS user. Run `codex login --device-auth` in the same terminal user, then restart the Seta backend."
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-agent-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const prompt = await buildCodexPrompt(sessionState, userMessage, allowWrite, mode);
  const args = ["exec", "-C", workspaceRoot, "--skip-git-repo-check", "-o", outputFile];

  if (model !== "codex-default") args.push("-m", model);

  if (allowWrite) args.push("--full-auto");
  else args.push("--sandbox", "read-only");

  args.push(prompt);

  try {
    const result = await runCodexCommand(args, mode === "fast" ? CODEX_FAST_TIMEOUT_MS : CODEX_TIMEOUT_MS);

    let finalText = "";
    try {
      finalText = (await fs.readFile(outputFile, "utf8")).trim();
    } catch (readError) {
      if (readError?.code !== "ENOENT") throw readError;
    }

    if (!finalText) {
      finalText = trimOutput(result.stdout || result.stderr || "");
    }

    if (!finalText) {
      throw new Error(
        "Codex completed without returning a final message. Set OPENAI_API_KEY for the backend or verify the local Codex CLI version/output mode."
      );
    }
    return finalText;
  } catch (error) {
    const reason = trimOutput(sanitizeCodexOutput(error.stderr || error.message || error.stdout));
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

async function persistAgentTurn({ sessionId, provider, model, allowWrite, userMessage, assistantMessage, steps, memory }) {
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
    memory,
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

  const sessionState = sessions.get(sessionId) ?? { history: [], memory: "" };
  const history = Array.isArray(sessionState.history) ? sessionState.history : [];

  if (provider === "codex") {
    const finalMessage = await callCodexCli(sessionState, userMessage, allowWrite, model, requestedMode);
    const nextHistory =
      requestedMode === "fast"
        ? []
        : [...history, { role: "user", content: userMessage }, { role: "assistant", content: finalMessage }].slice(-SESSION_TURN_LIMIT);
    const nextMemory = updateSessionMemory(sessionState.memory, userMessage, finalMessage);
    sessions.set(sessionId, { history: nextHistory, memory: nextMemory });

    await persistAgentTurn({
      sessionId,
      provider,
      model,
      allowWrite,
      userMessage,
      assistantMessage: finalMessage,
      steps: [],
      memory: nextMemory,
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
    ...(requestedMode === "fast"
      ? []
      : sessionState.memory
          ? [{ role: "system", content: `Session memory: ${compactText(sessionState.memory, 220)}` }]
          : []),
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
      throw new Error("OpenAI did not return a Seta message.");
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
    finalMessage = "Seta stopped without a final answer.";
  }

  const nextHistory =
    requestedMode === "fast"
      ? []
      : [...history, { role: "user", content: userMessage }, { role: "assistant", content: finalMessage }].slice(-SESSION_TURN_LIMIT);
  const nextMemory = updateSessionMemory(sessionState.memory, userMessage, finalMessage);
  sessions.set(sessionId, { history: nextHistory, memory: nextMemory });

  await persistAgentTurn({
    sessionId,
    provider,
    model,
    allowWrite,
    userMessage,
    assistantMessage: finalMessage,
    steps,
    memory: nextMemory,
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
