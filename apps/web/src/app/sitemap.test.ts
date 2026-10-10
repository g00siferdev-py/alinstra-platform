import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("seo routes", () => {
  it("lists public marketing URLs in the sitemap", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain("https://alinstra.com");
    expect(urls).toContain("https://alinstra.com/pricing");
    expect(urls).toContain("https://alinstra.com/start");
    expect(urls.some((url) => url.includes("/admin"))).toBe(false);
  });

  it("disallows the whole site unless APP_ENV is production", () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "staging";
    const staging = robots();
    const stagingRules = Array.isArray(staging.rules) ? staging.rules[0]! : staging.rules!;
    expect(stagingRules.disallow).toBe("/");

    process.env.APP_ENV = "production";
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
    const disallow = rules.disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/admin", "/home", "/api"]));
    expect(result.sitemap).toBe("https://alinstra.com/sitemap.xml");
    process.env.APP_ENV = previous;
  });
});
