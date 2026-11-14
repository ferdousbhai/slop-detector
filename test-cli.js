"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  collectFiles,
  lintFileResult,
  lintText,
  segmentsForFile,
} = require("./lib/linter.js");

const lintFile = (filename) => lintFileResult(filename).diagnostics;

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

test("Markdown list items are separate blocks, as <li> is in the browser", () => {
  const text = [
    "The extension can:",
    "",
    "- underline findings without wrapping or recoloring page text;",
    "- check pasted drafts inside its own popup window;",
    "- check selected text from the right-click context menu; and",
    "- show the page finding count on its toolbar badge.",
    "",
    "- It's not just a tool, it's a paradigm shift.",
  ].join("\n");
  const diagnostics = lintText(text, {
    filename: "README.md",
    segments: segmentsForFile("README.md", text),
  });

  assert.equal(diagnostics.filter((item) => item.ruleId === "uniform-sentences").length, 0);
  const contrast = diagnostics.find((item) => item.ruleId === "binary-contrast");
  assert.equal(contrast.line, 8);
  assert.equal(contrast.column, 3);
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

test("HTML headings carry heading context to the engine", () => {
  const text = `<h2>Why this <em>matters</em></h2><h2>Why this matters</h2><p>Why this matters</p>`;
  const diagnostics = lintText(text, {
    filename: "page.html",
    segments: segmentsForFile("page.html", text),
  });
  assert.deepStrictEqual(diagnostics.map((d) => [d.ruleId, d.text]), [
    ["coy-header", "Why this <em>matters"],
    ["coy-header", "Why this matters"],
  ]);
  assert.strictEqual(diagnostics[1].column, text.indexOf("<h2>Why this matters") + 5);
});

test("source scanning checks comments, strings, and JSX text without linting identifiers", () => {
  const text = [
    "const robust = true;",
    "// Great question! This helper lets us delve into parsing.",
    "const label = \"Unlock your full potential today\";",
    "const view = <p>Don't worry, this product stands as a testament to our vision.</p>;",
    "export const seamless = robust;",
  ].join("\n");
  const diagnostics = lintText(text, {
    filename: "page.tsx",
    segments: segmentsForFile("page.tsx", text),
  });

  assert.ok(diagnostics.some((item) => item.ruleId === "chatbot-phrase" && item.line === 2));
  assert.ok(diagnostics.some((item) => item.ruleId === "puffery" && item.line === 3));
  assert.ok(diagnostics.some((item) => item.ruleId === "puffery" && item.line === 4));
  assert.ok(!diagnostics.some((item) => item.text === "robust" && item.line === 1));
  assert.ok(!diagnostics.some((item) => item.line === 5), "an apostrophe must not desync the tokenizer");
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

  const files = collectFiles([directory]).map((item) => path.basename(item));
  assert.deepEqual(files, [".gitignore", "README.md"]);
  assert.ok(lintFile(path.join(directory, "README.md")).some((item) => item.ruleId === "chatbot-phrase"));
});

test("a repository nested under an ignored directory name is still linted", () => {
  const directory = path.join(tempDir(), "build", "myrepo");
  fs.mkdirSync(directory, { recursive: true });
  spawnSync("git", ["init", "-q", directory]);
  fs.writeFileSync(path.join(directory, "README.md"), "Great question! This text needs revision.\n");
  fs.mkdirSync(path.join(directory, "dist"));
  fs.writeFileSync(path.join(directory, "dist", "bundle.md"), "Great question! Generated text.\n");

  const files = collectFiles([directory]).map((item) => path.relative(directory, item));
  assert.deepEqual(files, ["README.md"]);
});

test("double-star ignore globs match root and nested files", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "docs"));
  fs.writeFileSync(path.join(directory, "README.md"), "Root prose.\n");
  fs.writeFileSync(path.join(directory, "docs", "guide.md"), "Nested prose.\n");
  fs.writeFileSync(path.join(directory, "notes.txt"), "Keep this file.\n");

  const files = collectFiles([directory], { ignore: ["**/*.md"] })
    .map((item) => path.relative(directory, item));
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

test("HTML phrases that cross inline tags are read as one paragraph", () => {
  const text = `<p>Please <a href="x">feel free</a> to ask, and <code>delve()</code> is only a function name.</p>`;
  const diagnostics = lintText(text, { filename: "page.html", segments: segmentsForFile("page.html", text) });
  assert.deepStrictEqual(diagnostics.map((d) => [d.ruleId, d.text, d.column]), [
    ["chatbot-phrase", `feel free</a> to`, text.indexOf("feel free") + 1],
  ]);
});

test("HTML entities are decoded and comments are skipped, with ranges on the source text", () => {
  const text = `<!-- <p>feel free to edit</p> if a > b -->\n<p title="a > b">I&rsquo;d be happy to help &amp; feel&nbsp;free to ask.</p>`;
  const diagnostics = lintText(text, { filename: "p.html", segments: segmentsForFile("p.html", text) });
  assert.deepStrictEqual(diagnostics.map((d) => [d.text, d.line]), [
    ["I&rsquo;d be happy to", 2],
    ["feel&nbsp;free to", 2],
  ]);
});

test("source scanning reads SQL comments, skips character literals, and blanks string escapes", () => {
  const lint = (name, text) => lintText(text, { filename: name, segments: segmentsForFile(name, text) }).map((d) => d.text);
  assert.deepStrictEqual(lint("a.c", `char c = '"'; char *s = "Great question"; /* I'd be happy to */\n`), ["Great question", "I'd be happy to"]);
  assert.deepStrictEqual(lint("a.sql", "-- feel free to edit\nSELECT 1;\n"), ["feel free to"]);
  assert.deepStrictEqual(lint("a.js", `const s = "Thanks.\\nFeel free to ask";\n`), ["Feel free to"]);
});

test("Markdown fences open and close only on real fence lines", () => {
  const lint = (text) => lintText(text, { filename: "a.md", segments: segmentsForFile("a.md", text) }).map((d) => d.text);
  assert.deepStrictEqual(lint("\`\`\`js\`\`\` is inline code here.\n\nLet us delve into it.\n"), ["delve"]);
  assert.deepStrictEqual(lint("~~~\n\`\`\`\nLet us delve into it.\n~~~\n\nA robust paragraph follows.\n"), ["robust"]);
});

test("adversarial input inside the size bound finishes quickly", () => {
  const cases = [
    ["a.md", "](".repeat(150000)],
    ["a.html", "<".repeat(150000)],
    ["a.html", '<a title="'.repeat(30000)],
    ["a.html", "<code>".repeat(50000)],
    ["a.js", '"\\'.repeat(90000)],
  ];
  const started = Date.now();
  for (const [name, text] of cases) lintText(text, { filename: name, segments: segmentsForFile(name, text) });
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test("ignore patterns accept a leading or trailing slash", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "docs"));
  fs.writeFileSync(path.join(directory, "docs", "x.md"), "Great question about this one.\n");
  for (const pattern of ["docs", "docs/", "/docs", "./docs/"]) {
    assert.deepEqual(collectFiles([directory], { ignore: [pattern], root: directory }), [], pattern);
  }
});

test("a directory named on the command line is linted even under a default-ignored name", () => {
  const directory = tempDir();
  spawnSync("git", ["init", "-q", directory]);
  fs.mkdirSync(path.join(directory, "build", "docs"), { recursive: true });
  fs.writeFileSync(path.join(directory, "build", "docs", "x.md"), "Great question about this one.\n");
  assert.deepEqual(collectFiles([directory], { root: directory }), []);
  const named = collectFiles([path.join(directory, "build")], { root: directory });
  assert.deepEqual(named.map((file) => path.basename(file)), ["x.md"]);
});

test("a symbolic link named on the command line is reported, not skipped silently", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "docs"));
  fs.symlinkSync(path.join(directory, "docs"), path.join(directory, "lnk"));
  const result = spawnSync(process.execPath, [cli, "lnk"], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /symbolic link/);
});

test("source scanning follows each language's own comment and string syntax", () => {
  const cases = {
    "deploy.sh": "cp build_out/* /srv/www/\nrobust=1\nutilize \"$robust\"\n",
    "ci.yml": "name: Don't break main\njobs:\n  robust-build:\n    steps:\n      - run: make leverage\n",
    "lib.rs": "fn pick<'a>(robust: &'a str, seamless: &'a str) -> &'a str { robust }\n",
    "App.js": "<p>Don't worry about it</p>\nconst robust = true;\nconst seamless = robust;\n",
    "cmp.tsx": "const ok = a > robust && seamless < b;\n",
    "Makefile": "robust: seamless.o\n\tcc -o robust seamless.o\n",
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.deepEqual(lintText(text, { filename: name, segments: segmentsForFile(name, text) }), [], name);
  }
  const jsx = "const el = <p>We delve into the plan</p>;\n// A robust comment here.\n";
  const found = lintText(jsx, { filename: "cmp.tsx", segments: segmentsForFile("cmp.tsx", jsx) });
  assert.deepEqual(found.map((d) => d.text), ["delve", "robust"]);
});

test("Markdown inline code and link targets are not prose", () => {
  const text = "Run `npm run leverage` and see [the guide](https://example.com/robust-setup) to delve deeper.\n";
  const found = lintText(text, { filename: "doc.md", segments: segmentsForFile("doc.md", text) });
  assert.deepEqual(found.map((d) => [d.text, d.column]), [["delve", text.indexOf("delve") + 1]]);
});

test("ignore patterns resolve against the config directory however paths are passed", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "docs"));
  fs.writeFileSync(path.join(directory, "docs", "rules.md"), "Great question about this one.\n");
  fs.writeFileSync(path.join(directory, "notes.md"), "Great question about this one.\n");
  const run = (ignore, ...args) => {
    fs.writeFileSync(path.join(directory, ".slopdetector.json"), JSON.stringify({ ignore }));
    return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: "utf8" }).status;
  };
  for (const target of [".", "docs", "docs/rules.md"]) {
    assert.equal(run(["docs/rules.md", "notes.md"], target), 0, `file pattern, target ${target}`);
    assert.equal(run(["docs", "notes.md"], target), 0, `directory pattern, target ${target}`);
  }
  assert.equal(run([], "docs/rules.md"), 1);
});

test("a repository reached through a symlinked directory is still linted", () => {
  const directory = tempDir();
  fs.mkdirSync(path.join(directory, "real", "repo"), { recursive: true });
  spawnSync("git", ["init", "-q", path.join(directory, "real", "repo")]);
  fs.writeFileSync(path.join(directory, "real", "repo", "README.md"), "Great question about this one.\n");
  fs.symlinkSync(path.join(directory, "real"), path.join(directory, "link"));
  const files = collectFiles([path.join(directory, "link", "repo")]);
  assert.deepEqual(files.map((file) => path.basename(file)), ["README.md"]);
});

test("options that take a value reject a missing or empty one", () => {
  for (const args of [["--max-warnings="], ["--max-warnings"], ["--config", "--quiet"], ["--format="]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: tempDir(), encoding: "utf8" });
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.stderr, /requires a value/, args.join(" "));
  }
});

test("a misspelled rule id in config is rejected instead of ignored", () => {
  const directory = tempDir();
  fs.writeFileSync(path.join(directory, ".slopdetector.json"), JSON.stringify({ rules: { "ai-vocabularly": "off" } }));
  const result = spawnSync(process.execPath, [cli], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown rule "ai-vocabularly"/);
  assert.match(result.stderr, /ai-vocabulary/);
});

test("CRLF prose is linted at the same positions as LF prose", () => {
  const lf = "Opening line of prose.\n\nLet us delve into it.\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const [finding] = lintText(crlf, { filename: "notes.md", segments: segmentsForFile("notes.md", crlf) });
  assert.deepEqual([finding.ruleId, finding.line, finding.column, finding.text], ["ai-vocabulary", 3, 8, "delve"]);
  assert.equal(lintText(lf, { filename: "notes.md", segments: segmentsForFile("notes.md", lf) }).length, 1);
});

test("public-domain human prose raises no errors and few warnings", () => {
  /* Strunk's 1918 text is from Project Gutenberg #37134 and the SQLite README is dedicated to the
     public domain by its authors. Both predate language models, so every finding here is a false positive. */
  const directory = path.join(__dirname, "fixtures", "human");
  let words = 0;
  const diagnostics = [];
  for (const name of fs.readdirSync(directory)) {
    const filename = path.join(directory, name);
    words += fs.readFileSync(filename, "utf8").split(/\s+/).length;
    diagnostics.push(...lintFile(filename));
  }
  assert.ok(words > 10000, "fixture went missing");
  const describe = (items) => items.map((d) => `${path.basename(d.file)}:${d.line} ${d.ruleId} ${d.text.slice(0, 60)}`).join("\n");
  const errors = diagnostics.filter((d) => d.level === "error");
  assert.equal(errors.length, 0, describe(errors));
  assert.ok(diagnostics.length <= words / 1500, `more than one warning per 1,500 words:\n${describe(diagnostics)}`);
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
