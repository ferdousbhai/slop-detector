#!/usr/bin/env node
"use strict";

const packageJson = require("../package.json");
const manifest = require("../extension/manifest.json");

if (packageJson.version !== manifest.version) {
  throw new Error(
    `Version mismatch: package.json is ${packageJson.version}, extension/manifest.json is ${manifest.version}.`,
  );
}

const expectedTag = `v${packageJson.version}`;
if (process.env.EXPECTED_TAG && process.env.EXPECTED_TAG !== expectedTag) {
  throw new Error(`Tag mismatch: expected ${expectedTag}, got ${process.env.EXPECTED_TAG}.`);
}

console.log(`Distribution versions match: ${packageJson.version}`);
