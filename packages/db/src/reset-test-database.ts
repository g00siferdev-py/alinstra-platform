import { prisma } from "./client";
import { assertResetAllowed } from "./test-database-url";

const RESET_SQL = `TRUNCATE TABLE "stripe_event", "provisioning_step", "provisioning_run", "call_record", "client_message", "transfer_target", "stripe_price", "change_request", "quick_update", "agent_config", "change_log", "knowledge_document", "knowledge_base", "interview_session", "wizard_draft", "lead", "session", "account", "twoFactor", "verification", "invite", "user", "client", "plan" CASCADE`;

export async function resetTestDatabase(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assertResetAllowed(rows[0]?.name ?? "");
  await prisma.$executeRawUnsafe(RESET_SQL);
}
