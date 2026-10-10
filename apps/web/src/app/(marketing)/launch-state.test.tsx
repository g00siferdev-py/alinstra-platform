/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/db", async () => {
  const actual = await vi.importActual<typeof import("@alinstra/db")>("@alinstra/db");
  return {
    ...actual,
    publicPlans: async () => actual.publicPlansFromSeeds(),
    publicSiteConfig: async () => ({ phone: "+18883871525", email: "hello@alinstra.com" }),
  };
});

import HomePage from "./page";
import PricingPage from "./pricing/page";

const BANNED = [/coming soon/i, /launching/i, /\breserve\b/i, /\btext\b/i, /most popular/i];

afterEach(() => {
  cleanup();
  delete process.env.LAUNCH_STATE;
});

function pageView(node: ReactElement) {
  const view = render(node);
  const hrefs = [...view.container.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href") ?? "");
  return { text: view.container.textContent ?? "", hrefs: hrefs.join("\n") };
}

describe("launch state marketing pages", () => {
  it("has no signup links in prelaunch and keeps banned phrases off the page", async () => {
    delete process.env.LAUNCH_STATE;
    const home = pageView(await HomePage());
    cleanup();
    const pricing = pageView(await PricingPage());
    const text = `${home.text}\n${pricing.text}`;
    const hrefs = `${home.hrefs}\n${pricing.hrefs}`;
    expect(hrefs).not.toMatch(/\/signup/);
    expect(hrefs).toContain("/start?plan=");
    for (const pattern of BANNED) expect(text).not.toMatch(pattern);
  });

  it("links plans to signup when live and still avoids banned phrases", async () => {
    process.env.LAUNCH_STATE = "live";
    const home = pageView(await HomePage());
    cleanup();
    const pricing = pageView(await PricingPage());
    const text = `${home.text}\n${pricing.text}`;
    const hrefs = `${home.hrefs}\n${pricing.hrefs}`;
    expect(hrefs).toMatch(/\/signup\?plan=/);
    for (const pattern of BANNED) expect(text).not.toMatch(pattern);
  });
});
