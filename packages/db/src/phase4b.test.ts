import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyRetellCall,
  callLinksFor,
  canAccessCall,
  getCall,
  listCalls,
  listStalePendingRecordings,
  markRecordingFailed,
  markRecordingStored,
  purgeExpiredCalls,
  recordingForPlayback,
  recordingKeyFor,
  recordingTarget,
  resetRecordingPending,
  setCallAccess,
  setCallRetention,
  STALE_RECORDING_PENDING_MS,
} from "./calls";
import { prisma } from "./client";
import { maskCaller } from "./domain";
import { recordTakenMessage } from "./provision";
import { resetTestDatabase } from "./reset-test-database";

const admin = { id: "admin_4b", role: "admin" as const };
const startMs = Date.parse("2026-10-02T19:00:00.000Z");
const CALLER = "+14155551212";
const SECRET_LINE = "my social security number is 123-45-6789";
let seeded = 0;

async function seedClient(name = "North HVAC", options: { retentionDays?: number } = {}) {
  const plan = await prisma.plan.upsert({
    where: { code: "plan_4b" },
    update: {},
    create: {
      code: "plan_4b",
      name: "Starter",
      monthlyPriceCents: 10000,
      includedMinutes: 100,
      overagePerMinuteCents: 40,
      setupFeeCents: 5000,
      extraChangeFeeCents: 4900,
      recallMonthlyCents: 0,
      recallPerBookingCents: 0,
      sortOrder: 1,
    },
  });
  const slug = name.toLowerCase().replace(/\W+/g, "_");
  seeded += 1;
  const client = await prisma.client.create({
    data: {
      name,
      status: "live",
      industry: "hvac",
      timezone: "America/New_York",
      planId: plan.id,
      contactEmail: `${slug}@example.com`,
      phoneE164: `+1555000${String(seeded).padStart(4, "0")}`,
      retellAgentId: `agent_${slug}`,
      weeklyHours: { fri: { start: "09:00", end: "17:00" } },
      compliance: {},
      features: { messageRecipients: "office@example.com" },
      ...(options.retentionDays ? { callRetentionDays: options.retentionDays } : {}),
    },
  });
  const owner = await prisma.user.create({
    data: { id: `owner_${client.id}`, name: "Owner", email: `owner_${slug}@example.com`, role: "client_owner", clientId: client.id },
  });
  const staff = await prisma.user.create({
    data: { id: `staff_${client.id}`, name: "Staff", email: `staff_${slug}@example.com`, role: "client_staff", clientId: client.id },
  });
  return { client, owner, staff };
}

function callFields(agentId: string, callId: string, overrides: Record<string, unknown> = {}) {
  return {
    call_id: callId,
    agent_id: agentId,
    from_number: CALLER,
    to_number: "+15550001010",
    direction: "inbound",
    start_timestamp: startMs,
    ...overrides,
  };
}

const transcriptWithTools = [
  { role: "agent", content: "Thanks for calling North HVAC, this is Ava.", words: [{ word: "Thanks", start: 0.4, end: 0.7 }] },
  { role: "user", content: `Hi, ${SECRET_LINE}.`, words: [{ word: "Hi,", start: 2.0, end: 2.2 }, { word: "6789.", start: 6.0, end: 6.4 }] },
  { role: "tool_call_invocation", tool_call_id: "tc_1", name: "take_message", arguments: '{"caller_name":"Pat","callback_number":"4155551212","message":"Furnace out"}' },
  { role: "tool_call_result", tool_call_id: "tc_1", content: '{"result":"I\'ve passed that message to the office."}', successful: true },
  { role: "agent", content: "Done, the office has it.", words: [] },
];

function endedPayload(agentId: string, callId: string, overrides: Record<string, unknown> = {}) {
  return {
    event: "call_ended",
    call: callFields(agentId, callId, {
      end_timestamp: startMs + 45_000,
      duration_ms: 45_000,
      disconnection_reason: "user_hangup",
      transcript: `Agent: Thanks for calling.\nUser: Hi, ${SECRET_LINE}.`,
      transcript_with_tool_calls: transcriptWithTools,
      recording_url: "https://retell-recordings.example/private/abc.wav",
      ...overrides,
    }),
  };
}

function analyzedPayload(agentId: string, callId: string, overrides: Record<string, unknown> = {}) {
  const base = endedPayload(agentId, callId, overrides);
  return {
    event: "call_analyzed",
    call: {
      ...base.call,
      call_analysis: { call_summary: "Caller reported a furnace outage; message taken.", user_sentiment: "Neutral", call_successful: true, in_voicemail: false },
      call_cost: { combined_cost: 70.4, total_duration_seconds: 45 },
    },
  };
}

describe("phase 4b calls", () => {
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("captures the call across events, encrypted at rest, enqueuing the recording once", async () => {
    const { client, owner } = await seedClient();
    const agent = client.retellAgentId!;
    const started = await applyRetellCall({ event: "call_started", call: callFields(agent, "call_a") });
    expect(started.recordingQueued).toBe(false);
    const ended = await applyRetellCall(endedPayload(agent, "call_a"));
    expect(ended.recordingQueued).toBe(true);
    const endedAgain = await applyRetellCall(endedPayload(agent, "call_a"));
    expect(endedAgain.recordingQueued).toBe(false);
    const analyzed = await applyRetellCall(analyzedPayload(agent, "call_a"));
    expect(analyzed.recordingQueued).toBe(false);
    await applyRetellCall(analyzedPayload(agent, "call_a"));

    const rows = await prisma.callRecord.findMany({ where: { clientId: client.id } });
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows[0]);
    expect(raw).not.toContain(SECRET_LINE);
    expect(raw).not.toContain("furnace outage");
    expect(raw).not.toContain(CALLER);
    expect(raw).not.toContain("retell-recordings.example");
    expect(rows[0]).toMatchObject({
      durationSeconds: 45,
      endReason: "user_hangup",
      callerMasked: maskCaller(CALLER),
      sentiment: "Neutral",
      successful: true,
      inVoicemail: false,
      costCents: 70,
      outcome: "message_taken",
      recordingStatus: "pending",
    });
    expect(rows[0]!.analyzedAt).not.toBeNull();

    const detail = await getCall({ id: owner.id, role: "client_owner", clientId: client.id }, rows[0]!.id);
    expect(detail?.transcript?.turns).toHaveLength(4);
    expect(detail?.transcript?.turns[1]).toMatchObject({ kind: "utterance", role: "caller", startSeconds: 2.0, endSeconds: 6.4 });
    expect(detail?.transcript?.turns[2]).toMatchObject({ kind: "tool_call", name: "take_message", successful: true });
    expect(detail?.summary).toContain("furnace outage");
    expect(detail?.caller).toBe(CALLER);
    expect(detail?.costCents).toBeNull();
    expect(detail?.rawEvents).toBeNull();
    const asAdmin = await getCall(admin, rows[0]!.id);
    expect(asAdmin?.costCents).toBe(70);
    expect(asAdmin?.rawEvents?.map((row) => (row as { event: string }).event)).toEqual(["call_started", "call_ended", "call_analyzed"]);
    expect(JSON.stringify(asAdmin?.rawEvents)).not.toContain("recording_url");

    const usage = await prisma.usageRecord.findUniqueOrThrow({ where: { callRecordId: rows[0]!.id } });
    expect(usage).toMatchObject({
      clientId: client.id,
      retellCallId: "call_a",
      durationSeconds: 45,
      billableMinutes: 1,
      costCents: 70,
      internal: false,
    });
  });

  it("converges when call_analyzed arrives before call_ended", async () => {
    const { client } = await seedClient();
    const agent = client.retellAgentId!;
    const first = await applyRetellCall(analyzedPayload(agent, "call_b"));
    expect(first.recordingQueued).toBe(true);
    const second = await applyRetellCall(endedPayload(agent, "call_b"));
    expect(second.recordingQueued).toBe(false);
    await applyRetellCall({ event: "call_started", call: callFields(agent, "call_b") });
    const rows = await prisma.callRecord.findMany({ where: { clientId: client.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "message_taken", sentiment: "Neutral", costCents: 70, durationSeconds: 45, recordingStatus: "pending" });
    expect(rows[0]!.summaryCipher).toMatch(/^v2\.k\d+\./);
    expect(rows[0]!.endedAt?.getTime()).toBe(startMs + 45_000);
  });

  it("derives transferred and hung_up outcomes and ignores unknown agents", async () => {
    const { client } = await seedClient();
    const agent = client.retellAgentId!;
    await applyRetellCall(
      endedPayload(agent, "call_t", {
        disconnection_reason: "call_transfer",
        transcript_with_tool_calls: [
          { role: "user", content: "Billing please", words: [] },
          { role: "tool_call_invocation", tool_call_id: "x1", name: "transfer", arguments: '{"target":"Billing"}' },
          { role: "tool_call_result", tool_call_id: "x1", content: '{"allowed":true,"tool":"transfer_billing"}' },
          { role: "tool_call_invocation", tool_call_id: "x2", name: "transfer_billing", arguments: "{}" },
        ],
        recording_url: undefined,
      }),
    );
    await applyRetellCall(endedPayload(agent, "call_h", { transcript_with_tool_calls: [{ role: "agent", content: "Hello?", words: [] }], transcript: "Agent: Hello?", recording_url: undefined }));
    const ignored = await applyRetellCall(endedPayload("agent_unknown", "call_x", { to_number: "+19999999999" }));
    expect(ignored).toEqual({ recordingQueued: false, callRecordId: null });
    const rows = await prisma.callRecord.findMany({ where: { clientId: client.id }, orderBy: { retellCallId: "asc" } });
    expect(rows.map((row) => [row.retellCallId, row.outcome, row.recordingStatus])).toEqual([
      ["call_h", "hung_up", "none"],
      ["call_t", "transferred", "none"],
    ]);
  });

  it("tracks the recording copy and streams only through the access check", async () => {
    const { client, owner, staff } = await seedClient();
    const agent = client.retellAgentId!;
    const { callRecordId } = await applyRetellCall(endedPayload(agent, "call_r"));
    expect(await recordingTarget("call_r")).toEqual({ callRecordId, clientId: client.id });
    await markRecordingFailed("call_r", "Recording download failed (503)");
    expect((await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "call_r" } })).recordingStatus).toBe("failed");
    expect(await recordingTarget("call_r")).not.toBeNull();
    const key = recordingKeyFor(client.id, "call_r", "audio/wav");
    expect(key).toBe(`clients/${client.id}/calls/call_r.wav`);
    await markRecordingStored("call_r", { key, contentType: "audio/wav", bytes: 1234 });
    expect(await recordingTarget("call_r")).toBeNull();
    const viewer = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    expect(await recordingForPlayback(viewer, callRecordId!)).toEqual({ key, contentType: "audio/wav", bytes: 1234, callId: callRecordId!, clientId: client.id });
    expect(await recordingForPlayback({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: false }, callRecordId!)).toBeNull();
    expect(await recordingForPlayback({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: true }, callRecordId!)).toEqual({ key, contentType: "audio/wav", bytes: 1234, callId: callRecordId!, clientId: client.id });
    const page = await listCalls(viewer, client.id);
    expect(page.rows[0]).toMatchObject({ hasRecording: true, caller: maskCaller(CALLER), outcome: "message_taken" });
  });

  it("lists newest first with filters, pagination, and per-role caller display", async () => {
    const { client, owner, staff } = await seedClient();
    const other = await seedClient("Other Co");
    const agent = client.retellAgentId!;
    for (let i = 0; i < 4; i += 1) {
      await applyRetellCall(endedPayload(agent, `call_${i}`, { start_timestamp: startMs + i * 3_600_000, end_timestamp: startMs + i * 3_600_000 + 10_000, duration_ms: 10_000, recording_url: undefined }));
    }
    await applyRetellCall(endedPayload(agent, "call_quiet", { start_timestamp: startMs + 5 * 3_600_000, transcript_with_tool_calls: [{ role: "agent", content: "Hello?", words: [] }], recording_url: undefined }));
    await applyRetellCall(endedPayload(other.client.retellAgentId!, "call_other", { to_number: other.client.phoneE164, recording_url: undefined }));

    const ownerView = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    const first = await listCalls(ownerView, client.id, { limit: 2 });
    expect(first.rows.map((row) => row.retellCallId)).toEqual(["call_quiet", "call_3"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCalls(ownerView, client.id, { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((row) => row.retellCallId)).toEqual(["call_2", "call_1"]);
    const third = await listCalls(ownerView, client.id, { limit: 2, cursor: second.nextCursor });
    expect(third.rows.map((row) => row.retellCallId)).toEqual(["call_0"]);
    expect(third.nextCursor).toBeNull();

    expect((await listCalls(ownerView, client.id, { outcome: "hung_up" })).rows.map((row) => row.retellCallId)).toEqual(["call_quiet"]);
    expect((await listCalls(ownerView, client.id, { from: new Date(startMs + 2 * 3_600_000), to: new Date(startMs + 3 * 3_600_000) })).rows.map((row) => row.retellCallId)).toEqual(["call_3", "call_2"]);
    // Lists always show the mask — full number is detail-only.
    expect(first.rows[0]?.caller).toBe(maskCaller(CALLER));
    const staffView = { id: staff.id, role: "client_staff" as const, clientId: client.id, canViewCalls: true };
    expect((await listCalls(staffView, client.id, { limit: 1 })).rows[0]?.caller).toBe(maskCaller(CALLER));
    expect((await listCalls({ ...staffView, canViewCalls: false }, client.id)).rows).toEqual([]);
    expect((await listCalls(ownerView, other.client.id)).rows).toEqual([]);
    expect((await listCalls(admin, other.client.id)).rows.map((row) => row.retellCallId)).toEqual(["call_other"]);
  });

  it("answers access per role and treats foreign calls as missing", async () => {
    const { client, owner, staff } = await seedClient();
    const other = await seedClient("Other Co");
    const { callRecordId } = await applyRetellCall(endedPayload(client.retellAgentId!, "call_acc", { recording_url: undefined }));
    const call = { clientId: client.id };
    expect(canAccessCall(admin, call)).toBe(true);
    expect(canAccessCall({ id: owner.id, role: "client_owner", clientId: client.id }, call)).toBe(true);
    expect(canAccessCall({ id: other.owner.id, role: "client_owner", clientId: other.client.id }, call)).toBe(false);
    expect(canAccessCall({ id: staff.id, role: "client_staff", clientId: client.id }, call)).toBe(false);
    expect(canAccessCall({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: true }, call)).toBe(true);
    expect(await getCall({ id: other.owner.id, role: "client_owner", clientId: other.client.id }, callRecordId!)).toBeNull();
    expect(await getCall({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: false }, callRecordId!)).toBeNull();
    const staffDetail = await getCall({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: true }, callRecordId!);
    expect(staffDetail?.caller).toBe(CALLER);
    expect(staffDetail?.transcript?.turns.length).toBeGreaterThan(0);
  });

  it("lets the owner grant and revoke staff call access with a change log line", async () => {
    const { client, owner, staff } = await seedClient();
    const other = await seedClient("Other Co");
    const ownerActor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    expect(await setCallAccess(ownerActor, { userId: staff.id, canViewCalls: true })).toEqual({ changed: true });
    expect(await setCallAccess(ownerActor, { userId: staff.id, canViewCalls: true })).toEqual({ changed: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).canViewCalls).toBe(true);
    await expect(setCallAccess(ownerActor, { userId: other.staff.id, canViewCalls: true })).rejects.toThrow(/not available/);
    await expect(setCallAccess({ id: staff.id, role: "client_staff", clientId: client.id }, { userId: staff.id, canViewCalls: true })).rejects.toThrow(/owner/);
    await expect(setCallAccess(ownerActor, { userId: owner.id, canViewCalls: false })).rejects.toThrow(/always/);
    expect(await setCallAccess(ownerActor, { userId: staff.id, canViewCalls: false })).toEqual({ changed: true });
    const log = await prisma.changeLog.findMany({ where: { clientId: client.id, action: "call_access" }, orderBy: { createdAt: "asc" } });
    expect(log.map((row) => row.summary)).toEqual([`Granted call access for ${staff.email}`, `Removed call access for ${staff.email}`]);
  });

  it("purges at exactly the retention boundary, once, deleting each recording one time", async () => {
    const { client } = await seedClient("North HVAC", { retentionDays: 30 });
    const keep = await seedClient("Long Keeper", { retentionDays: 365 });
    const agent = client.retellAgentId!;
    const now = new Date(startMs + 30 * 86_400_000);
    // Started exactly retentionDays ago: purged. One second newer: kept.
    await applyRetellCall(analyzedPayload(agent, "call_old", { start_timestamp: startMs }));
    await applyRetellCall(endedPayload(agent, "call_new", { start_timestamp: startMs + 1_000, end_timestamp: startMs + 46_000 }));
    await applyRetellCall(endedPayload(keep.client.retellAgentId!, "call_keep", { to_number: keep.client.phoneE164, start_timestamp: startMs }));
    for (const id of ["call_old", "call_new", "call_keep"]) {
      const target = (await recordingTarget(id))!;
      await markRecordingStored(id, { key: recordingKeyFor(target.clientId, id, "audio/wav"), contentType: "audio/wav", bytes: 10 });
    }
    const deleted: string[] = [];
    const report = await purgeExpiredCalls({ deleteObject: async (key) => void deleted.push(key) }, now);
    expect(report.purged).toBe(1);
    expect(report.recordingsDeleted).toBe(1);
    expect(deleted).toEqual([recordingKeyFor(client.id, "call_old", "audio/wav")]);
    const old = await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "call_old" } });
    expect(old).toMatchObject({ transcriptCipher: null, summaryCipher: null, callerE164Cipher: null, rawEventsCipher: null, recordingKey: null, recordingStatus: "purged", outcome: "message_taken", durationSeconds: 45, costCents: 70 });
    expect(old.purgedAt?.getTime()).toBe(now.getTime());
    const fresh = await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "call_new" } });
    expect(fresh.purgedAt).toBeNull();
    expect(fresh.transcriptCipher).toMatch(/^v2\.k\d+\./);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(stored.lastCallPurgeAt?.getTime()).toBe(now.getTime());
    expect(stored.lastCallPurgeCount).toBe(1);
    expect(await prisma.changeLog.count({ where: { clientId: client.id, action: "calls.purged" } })).toBe(1);
    expect(await prisma.changeLog.count({ where: { clientId: keep.client.id, action: "calls.purged" } })).toBe(0);

    // Re-run: nothing more to purge, no second delete, no second log line.
    const again = await purgeExpiredCalls({ deleteObject: async (key) => void deleted.push(key) }, new Date(now.getTime() + 500));
    expect(again.purged).toBe(0);
    expect(deleted).toHaveLength(1);
    expect(await prisma.changeLog.count({ where: { clientId: client.id, action: "calls.purged" } })).toBe(1);

    // A late duplicate event for a purged call must not resurrect the transcript or re-queue the recording.
    const late = await applyRetellCall(analyzedPayload(agent, "call_old"));
    expect(late.recordingQueued).toBe(false);
    const afterLate = await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "call_old" } });
    expect(afterLate.transcriptCipher).toBeNull();
    expect(afterLate.recordingStatus).toBe("purged");
  });

  it("purges an archived client fully 30 days after service ends", async () => {
    const { client } = await seedClient("Gone Co", { retentionDays: 365 });
    await applyRetellCall(endedPayload(client.retellAgentId!, "call_gone", { recording_url: undefined }));
    const serviceEndsAt = new Date(startMs + 86_400_000);
    await prisma.client.update({ where: { id: client.id }, data: { archivedAt: serviceEndsAt, serviceEndsAt, status: "churned" } });
    const early = await purgeExpiredCalls({ deleteObject: async () => undefined }, new Date(serviceEndsAt.getTime() + 29 * 86_400_000));
    expect(early.purged).toBe(0);
    const late = await purgeExpiredCalls({ deleteObject: async () => undefined }, new Date(serviceEndsAt.getTime() + 30 * 86_400_000));
    expect(late.purged).toBe(1);
  });

  it("validates retention and links a taken message to its call", async () => {
    const { client, owner, staff } = await seedClient();
    const ownerActor = { id: owner.id, role: "client_owner" as const, clientId: client.id };
    await expect(setCallRetention(ownerActor, { clientId: client.id, days: 6 })).rejects.toThrow(/between 7 and 365/);
    await expect(setCallRetention(ownerActor, { clientId: client.id, days: 366 })).rejects.toThrow(/between 7 and 365/);
    await expect(setCallRetention({ id: staff.id, role: "client_staff", clientId: client.id }, { clientId: client.id, days: 30 })).rejects.toThrow(/owner/);
    await setCallRetention(ownerActor, { clientId: client.id, days: 30 });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).callRetentionDays).toBe(30);
    expect(await prisma.changeLog.count({ where: { clientId: client.id, action: "calls.retention_changed" } })).toBe(1);

    await recordTakenMessage(client.id, { callerName: "Pat", callbackNumber: "+14155551212", message: "Furnace out" }, null, "call_link");
    const { callRecordId } = await applyRetellCall(endedPayload(client.retellAgentId!, "call_link", { recording_url: undefined }));
    const detail = await getCall(ownerActor, callRecordId!);
    expect(detail?.message).toMatchObject({ callerName: "Pat", body: "Furnace out" });
    const message = await prisma.clientMessage.findFirstOrThrow({ where: { clientId: client.id } });
    expect(message.retellCallId).toBe("call_link");
    // Message â†’ call: links only for viewers who may open the call.
    expect(await callLinksFor(ownerActor, client.id, [message.retellCallId, null, "call_unknown"])).toEqual(new Map([["call_link", callRecordId]]));
    expect((await callLinksFor({ id: staff.id, role: "client_staff", clientId: client.id, canViewCalls: false }, client.id, [message.retellCallId])).size).toBe(0);
  });

  it("resets a stuck pending recording and lists only stale pending rows for the sweep", async () => {
    const { client } = await seedClient();
    const agent = client.retellAgentId!;
    await applyRetellCall(endedPayload(agent, "call_fresh"));
    await applyRetellCall(endedPayload(agent, "call_stale"));
    await applyRetellCall(endedPayload(agent, "call_failed"));
    await markRecordingFailed("call_failed", "download failed");
    await applyRetellCall(endedPayload(agent, "call_stored"));
    await markRecordingStored("call_stored", { key: recordingKeyFor(client.id, "call_stored", "audio/wav"), contentType: "audio/wav", bytes: 10 });

    // Enqueue blip: roll pending back to none so the next event can re-queue.
    expect(await resetRecordingPending("call_fresh")).toEqual({ reset: true });
    expect((await prisma.callRecord.findUniqueOrThrow({ where: { retellCallId: "call_fresh" } })).recordingStatus).toBe("none");
    expect(await resetRecordingPending("call_fresh")).toEqual({ reset: false });
    expect(await resetRecordingPending("call_stored")).toEqual({ reset: false });
    expect(await resetRecordingPending("call_failed")).toEqual({ reset: false });

    // Put call_fresh back to pending (as a fresh enqueue would) and age only call_stale.
    await applyRetellCall(endedPayload(agent, "call_fresh"));
    const now = new Date();
    const staleAt = new Date(now.getTime() - STALE_RECORDING_PENDING_MS - 1_000);
    await prisma.callRecord.update({ where: { retellCallId: "call_stale" }, data: { updatedAt: staleAt } });

    expect(await listStalePendingRecordings(now)).toEqual(["call_stale"]);
    // Failed and stored never appear; a fresh pending is younger than the cutoff.
    expect(await listStalePendingRecordings(new Date(now.getTime() - STALE_RECORDING_PENDING_MS))).toEqual([]);
  });
});
