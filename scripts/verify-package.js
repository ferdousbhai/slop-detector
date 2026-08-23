#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "slop-detector-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requireStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

try {
  const packed = run(npm, ["pack", "--json", "--pack-destination", temporary]);
  requireStatus(packed, 0, "npm pack");
  const [packageManifest] = JSON.parse(packed.stdout);
  const { filename } = packageManifest;
  const included = new Set(packageManifest.files.map((file) => file.path));
  for (const required of [
    "bin/slop-detector.js",
    "docs/agent-hooks.md",
    "extension/engine.js",
    "lib/agent-hooks.js",
    "PRIVACY.md",
  ]) {
    if (!included.has(required)) throw new Error(`npm package omitted ${required}`);
  }
  const archive = path.join(temporary, filename);
  const consumer = path.join(temporary, "consumer");
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, "package.json"), "{\"private\":true}\n");
  const installed = run(npm, ["install", "--ignore-scripts", archive], { cwd: consumer });
  requireStatus(installed, 0, "npm install");

  const cli = process.platform === "win32"
    ? path.join(consumer, "node_modules", ".bin", "slop-detector.cmd")
    : path.join(consumer, "node_modules", ".bin", "slop-detector");
  const version = run(cli, ["--version"], { cwd: consumer });
  requireStatus(version, 0, "installed CLI");
  const exportsCheck = run(process.execPath, ["-e", [
    "const engine = require('@ferdousbhai/slop-detector');",
    "const engineAlias = require('@ferdousbhai/slop-detector/engine');",
    "const linter = require('@ferdousbhai/slop-detector/linter');",
    "if (engine !== engineAlias || typeof engine.analyze !== 'function' || typeof linter.lintText !== 'function') process.exit(1);",
  ].join("")], { cwd: consumer });
  requireStatus(exportsCheck, 0, "package exports");

  const lint = run(cli, ["agent", "--format=json"], {
    cwd: consumer,
    input: "Great question! Let us delve into this.",
  });
  requireStatus(lint, 1, "installed agent lint");
  const lintResult = JSON.parse(lint.stdout);
  if (lintResult.ok || !lintResult.revisionFeedback) {
    throw new Error("installed agent lint did not return deterministic revision feedback");
  }

  const home = path.join(temporary, "home");
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PI_CODING_AGENT_DIR: path.join(home, ".omp", "agent"),
  };
  const hooks = run(cli, [
    "install-hooks",
    "--scope=user",
    "--agents=claude,codex,omp,ghost",
    "--format=json",
  ], { cwd: consumer, env });
  requireStatus(hooks, 0, "installed hook installer");
  const hookResult = JSON.parse(hooks.stdout);
  if (hookResult.results.length !== 4 || hookResult.results.some((item) => !item.changed)) {
    throw new Error("installed hook installer did not configure every requested agent");
  }
  for (const filenameToCheck of [
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".codex", "hooks.json"),
    path.join(home, ".omp", "agent", "extensions", "slop-detector.ts"),
    path.join(home, ".config", "ghost", "hooks.json"),
  ]) {
    if (!fs.existsSync(filenameToCheck)) throw new Error(`hook installer omitted ${filenameToCheck}`);
    const content = fs.readFileSync(filenameToCheck, "utf8");
    if (!content.includes("slop-detector")) throw new Error(`${filenameToCheck} has no Slop Detector hook`);
  }

  console.log(`Verified ${filename}: CLI, lint gate, and four hook installers`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
