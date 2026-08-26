"use strict";

const {
  lintText,
  revisionFeedback,
  segmentsForFile,
  warningNudge,
} = require("./linter.js");
const { consumeSessionNudge, saveSessionNudge } = require("./session-nudges.js");

const STOP_RUNNERS = new Set(["claude", "codex", "gemini", "ghost", "omp"]);
const PROMPT_RUNNERS = new Set([
  "claude-prompt",
  "codex-prompt",
  "ghost-prompt",
  "omp-prompt",
]);
const DIRECT_CONTEXT_RUNNERS = new Set(["ghost-prompt", "omp-prompt"]);
const NUDGE_STOP_RUNNERS = new Set(["omp"]);
const HOOK_RUNNERS = [...STOP_RUNNERS, ...PROMPT_RUNNERS];

function promptNudgeOutput(runner, input) {
  let nudge = "";
  try {
    nudge = consumeSessionNudge(input.session_id);
  } catch {
    // Advisory state must never block a user prompt.
  }
  if (!nudge) return {};
  if (DIRECT_CONTEXT_RUNNERS.has(runner)) return { additionalContext: nudge };
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: nudge,
    },
  };
}

function assistantText(runner, input) {
  const raw = runner === "gemini" ? input.prompt_response : input.last_assistant_message;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw?.content)) {
    return raw.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  const field = runner === "gemini" ? "prompt_response" : "last_assistant_message";
  throw new Error(`hook input is missing ${field}`);
}

function warningMessage(warnings) {
  const grouped = new Map();
  for (const warning of warnings) {
    const key = `${warning.ruleId}\0${warning.text}`;
    const current = grouped.get(key) ?? {
      ruleId: warning.ruleId,
      text: warning.text,
      count: 0,
    };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map((item) => `${item.ruleId}: ${JSON.stringify(item.text)}${item.count > 1 ? ` (${item.count} occurrences)` : ""}`)
    .join("; ");
}

function stopAfterFailedRevision(runner, feedback) {
  const common = { systemMessage: "Slop Detector stopped after one failed revision." };
  return runner === "gemini"
    ? { continue: false, reason: feedback, ...common }
    : { continue: false, stopReason: feedback, ...common };
}

function blockOutput(runner, feedback) {
  return runner === "gemini"
    ? { decision: "deny", reason: feedback }
    : { decision: "block", reason: feedback };
}

function runAgentHook({ runner, input, maxWarnings, rules }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("hook input must be a JSON object");
  }
  if (!STOP_RUNNERS.has(runner) && !PROMPT_RUNNERS.has(runner)) {
    throw new Error(`hook requires one of: ${HOOK_RUNNERS.join(", ")}`);
  }
  if (PROMPT_RUNNERS.has(runner)) return promptNudgeOutput(runner, input);

  const text = assistantText(runner, input);
  const diagnostics = lintText(text, {
    filename: "<agent-output>",
    rules,
    segments: segmentsForFile("agent-output.md", text),
  });
  const errors = diagnostics.filter((item) => item.level === "error");
  const warnings = diagnostics.filter((item) => item.level === "warning");
  const warningsFail = maxWarnings !== undefined && warnings.length > maxWarnings;

  if (errors.length === 0 && !warningsFail) {
    if (warnings.length === 0) return {};
    if (NUDGE_STOP_RUNNERS.has(runner)) {
      try {
        saveSessionNudge(input.session_id, warningNudge(warnings));
      } catch {
        // The visible warning remains useful when advisory state cannot be saved.
      }
    }
    return { systemMessage: `Slop Detector warnings: ${warningMessage(warnings)}` };
  }

  const feedback = revisionFeedback(diagnostics);
  return input.stop_hook_active === true
    ? stopAfterFailedRevision(runner, feedback)
    : blockOutput(runner, feedback);
}

module.exports = {
  HOOK_RUNNERS,
  runAgentHook,
};
