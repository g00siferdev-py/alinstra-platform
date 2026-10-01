import { getEnv, log } from "@alinstra/config";
import { prisma, seedPlans } from "@alinstra/db";
import { createCredentialUser } from "./users";

async function main(): Promise<void> {
  await seedPlans();
  log("info", "plans seeded");
  const env = getEnv();
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "admin" || existing.clientId !== null) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "admin", clientId: null },
      });
    }
    log("info", "admin user already present");
    return;
  }

  if (!env.ADMIN_INITIAL_PASSWORD) {
    throw new Error("ADMIN_INITIAL_PASSWORD is required to create the admin user");
  }

  await createCredentialUser({
    email,
    name: "Alinstra Admin",
    password: env.ADMIN_INITIAL_PASSWORD,
    role: "admin",
    clientId: null,
  });
  log("info", "admin user created");
}

main()
  .catch((error: unknown) => {
    log("error", "seed failed", { error: error instanceof Error ? error.name : "unknown" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
