#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const packageJson = require("../package.json");
const { runAgentHook } = require("../lib/agent-hooks.js");
const { installHooks } = require("../lib/install-hooks.js");
const {
  collectFiles,
  lintFileResult,
  lintText,
  loadConfig,
  revisionFeedback,
  segmentsForFile,
  warningNudge,
} = require("../lib/linter.js");

const HELP = `Slop Detector ${packageJson.version}

Deterministic prose linting. Detection never calls a model or the network.

Usage:
  slop-detector [check] [paths...] [options]
  slop-detector agent [options] < agent-output.txt
  slop-detector hook <runner> [options] < hook-input.json
  slop-detector install-hooks [options]

Commands:
  check          Lint repository files (default)
  agent          Lint agent output from stdin and emit revision feedback
  hook           Internal entrypoint used by installed agent integrations
  install-hooks  Install hooks for Claude, Codex, Gemini, OMP, and Ghost

Options:
  --config <path>          Use a specific .slopdetector.json
  --format <stylish|json>  Output format (default: stylish)
  --max-warnings <number>  Fail when warnings exceed this number
  --scope <user|project>   Hook installation scope (default: user)
  --agents <list|all>      Agents to configure (default: all supported by scope)
  --dry-run                Show hook files without changing them
  --quiet                  Report errors only
  -h, --help               Show help
  -v, --version            Show version

Rule levels in .slopdetector.json are "off", "warn", or "error".
Major rules default to errors; minor rules default to warnings.`;

function fail(message, code = 2) {
  console.error(`slop-detector: ${message}`);
  process.exit(code);
}

function readStdin() {
  const limit = 1024 * 1024;
  const chunks = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total));
    const bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > limit) fail("stdin exceeds the 1 MB limit");
    chunks.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseArgs(argv) {
  const options = { command: "check", paths: [], format: "stylish", quiet: false, scope: "user", dryRun: false };
  let i = 0;
  if (argv[0] === "check" || argv[0] === "agent" || argv[0] === "hook" || argv[0] === "install-hooks") options.command = argv[i++];
  if (options.command === "hook" && argv[i] && !argv[i].startsWith("-")) options.runner = argv[i++];

  while (i < argv.length) {
    const arg = argv[i++];
    if (arg === "--") {
      options.paths.push(...argv.slice(i));
      break;
    }
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "-v" || arg === "--version") options.version = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--scope") options.scope = argv[i++] ?? fail("--scope requires a value");
    else if (arg.startsWith("--scope=")) options.scope = arg.slice("--scope=".length);
    else if (arg === "--agents") options.agents = argv[i++] ?? fail("--agents requires a value");
    else if (arg.startsWith("--agents=")) options.agents = arg.slice("--agents=".length);
    else if (arg === "--config") options.config = argv[i++] ?? fail("--config requires a path");
    else if (arg.startsWith("--config=")) options.config = arg.slice("--config=".length);
    else if (arg === "--format") options.format = argv[i++] ?? fail("--format requires a value");
    else if (arg.startsWith("--format=")) options.format = arg.slice("--format=".length);
    else if (arg === "--max-warnings") options.maxWarnings = Number(argv[i++] ?? fail("--max-warnings requires a number"));
    else if (arg.startsWith("--max-warnings=")) options.maxWarnings = Number(arg.slice("--max-warnings=".length));
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else options.paths.push(arg);
  }

  if (!new Set(["stylish", "json"]).has(options.format)) fail(`unknown format ${options.format}`);
  if (options.maxWarnings !== undefined && (!Number.isInteger(options.maxWarnings) || options.maxWarnings < 0)) {
    fail("--max-warnings must be a non-negative integer");
  }
  if (!new Set(["user", "project"]).has(options.scope)) fail("--scope must be user or project");
  if (options.command !== "check" && options.paths.length > 0) {
    fail(`${options.command} does not accept positional paths`);
  }
  if (options.agents !== undefined) {
    options.agents = options.agents === "all"
      ? undefined
      : options.agents.split(",").map((item) => item.trim()).filter(Boolean);
    if (options.agents?.length === 0) fail("--agents must name at least one agent");
  }
  return options;
}

function summary(diagnostics) {
  return {
    errors: diagnostics.filter((item) => item.level === "error").length,
    warnings: diagnostics.filter((item) => item.level === "warning").length,
  };
}

function printStylish(diagnostics, cwd, quiet) {
  const visible = quiet ? diagnostics.filter((item) => item.level === "error") : diagnostics;
  let currentFile = null;
  for (const item of visible) {
    const displayFile = item.file === "<agent-output>" ? item.file : path.relative(cwd, item.file) || path.basename(item.file);
    if (displayFile !== currentFile) {
      if (currentFile !== null) console.log("");
      console.log(displayFile);
      currentFile = displayFile;
    }
    console.log(`  ${item.line}:${item.column}  ${item.level.padEnd(7)}  ${item.message}  ${item.ruleId}`);
  }
  if (visible.length > 0) console.log("");
  const counts = summary(diagnostics);
  console.log(`${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"} (${counts.errors} errors, ${counts.warnings} warnings)`);
}

function shouldFail(diagnostics, maxWarnings) {
  const counts = summary(diagnostics);
  return counts.errors > 0 || (maxWarnings !== undefined && counts.warnings > maxWarnings);
}

function runAgent(options, config) {
  const text = readStdin();
  const diagnostics = lintText(text, {
    filename: "<agent-output>",
    rules: config.rules,
    segments: segmentsForFile("agent-output.md", text),
  });
  const failed = shouldFail(diagnostics, options.maxWarnings);
  const feedback = failed ? revisionFeedback(diagnostics) : "";

  if (options.format === "json") {
    console.log(JSON.stringify({
      schemaVersion: 1,
      tool: { name: packageJson.name, version: packageJson.version },
      ok: !failed,
      diagnostics: options.quiet ? diagnostics.filter((item) => item.level === "error") : diagnostics,
      summary: summary(diagnostics),
      revisionFeedback: feedback,
      warningNudge: warningNudge(diagnostics),
    }, null, 2));
  } else {
    printStylish(diagnostics, process.cwd(), options.quiet);
    if (failed) console.log(`\n${feedback}`);
  }
  process.exitCode = failed ? 1 : 0;
}

function runHook(options, config) {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch (error) {
    fail(`hook input must be valid JSON: ${error.message}`);
  }

  try {
    console.log(JSON.stringify(runAgentHook({
      runner: options.runner,
      input,
      maxWarnings: options.maxWarnings,
      rules: config.rules,
    })));
  } catch (error) {
    fail(error.message);
  }
}

function runInstallHooks(options) {
  let results;
  try {
    results = installHooks({
      scope: options.scope,
      agents: options.agents,
      dryRun: options.dryRun,
      cwd: process.cwd(),
    });
  } catch (error) {
    fail(error.message);
  }

  if (options.format === "json") {
    console.log(JSON.stringify({
      ok: true,
      scope: options.scope,
      dryRun: options.dryRun,
      results,
    }, null, 2));
    return;
  }

  for (const result of results) {
    const status = options.dryRun ? "would install" : result.changed ? "installed" : "already installed";
    console.log(`${result.agent.padEnd(10)} ${status.padEnd(17)} ${result.path}`);
    for (const extraPath of result.extraPaths ?? []) console.log(`${"".padEnd(10)} ${"configured".padEnd(17)} ${extraPath}`);
  }
}

function runCheck(options, config) {
  const inputs = options.paths.length > 0 ? options.paths : ["."];
  let files;
  try {
    files = collectFiles(inputs, { ignore: config.ignore });
  } catch (error) {
    fail(error.message);
  }

  const diagnostics = [];
  let filesChecked = 0;
  for (const { filename } of files) {
    try {
      const result = lintFileResult(filename, { rules: config.rules });
      if (result.checked) filesChecked += 1;
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      fail(`could not lint ${filename}: ${error.message}`);
    }
  }

  if (options.format === "json") {
    console.log(JSON.stringify({
      schemaVersion: 1,
      tool: { name: packageJson.name, version: packageJson.version },
      diagnostics: options.quiet ? diagnostics.filter((item) => item.level === "error") : diagnostics,
      summary: summary(diagnostics),
      filesDiscovered: files.length,
      filesChecked,
      filesSkipped: files.length - filesChecked,
    }, null, 2));
  } else printStylish(diagnostics, process.cwd(), options.quiet);

  process.exitCode = shouldFail(diagnostics, options.maxWarnings) ? 1 : 0;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
if (options.version) {
  console.log(packageJson.version);
  process.exit(0);
}

if (options.command === "install-hooks") {
  runInstallHooks(options);
} else if (options.command === "hook" && options.runner?.endsWith("-prompt")) {
  runHook(options, { rules: {} });
} else {
  let config;
  try {
    config = loadConfig(process.cwd(), options.config);
  } catch (error) {
    fail(error.message);
  }

  if (options.command === "agent") runAgent(options, config);
  else if (options.command === "hook") runHook(options, config);
  else runCheck(options, config);
}
