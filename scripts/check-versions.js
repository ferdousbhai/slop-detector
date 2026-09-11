#!/usr/bin/env node
"use strict";

const manifest = require("../extension/manifest.json");
const pkg = require("../package.json");

/* bin/slop-detector.js reports packageJson.version, so a manifest-only bump would ship a stale CLI. */
if (pkg.version !== manifest.version) {
  throw new Error(`Version mismatch: package.json ${pkg.version} vs extension/manifest.json ${manifest.version}.`);
}

const expectedTag = `v${manifest.version}`;
if (process.env.EXPECTED_TAG && process.env.EXPECTED_TAG !== expectedTag) {
  throw new Error(`Tag mismatch: expected ${expectedTag}, got ${process.env.EXPECTED_TAG}.`);
}

console.log(process.env.EXPECTED_TAG
  ? `Versions agree and match release tag: ${manifest.version}`
  : `package.json and manifest agree: ${manifest.version}`);
