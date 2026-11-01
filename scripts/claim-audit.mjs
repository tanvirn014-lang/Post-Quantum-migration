#!/usr/bin/env node
// Restricted-claim review (proposal Appendix F) over everything a reader or user could see:
// documentation, UI and API strings, and registry text. It lists every occurrence of a restricted
// phrase and fails when one is not an explicit negation ("never", "not", "does not claim" ...).
// Tests and this script are excluded because they must name the phrases to forbid them.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RESTRICTED = [
  /quantum[- ]proof/i,
  /quantum[- ]safe/i,
  /quantum[- ]resistant/i,
  /fully secure/i,
  /production[- ]ready/i,
  /banking[- ]compliant/i,
  /state[- ]of[- ]the[- ]art/i,
  /emergency swap/i,
  /real attack simulation/i,
  /unbreakable/i,
  /\bunhackable\b/i,
];

// A restricted phrase is acceptable only where the same line denies or qualifies it.
const NEGATION = /\b(never|not|no|nothing|nor|without|avoid|avoids|restricted|forbidden|refuse|refuses|do not|does not|doesn't|don't|cannot|can't|isn't|is not|neither|rather than)\b/i;

const EXCLUDED_DIR = /(^|\/)(node_modules|dist|\.next|evidence|schemas|\.git|\.superpowers|coverage)\//;
const EXCLUDED_FILE = /(\.test\.[tj]sx?$|(^|\/)tests?\/|package-lock\.json$|claim-audit\.mjs$|\.csv$|\.pem$|\.sha256$)/;
const SCANNED = /\.(md|ts|tsx|js|mjs|json|sql|html|css)$/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f && SCANNED.test(f) && !EXCLUDED_DIR.test(f) && !EXCLUDED_FILE.test(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const pattern of RESTRICTED) {
      if (pattern.test(line)) hits.push({ file, line: i + 1, text: line.trim().slice(0, 200), negated: NEGATION.test(line) });
    }
  });
}

const unexplained = hits.filter((h) => !h.negated);
for (const h of hits) console.log(`${h.negated ? "denied   " : "UNDENIED "} ${h.file}:${h.line}  ${h.text}`);
console.log(`\n${files.length} files scanned, ${hits.length} occurrences of restricted phrases, ${unexplained.length} not negated.`);
if (unexplained.length > 0) process.exitCode = 1;
