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
const temporaryDirectories = [];

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slop-detector-"));
  temporaryDirectories.push(directory);
  return directory;
}

test.after(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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
