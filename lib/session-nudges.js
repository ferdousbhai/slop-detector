"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_SESSION_ID_LENGTH = 4096;
const MAX_NUDGE_LENGTH = 10_000;
const NUDGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function validSessionId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH;
}

function stateDirectory(env = process.env, home = os.homedir()) {
  const configured = env.XDG_STATE_HOME;
  const root = configured && path.isAbsolute(configured)
    ? configured
    : path.join(home, ".local", "state");
  return path.join(root, "slop-detector", "session-nudges");
}

function statePath(sessionId, options = {}) {
  if (!validSessionId(sessionId)) return undefined;
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(stateDirectory(options.env, options.home), `${digest}.json`);
}

function pruneExpired(directory, now = Date.now()) {
  const marker = path.join(directory, ".last-prune");
  try {
    if (now - fs.statSync(marker).mtimeMs < PRUNE_INTERVAL_MS) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fs.writeFileSync(marker, "", { mode: 0o600 });
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json(?:\.|$)/.test(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    try {
      if (now - fs.statSync(filename).mtimeMs > NUDGE_MAX_AGE_MS) fs.unlinkSync(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function saveSessionNudge(sessionId, nudge, options = {}) {
  const filename = statePath(sessionId, options);
  if (!filename || typeof nudge !== "string" || nudge.length === 0 || nudge.length > MAX_NUDGE_LENGTH) return false;
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  pruneExpired(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, createdAt: Date.now(), nudge })}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, filename);
    return true;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function consumeSessionNudge(sessionId, options = {}) {
  const filename = statePath(sessionId, options);
  if (!filename) return "";
  const claimed = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.claimed`;
  try {
    fs.renameSync(filename, claimed);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
  let raw;
  try {
    raw = fs.readFileSync(claimed, "utf8");
  } finally {
    try {
      fs.unlinkSync(claimed);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const value = JSON.parse(raw);
    const age = Date.now() - value?.createdAt;
    if (value?.version !== 1
      || typeof value.createdAt !== "number"
      || age < 0
      || age > NUDGE_MAX_AGE_MS
      || typeof value.nudge !== "string"
      || value.nudge.length === 0
      || value.nudge.length > MAX_NUDGE_LENGTH) return "";
    return value.nudge;
  } catch {
    return "";
  }
}

module.exports = {
  consumeSessionNudge,
  saveSessionNudge,
  stateDirectory,
};
