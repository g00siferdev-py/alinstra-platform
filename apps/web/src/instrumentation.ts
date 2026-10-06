export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { log } = await import("@alinstra/config");
    const { activeKeyId, configuredKeyIds } = await import("@alinstra/crypto");
    const { setDecryptFailureReporter } = await import("@alinstra/db");
    const Sentry = await import("@sentry/nextjs");
    setDecryptFailureReporter((fields) => {
      Sentry.captureMessage("cipher.decrypt_failed", { level: "error", tags: { area: "cipher" }, extra: fields });
    });
    log("info", "encryption.keyring", { keys: configuredKeyIds().join(","), active: activeKeyId() });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
