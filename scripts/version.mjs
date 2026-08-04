#!/usr/bin/env bun
/* ======================================================
   周易起卦 — Version Generator
   Generates version.json with semver + git metadata +
   build timestamp. Runs automatically before `wrangler
   deploy` via the `predeploy` script.
   ====================================================== */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

function git(args) {
  try {
    return execSync(`git ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const commit = git("rev-parse --short HEAD");
const describe = git("describe --tags --always --dirty");
const branch = git("rev-parse --abbrev-ref HEAD");
const commitDate = git("log -1 --format=%cs");

const version = {
  version: pkg.version,
  describe: describe ?? "unknown",
  commit: commit ?? "unknown",
  branch: branch ?? null,
  commitDate: commitDate ?? null,
  buildTime: new Date().toISOString(),
};

const out = new URL("version.json", root);
writeFileSync(out, JSON.stringify(version, null, 2) + "\n");

console.log(`📦 ${out.pathname.split("/").slice(-2).join("/")}`);
console.log(`   version   : v${version.version}`);
console.log(`   git       : ${version.describe}${version.branch ? ` (${version.branch})` : ""}`);
console.log(`   buildTime : ${version.buildTime}`);
