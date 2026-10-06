import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { keyIdOf } from "@alinstra/crypto";
import { approveQuickUpdate, applyQuickUpdate, receptionistFields } from "./agent";
import { recordChange } from "./changes";
import { containsPhone, maskPhoneDisplay, maskPhonesIn, maskPhonesInText, openPayload, protectPayload, SEALED_KEY } from "./cipher";
import { prisma } from "./client";
import { knowledgeBases } from "./knowledge";
import { decideTransfer, clientMessages, recordTakenMessage, transferTargets, writeTransferTargets } from "./provision";
import { resetTestDatabase } from "./reset-test-database";
import { clientEditPayload, editClientStep } from "./wizard";

const admin = { id: "admin_phase_s", role: "admin" as const };
const openFriday = new Date("2026-10-02T19:00:00.000Z");

async function seedClient(name = "North HVAC") {
  const client = await prisma.client.create({
    data: {
      name,
      status: "live",
      industry: "hvac",
      timezone: "America/New_York",
      wizardSubmittedAt: new Date(),
      weeklyHours: { fri: { start: "09:00", end: "17:00" } },
      compliance: { healthcareSensitive: false, healthcareTouched: true },
      features: { messageRecipients: "office@example.com", liveTransfer: true },
      voice: { voiceId: "voice_1", assistantName: "Ava", disclosureMode: "on_request" },
    },
  });
  await prisma.agentConfig.create({
    data: { clientId: client.id, version: 1, status: "active", promptText: "Hello.", templateId: "general", templateVersion: "6", documentIds: [], tools: [], settings: {}, greeting: "Hi.", source: "test", createdById: admin.id },
  });
  await prisma.knowledgeBase.create({ data: { clientId: client.id, version: 1, status: "submitted", hours: "Mon-Fri 9-5" } });
  await prisma.user.create({ data: { id: `owner_${client.id}`, name: "Owner", email: `owner_${client.id}@example.com`, role: "client_owner", clientId: client.id } });
  return client;
}

describe("phone masking helpers", () => {
  it("masks NANP numbers like (423) ***-0198", () => {
    expect(maskPhoneDisplay("+14235550198")).toBe("(423) ***-0198");
    expect(maskPhoneDisplay("423-555-0198")).toBe("(423) ***-0198");
    expect(maskPhoneDisplay("(423) 555 0198")).toBe("(423) ***-0198");
  });

  it("keeps only the last four digits for other shapes", () => {
    expect(maskPhoneDisplay("+442071234567")).toBe("***-4567");
    expect(maskPhoneDisplay("12")).toBe("***");
    expect(maskPhoneDisplay(null)).toBe("***");
  });

  it("masks every 10+ digit number in text, line by line, and leaves everything else alone", () => {
    expect(maskPhonesInText("Cell +14155550123 or 415.555.0177")).toBe("Cell (415) ***-0123 or (415) ***-0177");
    expect(maskPhonesInText("Daniel, +14235550198\nSarah, +14235550199")).toBe("Daniel, (423) ***-0198\nSarah, (423) ***-0199");
    expect(maskPhonesInText("4155550123\n4155550177")).toBe("(415) ***-0123\n(415) ***-0177");
    expect(maskPhonesInText("Call 555-0100 at 2026-10-05 12:00")).toBe("Call 555-0100 at 2026-10-05 12:00");
    expect(maskPhonesInText("Order 12345 of 3 items")).toBe("Order 12345 of 3 items");
    expect(maskPhonesInText(maskPhonesInText("+14155550123"))).toBe("(415) ***-0123");
  });

  it("masks deeply in JSON without touching keys or other values", () => {
    const value = { after: { count: 2, rows: [{ e164: "+14155550123", label: "Desk" }], note: "ext 12" }, flag: true, none: null };
    expect(maskPhonesIn(value)).toEqual({ after: { count: 2, rows: [{ e164: "(415) ***-0123", label: "Desk" }], note: "ext 12" }, flag: true, none: null });
    expect(containsPhone(value)).toBe(true);
    expect(containsPhone({ a: "no numbers" })).toBe(false);
  });

  it("seals the original beside the masked copy and opens it again", () => {
    const original = { kind: "transfers", text: "Cell, +14155550200" };
    const stored = protectPayload(original) as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain("4155550200");
    expect(stored.text).toBe("Cell, (415) ***-0200");
    expect(typeof stored[SEALED_KEY]).toBe("string");
    expect(openPayload(stored)).toEqual(original);
    const plain = { kind: "hours", text: "Mon 9-5" };
    expect(protectPayload(plain)).toBe(plain);
    expect(openPayload(plain)).toBe(plain);
  });
});

describe("Phase S encrypted columns", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a taken message as ciphertext plus a masked callback, never plaintext", async () => {
    const client = await seedClient();
    await recordTakenMessage(client.id, { callerName: "Pat Rivera", callbackNumber: "+14235550198", message: "My furnace is out." }, null);
    const raw = await prisma.clientMessage.findFirstOrThrow({ where: { clientId: client.id } });
    expect(raw.callerName).toBeNull();
    expect(raw.callbackNumber).toBeNull();
    expect(raw.body).toBeNull();
    expect(raw.callbackMasked).toBe("(423) ***-0198");
    for (const cipher of [raw.callerNameCipher, raw.callbackNumberCipher, raw.bodyCipher]) {
      expect(cipher).toMatch(/^v2\.k\d+\./);
    }
    const dump = JSON.stringify(raw);
    expect(dump).not.toContain("Pat Rivera");
    expect(dump).not.toContain("4235550198");
    expect(dump).not.toContain("furnace");
    expect(keyIdOf(raw.bodyCipher ?? "")).toMatch(/^k\d+$/);

    const [row] = await clientMessages({ role: "client_owner", clientId: client.id }).list(client.id);
    expect(row).toMatchObject({ callerName: "Pat Rivera", callbackNumber: "+14235550198", body: "My furnace is out.", callbackMasked: "(423) ***-0198" });
  });

  it("reads old plaintext messages until they are backfilled", async () => {
    const client = await seedClient();
    await prisma.clientMessage.create({ data: { clientId: client.id, callerName: "Old Caller", callbackNumber: "5551234567", body: "Legacy row" } });
    const [row] = await clientMessages({ role: "admin" }).list(client.id);
    expect(row).toMatchObject({ callerName: "Old Caller", callbackNumber: "5551234567", body: "Legacy row" });
  });

  it("isolates messages and transfer targets by client", async () => {
    const a = await seedClient("A");
    const b = await seedClient("B");
    await recordTakenMessage(a.id, { callerName: "Pat", callbackNumber: "+14235550198", message: "For A only" }, null);
    await prisma.$transaction((tx) => writeTransferTargets(tx, admin, a.id, "Desk, +14155550100"));
    const ownerB = { role: "client_owner" as const, clientId: b.id };
    expect(await clientMessages(ownerB).list(a.id)).toEqual([]);
    expect(await transferTargets(ownerB).list(a.id)).toEqual([]);
    expect(await clientMessages(ownerB).list(b.id)).toEqual([]);
    expect(await clientMessages({ role: "client_owner", clientId: a.id }).list(a.id)).toHaveLength(1);
  });

  it("stores transfer numbers encrypted with a mask and still routes transfers", async () => {
    const client = await seedClient();
    await prisma.$transaction((tx) => writeTransferTargets(tx, admin, client.id, "Desk, +14155550100\nCell, +14155550200"));
    const rows = await prisma.transferTarget.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => row.e164)).toEqual([null, null]);
    expect(rows.map((row) => row.e164Masked)).toEqual(["(415) ***-0100", "(415) ***-0200"]);
    expect(JSON.stringify(rows)).not.toContain("4155550100");
    expect((await transferTargets({ role: "admin" }).list(client.id)).map((row) => row.e164)).toEqual(["+14155550100", "+14155550200"]);
    expect(await decideTransfer(client.id, { target: "cell" }, openFriday)).toMatchObject({ allowed: true });
    expect(await decideTransfer(client.id, { number: "4155550200" }, openFriday)).toMatchObject({ allowed: true, tool: "transfer_cell" });
    expect(await decideTransfer(client.id, { number: "+14155550999" }, openFriday)).toMatchObject({ allowed: false });
  });

  it("falls back to a legacy plaintext transfer number", async () => {
    const client = await seedClient();
    await prisma.transferTarget.create({ data: { clientId: client.id, label: "Legacy", e164: "+14155550300" } });
    expect((await transferTargets({ role: "admin" }).list(client.id)).map((row) => row.e164)).toEqual(["+14155550300"]);
    expect(await decideTransfer(client.id, { number: "+14155550300" }, openFriday)).toMatchObject({ allowed: true });
  });

  it("keeps staff notes encrypted and readable for the owner and the prompt", async () => {
    const client = await seedClient();
    const owner = { id: `owner_${client.id}`, role: "client_owner" as const, clientId: client.id };
    await applyQuickUpdate(owner, { kind: "staff", text: "Dana Lee, office manager" });
    const latest = await prisma.knowledgeBase.findFirstOrThrow({ where: { clientId: client.id }, orderBy: { version: "desc" } });
    expect(latest.staff).toBeNull();
    expect(latest.staffCipher).toMatch(/^v2\.k\d+\./);
    expect(JSON.stringify(latest)).not.toContain("Dana Lee");
    expect((await knowledgeBases({ role: "client_owner", clientId: client.id }).getCurrent(client.id))?.staff).toBe("Dana Lee, office manager");
    expect((await receptionistFields(admin, client.id)).staff).toBe("Dana Lee, office manager");
    // A later fork for another field carries the staff notes forward.
    await applyQuickUpdate(owner, { kind: "hours", text: "Mon-Fri 8-4" });
    expect((await knowledgeBases({ role: "admin" }).getCurrent(client.id))?.staff).toBe("Dana Lee, office manager");
  });

  it("reads legacy plaintext staff notes and carries them forward encrypted", async () => {
    const client = await seedClient();
    await prisma.knowledgeBase.update({ where: { clientId_version: { clientId: client.id, version: 1 } }, data: { staff: "Legacy staff" } });
    expect((await knowledgeBases({ role: "admin" }).getCurrent(client.id))?.staff).toBe("Legacy staff");
    await applyQuickUpdate({ id: `owner_${client.id}`, role: "client_owner", clientId: client.id }, { kind: "hours", text: "Mon-Fri 8-4" });
    const latest = await prisma.knowledgeBase.findFirstOrThrow({ where: { clientId: client.id }, orderBy: { version: "desc" } });
    expect(latest.staff).toBeNull();
    expect((await knowledgeBases({ role: "admin" }).getCurrent(client.id))?.staff).toBe("Legacy staff");
  });

  it("masks phone numbers written to ChangeLog before/after in the same transaction", async () => {
    const client = await seedClient();
    await prisma.$transaction((tx) =>
      recordChange(tx, {
        clientId: client.id,
        actor: admin,
        action: "test.phone",
        entityType: "client",
        entityId: client.id,
        summary: "phone test",
        before: { transferTargetsText: "Cell, +14155550123" },
        after: { transferTargetsText: "Cell, +14155550177\nDesk, 415-555-0100", count: 2 },
      }),
    );
    const row = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "test.phone" } });
    expect(JSON.stringify(row.before) + JSON.stringify(row.after)).not.toMatch(/\d{3}[-. ]?\d{3}[-. ]?\d{4}/);
    expect(row.after).toEqual({ transferTargetsText: "Cell, (415) ***-0177\nDesk, (415) ***-0100", count: 2 });
  });

  it("masks numbers in an owner's transfer-change hold, then applies the real numbers on approval", async () => {
    const client = await seedClient();
    const owner = { id: `owner_${client.id}`, role: "client_owner" as const, clientId: client.id };
    const base = await clientEditPayload(owner, client.id);
    const held = await editClientStep(owner, {
      clientId: client.id,
      step: 5,
      payload: { ...base, features: { ...base.features, transferTargetsText: "Cell, +14155550222" } },
    });
    expect(held.held).toBe(true);
    const row = await prisma.quickUpdate.findFirstOrThrow({ where: { clientId: client.id, status: "held" } });
    expect(JSON.stringify(row.payload)).not.toContain("4155550222");
    const log = await prisma.changeLog.findFirstOrThrow({ where: { clientId: client.id, action: "owner_edit.held" } });
    expect(JSON.stringify(log.after)).not.toContain("4155550222");
    expect(await prisma.transferTarget.count({ where: { clientId: client.id } })).toBe(0);

    await approveQuickUpdate(admin, row.id);
    const saved = await prisma.transferTarget.findMany({ where: { clientId: client.id } });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.e164).toBeNull();
    expect((await transferTargets({ role: "admin" }).list(client.id))[0]?.e164).toBe("+14155550222");
  });

  it("applies a held transfers quick update from the sealed payload", async () => {
    const client = await seedClient();
    const owner = { id: `owner_${client.id}`, role: "client_owner" as const, clientId: client.id };
    const result = await applyQuickUpdate(owner, { kind: "transfers", text: "Free line, +14155550333" });
    expect(result.status).toBe("held");
    const row = await prisma.quickUpdate.findFirstOrThrow({ where: { clientId: client.id, status: "held" } });
    expect(JSON.stringify(row.payload)).not.toContain("4155550333");
    await approveQuickUpdate(admin, row.id);
    expect((await transferTargets({ role: "admin" }).list(client.id)).map((target) => target.e164)).toEqual(["+14155550333"]);
    expect(JSON.stringify(await prisma.quickUpdate.findFirstOrThrow({ where: { id: row.id } }))).not.toContain("4155550333");
  });
});
