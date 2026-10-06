import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptString, encryptString, keyIdOf } from "@alinstra/crypto";
import { approveQuickUpdate } from "./agent";
import { open as openCipher, openPayload } from "./cipher";
import { prisma } from "./client";
import { allKeyCounts, encryptBackfill, remainingPlaintext, rotateEncryptionKey } from "./encryption-jobs";
import { knowledgeBases } from "./knowledge";
import { clientMessages, transferTargets } from "./provision";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_jobs", role: "admin" as const };
const saved = { ...process.env };
const key2 = randomBytes(32).toString("base64");

function useKeys(active: "1" | "2" | null): void {
  if (active === null) {
    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ENCRYPTION_ACTIVE_KEY;
    return;
  }
  process.env.ENCRYPTION_KEY_V2 = key2;
  process.env.ENCRYPTION_ACTIVE_KEY = active;
}

async function seedClient(name = "Jobs Co") {
  return prisma.client.create({ data: { name, status: "live", wizardSubmittedAt: new Date(), timezone: "America/New_York" } });
}

describe("encrypt backfill and key rotation", () => {
  beforeEach(async () => {
    useKeys(null);
    await resetTestDatabase();
  });
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY_V2;
    delete process.env.ENCRYPTION_ACTIVE_KEY;
    if (saved.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("backfills legacy plaintext, is idempotent, and keeps every reader working", async () => {
    const client = await seedClient();
    const other = await seedClient("Other");
    await prisma.clientMessage.create({ data: { clientId: client.id, callerName: "Pat", callbackNumber: "+14235550198", body: "Furnace out" } });
    await prisma.clientMessage.create({ data: { clientId: other.id, callerName: "Sam", callbackNumber: "", body: "Other tenant" } });
    await prisma.transferTarget.create({ data: { clientId: client.id, label: "Desk", e164: "+14155550100" } });
    await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "submitted", staff: "Dana Lee, manager", hours: "Mon 9-5" } });
    const knowledge = await prisma.knowledgeBase.findFirstOrThrow({ where: { clientId: client.id } });
    await prisma.knowledgeDocument.create({
      data: { clientId: client.id, knowledgeBaseId: knowledge.id, storageKey: "k", originalFilename: "a.pdf", contentType: "application/pdf", byteSize: 1, extractedText: "Price list text", extractionStatus: "done" },
    });
    await prisma.changeLog.create({ data: { clientId: client.id, actorUserId: "u", actorRole: "admin", action: "x", entityType: "client", entityId: client.id, summary: "s", before: { t: "Cell, +14155550123" }, after: { count: 1 } } });
    await prisma.changeLog.create({ data: { clientId: client.id, actorUserId: "u", actorRole: "admin", action: "y", entityType: "client", entityId: client.id, summary: "s", after: { id: "c1234567890123456", note: "no phone" } } });
    await prisma.quickUpdate.create({ data: { clientId: client.id, kind: "transfers", payload: { kind: "transfers", text: "Cell, +14155550222" }, status: "held", holdReason: "free", createdById: "u" } });
    await prisma.quickUpdate.create({ data: { clientId: client.id, kind: "transfers", payload: { kind: "transfers", text: "Cell, +14155550333" }, status: "applied", createdById: "u" } });

    const dry = await encryptBackfill({ dryRun: true });
    expect(dry.columns.map((c) => [c.column, c.written])).toEqual([
      ["client_message (name, callback, body)", 2],
      ["transfer_target.e164", 1],
      ["knowledge_base.staff", 1],
      ["knowledge_document.extractedText", 1],
      ["change_log.before/after (phones)", 1],
      ["quick_update.payload (phones)", 2],
    ]);
    expect(await prisma.transferTarget.count({ where: { e164: { not: null } } })).toBe(1); // dry run wrote nothing

    const run = await encryptBackfill({ batch: 1 });
    expect(run.columns.map((c) => c.written)).toEqual([2, 1, 1, 1, 1, 2]);
    expect(run.remaining.every((row) => row.rows === 0)).toBe(true);

    const again = await encryptBackfill();
    expect(again.columns.every((c) => c.written === 0)).toBe(true);
    expect(await remainingPlaintext()).toEqual(run.remaining);

    // Raw rows hold ciphertext only.
    const rawMessage = await prisma.clientMessage.findFirstOrThrow({ where: { clientId: client.id } });
    expect([rawMessage.callerName, rawMessage.callbackNumber, rawMessage.body]).toEqual([null, null, null]);
    expect(rawMessage.callbackMasked).toBe("(423) ***-0198");
    expect(JSON.stringify(rawMessage)).not.toContain("Furnace");
    const rawTarget = await prisma.transferTarget.findFirstOrThrow({ where: { clientId: client.id } });
    expect(rawTarget.e164).toBeNull();
    expect(rawTarget.e164Masked).toBe("(415) ***-0100");

    // Readers.
    expect((await clientMessages({ role: "client_owner", clientId: client.id }).list(client.id))[0]).toMatchObject({ callerName: "Pat", body: "Furnace out", callbackNumber: "+14235550198" });
    expect(await clientMessages({ role: "client_owner", clientId: other.id }).list(client.id)).toEqual([]);
    expect((await transferTargets({ role: "admin" }).list(client.id))[0]?.e164).toBe("+14155550100");
    expect((await knowledgeBases({ role: "admin" }).getCurrent(client.id))?.staff).toBe("Dana Lee, manager");
    const doc = await prisma.knowledgeDocument.findFirstOrThrow({ where: { clientId: client.id } });
    expect(doc.extractedText).toBeNull();
    expect(openCipher(doc.extractedTextCipher)).toBe("Price list text");

    // JSON logs are redacted; the held update can still be approved from its sealed original.
    const log = await prisma.changeLog.findFirstOrThrow({ where: { action: "x" } });
    expect(JSON.stringify(log.before)).toBe(JSON.stringify({ t: "Cell, (415) ***-0123" }));
    const untouched = await prisma.changeLog.findFirstOrThrow({ where: { action: "y" } });
    expect(untouched.after).toEqual({ id: "c1234567890123456", note: "no phone" });
    const applied = await prisma.quickUpdate.findFirstOrThrow({ where: { status: "applied" } });
    expect(JSON.stringify(applied.payload)).not.toContain("4155550333");
    const held = await prisma.quickUpdate.findFirstOrThrow({ where: { status: "held" } });
    expect(JSON.stringify(held.payload)).not.toContain("4155550222");
    expect(openPayload(held.payload)).toEqual({ kind: "transfers", text: "Cell, +14155550222" });
    await approveQuickUpdate(admin, held.id);
    expect((await transferTargets({ role: "admin" }).list(client.id)).map((row) => row.e164)).toEqual(["+14155550222"]);
  });

  it("rotates every cipher column from k1 to k2, with counts, and is idempotent", async () => {
    useKeys(null);
    const client = await seedClient();
    // Written under k1: new-style columns, a CallRecord, and an invite token.
    await prisma.clientMessage.create({
      data: { clientId: client.id, callerNameCipher: encryptString("Pat"), callbackNumberCipher: encryptString("+14235550198"), bodyCipher: encryptString("Furnace out"), callbackMasked: "(423) ***-0198" },
    });
    await prisma.transferTarget.create({ data: { clientId: client.id, label: "Desk", e164Cipher: encryptString("+14155550100"), e164Masked: "(415) ***-0100" } });
    await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "submitted", staffCipher: encryptString(JSON.stringify("Dana Lee")) } });
    await prisma.callRecord.create({ data: { clientId: client.id, retellCallId: "call_rot", callerMasked: "****", transcriptCipher: encryptString("{\"turns\":[]}"), summaryCipher: encryptString("short summary") } });
    await prisma.invite.create({ data: { email: "x@example.com", role: "client_staff", clientId: client.id, tokenHash: "h", tokenCipher: encryptString("tok"), expiresAt: new Date(Date.now() + 86_400_000), createdById: "u" } });

    useKeys("2");
    const before = await allKeyCounts();
    expect(before.find((e) => e.column.field === "bodyCipher")?.counts.keys).toEqual({ k1: 1 });

    const dry = await rotateEncryptionKey({ to: "k2", dryRun: true });
    expect(dry.columns.filter((c) => c.moved > 0).map((c) => c.column).sort()).toEqual([
      "call_record.summaryCipher",
      "call_record.transcriptCipher",
      "client_message.bodyCipher",
      "client_message.callbackNumberCipher",
      "client_message.callerNameCipher",
      "invite.tokenCipher",
      "knowledge_base.staffCipher",
      "transfer_target.e164Cipher",
    ]);
    expect(keyIdOf((await prisma.clientMessage.findFirstOrThrow()).bodyCipher ?? "")).toBe("k1"); // dry run wrote nothing

    const logs: string[] = [];
    const real = await rotateEncryptionKey({ to: "k2", batch: 1, log: (line) => logs.push(line) });
    expect(real.failed).toBe(0);
    expect(real.columns.reduce((sum, c) => sum + c.moved, 0)).toBe(8);
    for (const entry of real.after) expect(Object.keys(entry.counts.keys).filter((id) => id !== "k2")).toEqual([]);
    expect(real.before.find((e) => e.column === "invite.tokenCipher")?.counts.keys).toEqual({ k1: 1 });
    expect(real.after.find((e) => e.column === "invite.tokenCipher")?.counts.keys).toEqual({ k2: 1 });
    expect(logs.join("\n")).not.toMatch(/Furnace|Dana|4235550198|short summary/);

    const second = await rotateEncryptionKey({ to: "k2" });
    expect(second.columns.every((c) => c.moved === 0)).toBe(true);

    // Everything still decrypts, with k1 still configured, and the invite token is intact.
    expect((await clientMessages({ role: "admin" }).list(client.id))[0]).toMatchObject({ callerName: "Pat", body: "Furnace out", callbackNumber: "+14235550198" });
    expect((await transferTargets({ role: "admin" }).list(client.id))[0]?.e164).toBe("+14155550100");
    expect((await knowledgeBases({ role: "admin" }).getCurrent(client.id))?.staff).toBe("Dana Lee");
    const invite = await prisma.invite.findFirstOrThrow();
    expect(keyIdOf(invite.tokenCipher ?? "")).toBe("k2");
    expect(decryptString(invite.tokenCipher ?? "")).toBe("tok");
  });

  it("leaves an unreadable payload alone and counts it", async () => {
    const client = await seedClient();
    useKeys("2");
    await prisma.clientMessage.create({ data: { clientId: client.id, bodyCipher: "v2.k7.AAAA.BBBB.CCCC" } });
    const result = await rotateEncryptionKey({ to: "k2" });
    expect(result.failed).toBe(1);
    expect((await prisma.clientMessage.findFirstOrThrow()).bodyCipher).toBe("v2.k7.AAAA.BBBB.CCCC");
  });

  it("refuses a target key that is not configured", async () => {
    await expect(rotateEncryptionKey({ to: "k2" })).rejects.toThrow(/ENCRYPTION_KEY_V2/);
    await expect(rotateEncryptionKey({ to: "two" })).rejects.toThrow(/--to/);
  });
});
