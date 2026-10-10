import { getEnv } from "@alinstra/config";
import { approveAutoGoLive, publicSiteConfig, runAutoGoLive } from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { sendEmail } from "@alinstra/email";
import { notifyProvisionFailure, phase3Deps } from "./phase3";

async function goLiveDeps() {
  const env = getEnv();
  const site = await publicSiteConfig();
  const text = platformsFor(env).text ?? {
    complete: async () => {
      throw new Error("text platform is not configured");
    },
  };
  return {
    text,
    provision: phase3Deps(),
    adminEmail: env.ADMIN_EMAIL,
    appUrl: env.APP_URL,
    tollFree: site.phone,
    dailyCap: env.AUTO_GO_LIVE_DAILY_CAP,
    allowTest: env.AUTO_GO_LIVE_ALLOW_TEST === "1",
    send: sendEmail,
    notifyProvisionFailure: async (id: string) => {
      await notifyProvisionFailure(id);
    },
  };
}

export async function runAutoGoLiveJob(clientId: string): Promise<void> {
  await runAutoGoLive(clientId, await goLiveDeps());
}

export async function runApproveAutoGoLiveJob(clientId: string, actorId: string): Promise<void> {
  await approveAutoGoLive({ id: actorId, role: "admin" }, clientId, await goLiveDeps());
}
