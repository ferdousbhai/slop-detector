#!/usr/bin/env node
"use strict";

const manifest = require("../extension/manifest.json");

const expectedTag = `v${manifest.version}`;
if (process.env.EXPECTED_TAG && process.env.EXPECTED_TAG !== expectedTag) {
  throw new Error(`Tag mismatch: expected ${expectedTag}, got ${process.env.EXPECTED_TAG}.`);
}

console.log(`Extension version matches release tag: ${manifest.version}`);
