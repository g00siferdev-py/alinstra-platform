import { describe, expect, it } from "vitest";
import { assertResetAllowed, databaseNameFromUrl, testDatabaseUrl } from "./test-database-url";

describe("test database url", () => {
  it("points local tests at a database whose name ends in _test", () => {
    const dev = "postgresql://alinstra:alinstra@localhost:5432/alinstra?schema=public";
    const test = testDatabaseUrl(dev);
    expect(databaseNameFromUrl(test)).toBe("alinstra_test");
    expect(test).toContain("schema=public");
    expect(databaseNameFromUrl(testDatabaseUrl(dev, "postgresql://alinstra:alinstra@localhost:5432/custom_test"))).toBe(
      "custom_test",
    );
  });

  it("refuses to reset a database whose name does not end in _test", () => {
    expect(() => assertResetAllowed("alinstra")).toThrow(/_test/);
    expect(() => assertResetAllowed("alinstra_test")).not.toThrow();
  });
});
