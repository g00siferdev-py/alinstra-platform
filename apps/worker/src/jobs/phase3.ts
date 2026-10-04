import { getEnv, log } from "@alinstra/config";
import { advanceProvisioning, failProvisioning, formatLocalTime, latestProvisionFailure, plainCallerName, runDueTeardowns, syncProvisionedAgent, type Phase3Deps } from "@alinstra/db";
import { provisionFailedEmail, sendEmail, type EmailMessage } from "@alinstra/email";
import { platformsFor } from "@alinstra/providers";
import { enqueueSendAdminNotice, type SendMessageEmail } from "@alinstra/queue";

export function phase3Deps(): Phase3Deps {
  const env = getEnv();
  const platforms = platformsFor(env);
  return {
    ...platforms,
    appUrl: env.APP_URL,
    voiceId: env.RETELL_DEFAULT_VOICE_ID,
    danielNumber: env.DANIEL_TRANSFER_NUMBER || null,
    danielEmail: env.ADMIN_EMAIL,
    defaultAreaCode: env.RETELL_DEFAULT_AREA_CODE || null,
    defaultTollFree: env.RETELL_DEFAULT_TOLL_FREE === "true",
  };
}

export async function runProvision(clientId: string): Promise<void> {
  let result: { status: string };
  try {
    result = await advanceProvisioning({ id: "provision-worker", role: "admin" }, clientId, phase3Deps());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provisioning failed";
    await failProvisioning(clientId, message);
    await notifyProvisionFailure(clientId).catch((notifyError: unknown) => {
      log("error", "provision failure email was not sent", { clientId, error: notifyError instanceof Error ? notifyError.message : "unknown" });
    });
    throw error;
  }
  if (result.status === "failed") {
    await notifyProvisionFailure(clientId).catch((notifyError: unknown) => {
      log("error", "provision failure email was not sent", { clientId, error: notifyError instanceof Error ? notifyError.message : "unknown" });
    });
  }
}

/**
 * Emails the admin (ADMIN_EMAIL, else whoever started the run) about the latest failed provisioning step.
 * Returns the recipient, or null when there was nothing to report or nobody to tell.
 */
export async function notifyProvisionFailure(
  clientId: string,
  send: (message: EmailMessage) => Promise<void> = sendEmail,
): Promise<string | null> {
  const failure = await latestProvisionFailure(clientId);
  if (!failure) return null;
  const env = getEnv();
  const to = env.ADMIN_EMAIL || failure.runOwnerEmail;
  if (!to) {
    log("warn", "provisioning failed and no admin email is configured", { clientId, step: failure.stepName });
    return null;
  }
  const clientUrl = `${env.APP_URL.replace(/\/$/, "")}/admin/clients/${clientId}`;
  await send({ to, ...provisionFailedEmail({ clientName: failure.clientName, stepLabel: failure.stepLabel, error: failure.error, clientUrl }) });
  return to;
}

export async function runSync(clientId: string): Promise<void> {
  const result = await syncProvisionedAgent(clientId, phase3Deps());
  if (result === "failed") {
    await enqueueSendAdminNotice({
      subject: "Retell sync failed",
      text: `The receptionist for client ${clientId} is out of date. Open the client and retry the sync.`,
    });
  }
}

export function messageEmailText(payload: SendMessageEmail, appUrl: string): string {
  const received = payload.receivedAt ? formatLocalTime(payload.receivedAt, payload.timezone) : "";
  return [
    `${payload.callerName} left a message${received ? ` at ${received}` : ""}:`,
    "",
    payload.body,
    "",
    `Client ${payload.clientId}`,
    appUrl,
  ].join("\n");
}

export async function runMessageEmail(payload: SendMessageEmail): Promise<void> {
  const env = getEnv();
  for (const to of payload.recipients) {
    await sendEmail({
      to,
      subject: `New message for your receptionist (${plainCallerName(payload.callerName)})`,
      text: messageEmailText(payload, env.APP_URL),
    });
  }
}

export async function runChurnSweep(): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === "production" && !env.RETELL_API_KEY) return;
  const result = await runDueTeardowns(phase3Deps());
  if (result.completed > 0) log("info", "tore down clients at period end", { count: result.completed });
  for (const clientId of result.skipped) {
    log("error", "skipped teardown because the service end date is not plausible", { clientId });
  }
  for (const failure of result.failed) {
    log("error", "teardown failed for one client", { clientId: failure.clientId });
    await enqueueSendAdminNotice({
      subject: "Service teardown failed",
      text: `Ending service failed for client ${failure.clientId}. ${failure.error}`,
    });
  }
}

