import { createRequire } from "node:module";
import { prisma, startWizard } from "@alinstra/db";

const requireFromBetterAuth = createRequire(createRequire(import.meta.url).resolve("better-auth"));
const { createOTP } = requireFromBetterAuth("@better-auth/utils/otp") as {
  createOTP: (secret: string) => { totp: () => Promise<string> };
};
const { base32 } = requireFromBetterAuth("@better-auth/utils/base32") as {
  base32: { decode: (value: string) => Uint8Array };
};

const origin = process.env.APP_URL ?? "http://127.0.0.1:3000";
const email = process.env.ADMIN_EMAIL ?? "";
const password = process.env.ADMIN_INITIAL_PASSWORD ?? "";
const fileText = "Smoke extraction line.";

function cookieHeader(response: Response): string {
  const jar = new Map<string, string>();
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0] ?? "";
    const splitAt = pair.indexOf("=");
    if (splitAt <= 0) continue;
    jar.set(pair.slice(0, splitAt), pair.slice(splitAt + 1));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function main(): Promise<void> {
  const health = await fetch(`${origin}/api/health`);
  const healthBody = (await health.json()) as { ok?: boolean };
  if (!health.ok || healthBody.ok !== true) throw new Error(`health ${health.status}`);
  console.log("health ok");

  const signedIn = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`sign-in ${signedIn.status}`);
  let cookie = cookieHeader(signedIn);
  console.log("admin signed in");

  const enabled = await fetch(`${origin}/api/auth/two-factor/enable`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({ password }),
  });
  if (!enabled.ok) throw new Error(`2fa enable ${enabled.status}`);
  const setup = (await enabled.json()) as { totpURI?: string };
  const encoded = new URL(setup.totpURI ?? "").searchParams.get("secret") ?? "";
  const secret = new TextDecoder().decode(base32.decode(encoded));
  const code = await createOTP(secret).totp();
  const verified = await fetch(`${origin}/api/auth/two-factor/verify-totp`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({ code }),
  });
  if (!verified.ok) throw new Error(`2fa verify ${verified.status}`);
  cookie = cookieHeader(verified) || cookie;
  console.log("admin two-factor enrolled");

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
  const client = await startWizard({ id: admin.id, role: "admin" }, "Smoke HVAC");
  const bytes = Buffer.from(fileText);
  const reserved = await fetch(`${origin}/api/knowledge/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({
      clientId: client.id,
      filename: "smoke.txt",
      contentType: "text/plain",
      byteSize: bytes.length,
    }),
  });
  const reservedBody = (await reserved.json()) as { mode?: string; url?: string; documentId?: string; message?: string };
  if (!reserved.ok || reservedBody.mode !== "presigned" || !reservedBody.url || !reservedBody.documentId) {
    throw new Error(`reserve ${reserved.status} ${reservedBody.message ?? reservedBody.mode ?? ""}`);
  }
  const stored = await fetch(reservedBody.url, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: bytes,
  });
  if (!stored.ok) throw new Error(`presigned put ${stored.status}`);
  const confirmed = await fetch(`${origin}/api/knowledge/uploads/${reservedBody.documentId}`, {
    method: "POST",
    headers: { origin, cookie },
  });
  if (!confirmed.ok) throw new Error(`confirm ${confirmed.status}`);
  console.log("presigned upload stored");

  let status = "pending";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const row = await prisma.knowledgeDocument.findUniqueOrThrow({ where: { id: reservedBody.documentId } });
    status = row.extractionStatus;
    if (status === "done" || status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (status !== "done") throw new Error(`extraction ${status}`);
  console.log("extraction done");

  const download = await fetch(`${origin}/api/knowledge/documents/${reservedBody.documentId}`, {
    headers: { origin, cookie },
    redirect: "follow",
  });
  const downloaded = await download.text();
  if (!download.ok || !downloaded.includes(fileText)) throw new Error(`download ${download.status}`);
  console.log("download ok");
  console.log("PROD_SMOKE_OK");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "smoke failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
