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
  const npmVersion = run(npm, ["--version"]);
  requireStatus(npmVersion, 0, "npm --version");
  if (Number.parseInt(npmVersion.stdout, 10) < 12) {
    throw new Error(`npm 12 or newer is required, found ${npmVersion.stdout.trim()}`);
  }
  const packed = run(npm, ["pack", "--json", "--pack-destination", temporary]);
  requireStatus(packed, 0, "npm pack");
  const packOutput = JSON.parse(packed.stdout);
  const packageName = require(path.join(root, "package.json")).name;
  const packageManifest = packOutput[packageName];
  if (!packageManifest) throw new Error(`npm pack omitted metadata for ${packageName}`);
  const { filename } = packageManifest;
  const included = new Set(packageManifest.files.map((file) => file.path));
  for (const required of [
    "bin/slop-detector.js",
    "extension/engine.js",
    "lib/linter.js",
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
  if (version.stdout.trim() !== packageManifest.version) {
    throw new Error(`installed CLI reported ${version.stdout.trim()} instead of ${packageManifest.version}`);
  }
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

  console.log(`Verified ${filename}: CLI, lint gate, and public exports`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
