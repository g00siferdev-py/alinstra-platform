#!/usr/bin/env node
// Supply-chain gate: fails on any high/critical production advisory that is not in
// audit-allowlist.json. Allowlist entries need an advisory id, a reason and an expiry date;
// an expired or malformed entry fails the check so exceptions cannot rot silently.
//
// Usage:
//   node scripts/check-audit.mjs                 # runs `pnpm audit --prod --audit-level=high --json`
//   node scripts/check-audit.mjs --input a.json  # use a saved `pnpm audit --json` report (testing)
//   node scripts/check-audit.mjs --allowlist f   # alternate allowlist path (testing)
/* global console, process */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BLOCKING = new Set(["high", "critical"]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fail(message) {
  console.error(`audit-check: ${message}`);
  process.exit(1);
}

function loadAllowlist(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`cannot read allowlist ${path}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.advisories)) {
    fail(`${path} must be an object with an "advisories" array`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map();
  const problems = [];
  for (const [i, entry] of parsed.advisories.entries()) {
    const label = `advisories[${i}]${entry?.id ? ` (${entry.id})` : ""}`;
    if (typeof entry?.id !== "string" || !entry.id.trim()) {
      problems.push(`${label}: missing "id"`);
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      problems.push(`${label}: missing or too-short "reason"`);
    }
    if (typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      problems.push(`${label}: "expires" must be YYYY-MM-DD`);
    } else if (entry.expires < today) {
      problems.push(`${label}: expired on ${entry.expires}; fix the dependency or renew with a new reason`);
    }
    byId.set(String(entry.id).toUpperCase(), entry);
  }
  return { byId, problems };
}

function loadReport(inputPath) {
  let raw;
  if (inputPath) {
    raw = readFileSync(inputPath, "utf8");
  } else {
    // pnpm exits non-zero when it finds advisories; we decide pass/fail ourselves.
    const result = spawnSync("pnpm", ["audit", "--prod", "--audit-level=high", "--json"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) fail(`could not run pnpm audit: ${result.error.message}`);
    raw = result.stdout;
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail("pnpm audit did not return JSON (registry unreachable?); refusing to pass without an audit result");
  }
}

const report = loadReport(arg("--input"));
if (!report || typeof report.advisories !== "object") {
  fail("unexpected pnpm audit output (no `advisories` object)");
}

const { byId, problems } = loadAllowlist(resolve(arg("--allowlist") ?? resolve(root, "audit-allowlist.json")));

const blocking = Object.values(report.advisories).filter((a) => BLOCKING.has(a.severity));
const matchedIds = new Set();
const unallowed = [];
for (const advisory of blocking) {
  const keys = [advisory.github_advisory_id, advisory.id, ...(advisory.cves ?? [])]
    .filter((k) => k !== undefined && k !== null)
    .map((k) => String(k).toUpperCase());
  const hit = keys.find((k) => byId.has(k));
  if (hit) matchedIds.add(hit);
  else unallowed.push(advisory);
}

for (const [id] of byId) {
  if (!matchedIds.has(id)) {
    console.warn(`audit-check: warning: allowlist entry ${id} matches no current high/critical advisory; remove it`);
  }
}

console.log(
  `audit-check: ${blocking.length} high/critical advisor${blocking.length === 1 ? "y" : "ies"}, ` +
    `${blocking.length - unallowed.length} allowlisted, ${unallowed.length} not allowlisted`,
);

if (problems.length) {
  console.error("audit-check: invalid or expired allowlist entries:");
  for (const p of problems) console.error(`  - ${p}`);
}
if (unallowed.length) {
  console.error("audit-check: high/critical advisories without an allowlist entry:");
  for (const a of unallowed) {
    console.error(
      `  - ${a.github_advisory_id ?? a.id} [${a.severity}] ${a.module_name} (${a.vulnerable_versions}; patched ${a.patched_versions}): ${a.title}\n    ${a.url}`,
    );
  }
}
process.exit(problems.length || unallowed.length ? 1 : 0);
