import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Element selectors that must live in `@layer base` so Tailwind utilities can win. */
const GUARDED = ["a", "button", "input", ":focus-visible"] as const;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Removes an at-rule and its `{ … }` body (handles nesting). */
function stripAtRuleBlocks(css: string, atName: string): string {
  const needle = `@${atName}`;
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf(needle, i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    let j = at + needle.length;
    while (j < css.length && css[j] !== "{") j += 1;
    if (j >= css.length) break;
    let depth = 0;
    for (; j < css.length; j += 1) {
      const ch = css[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

/** Top-level rule selectors (not inside any `{ … }` block). */
function topLevelSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]!;
    if (ch === "{") {
      if (depth === 0) {
        const selector = buf.trim();
        if (selector && !selector.startsWith("@")) selectors.push(selector);
        buf = "";
      }
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      buf = "";
      continue;
    }
    if (depth === 0) buf += ch;
  }
  return selectors;
}

function unlayeredGuardedSelectors(css: string): string[] {
  let rest = stripComments(css);
  // Drop layered + nested at-rule bodies; leftovers are unlayered top-level rules.
  for (const name of ["layer", "theme", "keyframes", "media", "supports", "font-face"]) {
    rest = stripAtRuleBlocks(rest, name);
  }
  const hits: string[] = [];
  for (const selector of topLevelSelectors(rest)) {
    const parts = selector.split(",").map((part) => part.trim());
    for (const part of parts) {
      for (const tag of GUARDED) {
        // Bare element / pseudo, or that token at the start of a compound selector.
        const re = tag.startsWith(":")
          ? new RegExp(`^${tag.replace(":", "\\:")}(\\b|$|:)`)
          : new RegExp(`^${tag}(\\b|$|\\[|:)`);
        if (re.test(part)) hits.push(part);
      }
    }
  }
  return hits;
}

describe("globals.css cascade layers", () => {
  it("keeps a/button/input/:focus-visible rules inside @layer so utilities can override", () => {
    const css = readFileSync(resolve(import.meta.dirname, "globals.css"), "utf8");
    expect(css).toMatch(/@layer\s+base\s*\{/);
    const offenders = unlayeredGuardedSelectors(css);
    expect(offenders, `Unlayered element selectors beat Tailwind utilities: ${offenders.join("; ")}`).toEqual([]);
  });
});
