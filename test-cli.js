"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  collectFiles,
  lintFile,
  lintText,
  revisionFeedback,
  segmentsForFile,
} = require("./lib/linter.js");

const cli = path.join(__dirname, "bin", "slop-detector.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "slop-detector-"));
}

process.env.XDG_CONFIG_HOME = path.join(tempDir(), "config");

test("lintText returns linter-style locations and rule levels", () => {
  const text = "Normal first line.\nGreat question! Let us delve into this.";
  const diagnostics = lintText(text, { filename: "draft.md" });
  const chatbot = diagnostics.find((item) => item.ruleId === "chatbot-phrase");
  const vocabulary = diagnostics.find((item) => item.ruleId === "ai-vocabulary");

  assert.deepEqual(
    { line: chatbot.line, column: chatbot.column, level: chatbot.level, text: chatbot.text },
    { line: 2, column: 1, level: "error", text: "Great question" },
  );
  assert.equal(chatbot.instruction, "Remove canned assistant phrasing.");
  assert.equal(vocabulary.level, "warning");
  assert.equal(vocabulary.text, "delve");
});

test("rule configuration can disable or promote findings", () => {
  const diagnostics = lintText("Let us delve into a robust workflow.", {
    rules: { "ai-vocabulary": "error" },
  });
  assert.ok(diagnostics.length >= 2);
  assert.ok(diagnostics.every((item) => item.level === "error"));

  const disabled = lintText("Let us delve into a robust workflow.", {
    rules: { "ai-vocabulary": "off" },
  });
  assert.equal(disabled.length, 0);
});

test("Markdown scanning ignores fenced code but lints prose", () => {
  const text = [
    "Great question! We can delve into the prose.",
    "",
    "```text",
    "Great question! We can delve into generated output.",
    "```",
  ].join("\n");
  const diagnostics = lintText(text, {
    filename: "README.md",
    segments: segmentsForFile("README.md", text),
  });

  assert.equal(diagnostics.filter((item) => item.ruleId === "chatbot-phrase").length, 1);
  assert.equal(diagnostics.filter((item) => item.ruleId === "ai-vocabulary").length, 1);
  assert.ok(diagnostics.every((item) => item.line === 1));
});

test("HTML scanning checks visible text and content attributes but skips code and scripts", () => {
  const text = [
    '<main class="robust workflow" title="Unlock your full potential today">',
    "<p>Great question! This visible copy needs work.</p>",
    "<code>Great question! Let us delve into this.</code>",
    "<script>const copy = 'I hope this message finds you well';</script>",
    "</main>",
  ].join("\n");
  const diagnostics = lintText(text, {
    filename: "page.html",
    segments: segmentsForFile("page.html", text),
  });

  assert.ok(diagnostics.some((item) => item.ruleId === "puffery" && /Unlock/.test(item.text)));
  assert.ok(diagnostics.some((item) => item.ruleId === "chatbot-phrase" && item.line === 2));
  assert.ok(!diagnostics.some((item) => item.line === 3 || item.line === 4));
  assert.ok(!diagnostics.some((item) => item.text === "robust"));
});

test("source scanning checks comments, strings, and JSX text without linting identifiers", () => {
  const text = [
    "const robust = true;",
    "// Great question! This helper lets us delve into parsing.",
    "const label = \"Unlock your full potential today\";",
    "const view = <p>This product stands as a testament to our vision.</p>;",
  ].join("\n");
  const diagnostics = lintText(text, {
    filename: "page.tsx",
    segments: segmentsForFile("page.tsx", text),
  });

  assert.ok(diagnostics.some((item) => item.ruleId === "chatbot-phrase" && item.line === 2));
  assert.ok(diagnostics.some((item) => item.ruleId === "puffery" && item.line === 3));
  assert.ok(diagnostics.some((item) => item.ruleId === "puffery" && item.line === 4));
  assert.ok(!diagnostics.some((item) => item.text === "robust" && item.line === 1));
});

test("repository collection uses git files and excludes ignored content", () => {
  const directory = tempDir();
  spawnSync("git", ["init", "-q", directory]);
  fs.writeFileSync(path.join(directory, ".gitignore"), "ignored.md\n");
  fs.writeFileSync(path.join(directory, "README.md"), "Great question! This text needs revision.\n");
  fs.writeFileSync(path.join(directory, "deleted.md"), "Tracked, then deleted.\n");
  spawnSync("git", ["-C", directory, "add", "README.md", "deleted.md"]);
  fs.unlinkSync(path.join(directory, "deleted.md"));
  fs.writeFileSync(path.join(directory, "ignored.md"), "I hope this message finds you well.\n");
  fs.writeFileSync(path.join(directory, "routeTree.gen.ts"), "// Great question! Generated text.\n");
  fs.mkdirSync(path.join(directory, "node_modules"));
  fs.writeFileSync(path.join(directory, "node_modules", "copy.md"), "Let us delve into it.\n");
  const outside = path.join(tempDir(), "outside.md");
  fs.writeFileSync(outside, "I hope this message finds you well.\n");
  fs.symlinkSync(outside, path.join(directory, "linked.md"));

  const files = collectFiles([directory]).map((item) => path.basename(item.filename));
  assert.deepEqual(files, [".gitignore", "README.md"]);
  assert.ok(lintFile(path.join(directory, "README.md")).some((item) => item.ruleId === "chatbot-phrase"));
});

test("double-star ignore globs match root and nested files", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "docs"));
  fs.writeFileSync(path.join(directory, "README.md"), "Root prose.\n");
  fs.writeFileSync(path.join(directory, "docs", "guide.md"), "Nested prose.\n");
  fs.writeFileSync(path.join(directory, "notes.txt"), "Keep this file.\n");

  const files = collectFiles([directory], { ignore: ["**/*.md"] })
    .map((item) => path.relative(directory, item.filename));
  assert.deepEqual(files, ["notes.txt"]);
});

test("invalid config shapes produce actionable errors", () => {
  const directory = tempDir();
  fs.writeFileSync(path.join(directory, ".slopdetector.json"), JSON.stringify({ ignore: "dist/**" }));
  const result = spawnSync(process.execPath, [cli, "--format=json"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /"ignore" must be an array of strings/);
});

test("install-hooks configures every project-scoped agent and is idempotent", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".claude", "settings.json"), `${JSON.stringify({
    theme: "dark",
    hooks: {
      UserPromptSubmit: [{
        hooks: [
          { type: "command", command: "slop-detector hook claude-prompt-extra" },
          { type: "command", command: "slop-detector hook claude-prompt" },
        ],
      }],
    },
  }, null, 2)}\n`);
  fs.mkdirSync(path.join(directory, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".codex", "config.toml"), "model = \"test\"\n\n[features] # toggles\nhooks = false\n");
  fs.writeFileSync(path.join(directory, ".codex", "hooks.json"), `${JSON.stringify({
    hooks: {
      UserPromptSubmit: [{
        hooks: [{ type: "command", command: "slop-detector hook codex-prompt" }],
      }],
    },
  }, null, 2)}\n`);

  const args = [cli, "install-hooks", "--scope=project", "--agents=claude,codex,gemini,omp", "--format=json"];
  const first = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const output = JSON.parse(first.stdout);
  assert.equal(output.results.length, 4);
  assert.ok(output.results.every((item) => item.changed));

  const claude = JSON.parse(fs.readFileSync(path.join(directory, ".claude", "settings.json"), "utf8"));
  assert.equal(claude.theme, "dark");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, ".claude", "settings.json.slop-detector.bak"), "utf8")).theme,
    "dark",
  );
  assert.match(claude.hooks.Stop[0].hooks[0].command, /slop-detector\.js.*hook.*claude/);
  assert.equal(claude.hooks.UserPromptSubmit.length, 1);
  assert.equal(claude.hooks.UserPromptSubmit[0].hooks.length, 1);
  assert.match(claude.hooks.UserPromptSubmit[0].hooks[0].command, /claude-prompt-extra/);
  const codexConfig = fs.readFileSync(path.join(directory, ".codex", "config.toml"), "utf8");
  assert.match(codexConfig, /\[features\] # toggles/);
  assert.equal((codexConfig.match(/^\[features\]/gm) ?? []).length, 1);
  assert.match(codexConfig, /hooks = true/);
  const codexHooks = JSON.parse(fs.readFileSync(path.join(directory, ".codex", "hooks.json"), "utf8")).hooks;
  assert.ok(codexHooks.Stop);
  assert.equal(codexHooks.UserPromptSubmit, undefined);
  assert.ok(JSON.parse(fs.readFileSync(path.join(directory, ".gemini", "settings.json"), "utf8")).hooks.AfterAgent);
  const omp = fs.readFileSync(path.join(directory, ".omp", "extensions", "slop-detector.ts"), "utf8");
  assert.match(omp, /pi\.on\("session_stop"/);
  assert.match(omp, /pi\.on\("before_agent_start"/);

  const second = spawnSync(process.execPath, args, { cwd: directory, encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  assert.ok(JSON.parse(second.stdout).results.every((item) => !item.changed));
  const reinstalledClaude = JSON.parse(fs.readFileSync(path.join(directory, ".claude", "settings.json"), "utf8"));
  assert.equal(reinstalledClaude.hooks.Stop.length, 1);
  assert.equal(reinstalledClaude.hooks.UserPromptSubmit.length, 1);
  assert.match(reinstalledClaude.hooks.UserPromptSubmit[0].hooks[0].command, /prompt-extra/);
});

test("install-hooks does not load unrelated lint configuration", () => {
  const directory = tempDir();
  fs.writeFileSync(path.join(directory, ".slopdetector.json"), "not json");
  const result = spawnSync(process.execPath, [
    cli,
    "install-hooks",
    "--scope=project",
    "--agents=claude",
    "--format=json",
  ], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].agent, "claude");
});

test("project scope defaults to the four project-capable agents", () => {
  const directory = tempDir();
  const result = spawnSync(process.execPath, [
    cli,
    "install-hooks",
    "--scope=project",
    "--format=json",
  ], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).results.map((item) => item.agent),
    ["claude", "codex", "gemini", "omp"],
  );
  assert.equal(fs.existsSync(path.join(directory, ".ghost", "hooks.json")), false);
});

test("install-hooks dry run does not create files", () => {
  const directory = tempDir();
  const result = spawnSync(process.execPath, [cli, "install-hooks", "--scope=project", "--agents=claude,omp", "--dry-run", "--format=json"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(directory, ".claude", "settings.json")), false);
  assert.equal(fs.existsSync(path.join(directory, ".omp", "extensions", "slop-detector.ts")), false);
});

test("install-hooks refuses to overwrite a non-owned OMP extension", () => {
  const directory = tempDir();
  const extension = path.join(directory, ".omp", "extensions", "slop-detector.ts");
  fs.mkdirSync(path.dirname(extension), { recursive: true });
  fs.writeFileSync(extension, "export default function custom() {}\n");
  const result = spawnSync(process.execPath, [
    cli,
    "install-hooks",
    "--scope=project",
    "--agents=omp",
  ], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to overwrite/);
  assert.equal(fs.readFileSync(extension, "utf8"), "export default function custom() {}\n");
});

test("install-hooks configures Ghost's trusted user hook file", () => {
  const directory = tempDir();
  const configHome = path.join(directory, "config");
  const ghostConfig = path.join(configHome, "ghost", "hooks.json");
  fs.mkdirSync(path.dirname(ghostConfig), { recursive: true });
  fs.writeFileSync(ghostConfig, `${JSON.stringify({
    hooks: {
      before_prompt: [{
        hooks: [{ type: "command", command: "slop-detector hook ghost-prompt" }],
      }],
    },
  }, null, 2)}\n`);
  const result = spawnSync(process.execPath, [cli, "install-hooks", "--scope=user", "--agents=ghost", "--format=json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: configHome },
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(configHome, "ghost", "hooks.json"), "utf8"));
  const command = config.hooks.session_stop[0].hooks[0].command;
  assert.match(command, /hook.*ghost/);
  assert.doesNotMatch(command, /--max-warnings/);
  assert.equal(config.hooks.before_prompt, undefined);
});

test("install-hooks validates every destination before writing any", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, ".codex"));
  fs.writeFileSync(path.join(directory, ".codex", "hooks.json"), "not json");
  const result = spawnSync(process.execPath, [
    cli,
    "install-hooks",
    "--scope=user",
    "--agents=claude,codex",
  ], {
    encoding: "utf8",
    env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: path.join(directory, ".config") },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Could not parse/);
  assert.equal(fs.existsSync(path.join(directory, ".claude", "settings.json")), false);
});

test("install-hooks rejects agents without blocking final-output hooks", () => {
  for (const agent of ["pi", "opencode"]) {
    const result = spawnSync(process.execPath, [cli, "install-hooks", `--agents=${agent}`], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`Unsupported agent: ${agent}`));
  }
});

test("agent mode emits deterministic JSON revision feedback and fails on errors", () => {
  const result = spawnSync(process.execPath, [cli, "agent", "--format", "json"], {
    input: "Great question! I'd be happy to delve into this topic.",
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.ok(output.summary.errors >= 1);
  assert.match(output.revisionFeedback, /Remove canned assistant phrasing/);
  assert.doesNotMatch(output.revisionFeedback, /Great question/);
  assert.match(output.revisionFeedback, /Return only the revision/);
});

test("agent mode passes clean output without requesting a model revision", () => {
  const result = spawnSync(process.execPath, [cli, "agent", "--format=json"], {
    input: "hey, the build is done. tests pass and i pushed the branch.",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.revisionFeedback, "");
});

test("agent mode rejects unbounded stdin before linting", () => {
  const result = spawnSync(process.execPath, [cli, "agent", "--format=json"], {
    input: "a".repeat(1024 * 1024 + 1),
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /1 MB limit/);
});

test("agent mode ignores slop examples inside fenced code", () => {
  const result = spawnSync(process.execPath, [cli, "agent", "--format=json"], {
    input: "Here is the exact fixture:\n\n```text\nGreat question! Let us delve into this.\n```",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test("Claude and Codex stop hooks block slop with model-visible feedback", () => {
  for (const runner of ["claude", "codex"]) {
    const result = spawnSync(process.execPath, [cli, "hook", runner], {
      input: JSON.stringify({
        last_assistant_message: "Great question! Let us delve into this.",
        stop_hook_active: false,
      }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /Remove canned assistant phrasing/);
  }
});

test("Gemini AfterAgent hook denies slop and requests a retry", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "gemini"], {
    input: JSON.stringify({
      prompt_response: "I hope this message finds you well. Let us delve into it.",
      stop_hook_active: false,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "deny");
  assert.match(output.reason, /Remove canned assistant phrasing/);
});

test("agent hooks stop instead of looping after a failed revision", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "claude"], {
    input: JSON.stringify({
      last_assistant_message: "Great question! Let us delve into this.",
      stop_hook_active: true,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, false);
  assert.match(output.stopReason, /Remove canned assistant phrasing/);
});

test("Ghost hook reads structured assistant messages and returns compact feedback", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "ghost", "--max-warnings=0"], {
    input: JSON.stringify({
      last_assistant_message: {
        role: "assistant",
        content: [{ type: "text", text: "The build is robust enough." }],
      },
      stop_hook_active: false,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /Use plain, specific wording/);
  assert.doesNotMatch(output.reason, /robust/);
});

test("agent hooks group repeated warning notifications", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "claude"], {
    input: JSON.stringify({
      last_assistant_message: "One clause — then another sentence — and a final thought — all packed closely together for this density check.",
      stop_hook_active: false,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /em-dash-density: "—" \(3 occurrences\)/);
  assert.equal((output.systemMessage.match(/em-dash-density/g) ?? []).length, 1);
});

test("prompt hooks fail open without loading lint configuration", () => {
  const directory = tempDir();
  fs.writeFileSync(path.join(directory, ".slopdetector.json"), "not json");
  const result = spawnSync(process.execPath, [cli, "hook", "claude-prompt"], {
    cwd: directory,
    input: JSON.stringify({ session_id: "no-warning", prompt: "Continue" }),
    encoding: "utf8",
    env: { ...process.env, XDG_STATE_HOME: path.join(directory, "state") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test("Claude, Codex, and Ghost warnings do not create next-prompt context", () => {
  for (const runner of ["claude", "codex", "ghost"]) {
    const directory = tempDir();
    const env = { ...process.env, XDG_STATE_HOME: directory };
    const warning = spawnSync(process.execPath, [cli, "hook", runner], {
      input: JSON.stringify({
        session_id: `${runner}-session`,
        last_assistant_message: "The new build feels robust enough for a quick test today.",
        stop_hook_active: false,
      }),
      encoding: "utf8",
      env,
    });
    assert.equal(warning.status, 0, warning.stderr);
    assert.match(JSON.parse(warning.stdout).systemMessage, /ai-vocabulary/);

    const nextPrompt = spawnSync(process.execPath, [cli, "hook", `${runner}-prompt`], {
      input: JSON.stringify({ session_id: `${runner}-session`, prompt: "Continue" }),
      encoding: "utf8",
      env,
    });
    assert.equal(nextPrompt.status, 0, nextPrompt.stderr);
    assert.deepEqual(JSON.parse(nextPrompt.stdout), {});
  }
});

test("OMP prompt hooks use direct additionalContext", () => {
  const directory = tempDir();
  const env = { ...process.env, XDG_STATE_HOME: directory };
  spawnSync(process.execPath, [cli, "hook", "omp"], {
    input: JSON.stringify({
      session_id: "omp-session",
      last_assistant_message: "The new build feels robust enough for a quick test today.",
      stop_hook_active: false,
    }),
    encoding: "utf8",
    env,
  });
  const result = spawnSync(process.execPath, [cli, "hook", "omp-prompt"], {
    input: JSON.stringify({ session_id: "omp-session", prompt: "Continue" }),
    encoding: "utf8",
    env,
  });
  assert.equal(JSON.parse(result.stdout).additionalContext, "Style: Use plain, specific wording.");
});

test("agent hooks report warning spans without forcing a revision", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "claude"], {
    input: JSON.stringify({
      last_assistant_message: "The new build feels robust enough for a quick test today.",
      stop_hook_active: false,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.match(output.systemMessage, /ai-vocabulary: "robust"/);
  assert.equal(output.decision, undefined);
});

test("clean agent hook output is allowed", () => {
  const result = spawnSync(process.execPath, [cli, "hook", "claude"], {
    input: JSON.stringify({
      last_assistant_message: "The build is done. Tests pass.",
      stop_hook_active: false,
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test("revision feedback includes only supplied violations", () => {
  const feedback = revisionFeedback([{
    level: "error",
    ruleId: "chatbot-phrase",
    instruction: "Remove canned assistant phrasing.",
    text: "Great question",
    message: "Canonical assistant phrasing.",
  }]);
  assert.equal(
    feedback,
    "Revise style only. Remove canned assistant phrasing. Preserve meaning and required facts. Return only the revision.",
  );
});
