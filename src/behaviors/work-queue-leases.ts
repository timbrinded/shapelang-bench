import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

function sameOrder(actual: unknown, expected: unknown[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => actual[index] === item);
}

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(baseUrl, 74);
  const now = "2026-01-01T00:00:00.000Z";
  const retrySoon = "2026-01-01T00:00:05.000Z";
  const later = "2026-01-01T00:05:00.000Z";
  const expired = "2026-01-01T00:01:00.000Z";

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200);

    const ada = await request("POST", "/api/workers", { name: "ada" });
    check("ada created", ada.response.status === 201);
    check("ada token", typeof ada.json?.token === "string" && ada.json.token.length > 8);
    check("ada id", typeof ada.json?.id === "string" && ada.json.id.length > 0);

    const bob = await request("POST", "/api/workers", { name: "bob" });
    check("bob created", bob.response.status === 201);
    check("bob token", typeof bob.json?.token === "string" && bob.json.token.length > 8);

    const duplicateWorker = await request("POST", "/api/workers", { name: "ada" });
    check("duplicate worker rejected", duplicateWorker.response.status === 409);

    const badQueue = await request("POST", "/api/queues", {
      name: "email",
      maxAttempts: 0,
      leaseSeconds: 30,
    });
    check("bad queue rejected", badQueue.response.status === 400);

    const queue = await request("POST", "/api/queues", {
      name: "email",
      maxAttempts: 3,
      leaseSeconds: 30,
    });
    check("queue created", queue.response.status === 201);
    check("queue shape", isObject(queue.json) && queue.json.name === "email");

    const duplicateQueue = await request("POST", "/api/queues", {
      name: "email",
      maxAttempts: 3,
      leaseSeconds: 30,
    });
    check("duplicate queue rejected", duplicateQueue.response.status === 409);

    const missingQueueJob = await request("POST", "/api/jobs", {
      queueName: "missing",
      externalId: "missing-1",
      payload: { kind: "email" },
      priority: 1,
      runAt: now,
    });
    check("missing queue job rejected", missingQueueJob.response.status === 404);

    const jobA = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-a",
      payload: { kind: "email", to: "a@example.com" },
      priority: 5,
      runAt: now,
    });
    const jobB = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-b",
      payload: { kind: "email", to: "b@example.com" },
      priority: 10,
      runAt: now,
    });
    const jobC = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-c",
      payload: { kind: "email", to: "c@example.com" },
      priority: 5,
      runAt: later,
    });
    check("job A created", jobA.response.status === 201);
    check("job B created", jobB.response.status === 201);
    check("job C created", jobC.response.status === 201);
    check("job attempts start zero", jobA.json?.attempts === 0 && jobB.json?.attempts === 0);

    const duplicateJobA = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-a",
      payload: { kind: "email", to: "a@example.com" },
      priority: 5,
      runAt: now,
    });
    check("duplicate job returns existing", duplicateJobA.response.status === 200);
    check("duplicate job same id", duplicateJobA.json?.id === jobA.json?.id);

    const conflictingJobA = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-a",
      payload: { kind: "email", to: "changed@example.com" },
      priority: 5,
      runAt: now,
    });
    check("conflicting idempotency rejected", conflictingJobA.response.status === 409);

    const initialSummary = await request("GET", `/api/queues/${queue.json?.id}/summary?now=${encodeURIComponent(now)}`);
    check("initial queued count", initialSummary.json?.queuedCount === 3);
    check("initial ready count", initialSummary.json?.readyCount === 2);
    check("initial scheduled count", initialSummary.json?.scheduledCount === 1);
    check("initial ready ordering", sameOrder(initialSummary.json?.readyJobIds, [jobB.json?.id, jobA.json?.id]));
    check("initial scheduled ids", hasSameMembers(initialSummary.json?.scheduledJobIds, [jobC.json?.id]));

    const noAuthClaim = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now });
    check("claim requires auth", noAuthClaim.response.status === 401);

    const adaClaim = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now }, ada.json.token);
    check("ada claim status", adaClaim.response.status === 200);
    check("ada claims highest priority", adaClaim.json?.id === jobB.json?.id);
    check("ada claim worker", adaClaim.json?.leasedByWorkerId === ada.json?.id);
    check("ada claim attempt", adaClaim.json?.attempts === 1);
    check("ada claim expiry", isIsoString(adaClaim.json?.leaseExpiresAt));

    const bobClaim = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now }, bob.json.token);
    check("bob claim status", bobClaim.response.status === 200);
    check("bob claims next ready", bobClaim.json?.id === jobA.json?.id);
    check("bob claim attempt", bobClaim.json?.attempts === 1);

    const noReady = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now }, ada.json.token);
    check("scheduled job not claimed early", noReady.response.status === 204);

    const wrongComplete = await request("POST", `/api/jobs/${jobB.json?.id}/complete`, { result: { ok: true } }, bob.json.token);
    check("wrong worker cannot complete", wrongComplete.response.status === 403);

    const completeB = await request("POST", `/api/jobs/${jobB.json?.id}/complete`, { result: { ok: true } }, ada.json.token);
    check("complete status", completeB.response.status === 200);
    check("complete terminal status", completeB.json?.status === "completed");

    const repeatComplete = await request("POST", `/api/jobs/${jobB.json?.id}/complete`, { result: { ok: true } }, ada.json.token);
    check("repeat complete rejected", repeatComplete.response.status === 409);

    const wrongFail = await request("POST", `/api/jobs/${jobA.json?.id}/fail`, { error: "nope", retryAt: retrySoon }, ada.json.token);
    check("wrong worker cannot fail", wrongFail.response.status === 403);

    const failA1 = await request("POST", `/api/jobs/${jobA.json?.id}/fail`, { error: "temporary", retryAt: retrySoon }, bob.json.token);
    check("first fail status", failA1.response.status === 200);
    check("first fail requeues", failA1.json?.status === "queued");
    check("first fail keeps attempts", failA1.json?.attempts === 1);

    const beforeRetry = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now }, ada.json.token);
    check("retryAt prevents immediate reclaim", beforeRetry.response.status === 204);

    const adaClaimRetry = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now: retrySoon }, ada.json.token);
    check("retry claim status", adaClaimRetry.response.status === 200);
    check("retry claim same job", adaClaimRetry.json?.id === jobA.json?.id);
    check("retry increments attempt", adaClaimRetry.json?.attempts === 2);

    const failA2 = await request("POST", `/api/jobs/${jobA.json?.id}/fail`, { error: "again", retryAt: retrySoon }, ada.json.token);
    check("second fail requeues", failA2.response.status === 200 && failA2.json?.status === "queued");

    const bobClaimFinal = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now: retrySoon }, bob.json.token);
    check("third claim same job", bobClaimFinal.json?.id === jobA.json?.id);
    check("third claim attempts", bobClaimFinal.json?.attempts === 3);

    const failA3 = await request("POST", `/api/jobs/${jobA.json?.id}/fail`, { error: "dead", retryAt: retrySoon }, bob.json.token);
    check("third fail status", failA3.response.status === 200);
    check("third fail dead letters", failA3.json?.status === "dead");

    const jobD = await request("POST", "/api/jobs", {
      queueName: "email",
      externalId: "job-d",
      payload: { kind: "email", to: "d@example.com" },
      priority: 1,
      runAt: now,
    });
    check("job D created", jobD.response.status === 201);

    const bobClaimD = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now }, bob.json.token);
    check("bob claims D", bobClaimD.response.status === 200 && bobClaimD.json?.id === jobD.json?.id);

    const earlyReap = await request("POST", `/api/queues/${queue.json?.id}/reap`, { now });
    check("early reap none", earlyReap.response.status === 200 && earlyReap.json?.reapedCount === 0);

    const activeLeaseSummary = await request("GET", `/api/queues/${queue.json?.id}/summary?now=${encodeURIComponent(now)}`);
    check("active lease count", activeLeaseSummary.json?.leasedCount === 1);
    check("active lease ids", hasSameMembers(activeLeaseSummary.json?.leasedJobIds, [jobD.json?.id]));

    const expiredReap = await request("POST", `/api/queues/${queue.json?.id}/reap`, { now: expired });
    check("expired reap count", expiredReap.response.status === 200 && expiredReap.json?.reapedCount === 1);
    check("expired reap id", hasSameMembers(expiredReap.json?.reapedJobIds, [jobD.json?.id]));

    const adaClaimD = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now: expired }, ada.json.token);
    check("ada reclaims D", adaClaimD.response.status === 200 && adaClaimD.json?.id === jobD.json?.id);
    check("reclaim increments attempts", adaClaimD.json?.attempts === 2);

    const wrongRelease = await request("POST", `/api/jobs/${jobD.json?.id}/release`, { reason: "busy" }, bob.json.token);
    check("wrong worker cannot release", wrongRelease.response.status === 403);

    const releaseD = await request("POST", `/api/jobs/${jobD.json?.id}/release`, { reason: "busy" }, ada.json.token);
    check("release status", releaseD.response.status === 200);
    check("release requeues", releaseD.json?.status === "queued");

    const bobClaimD2 = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now: expired }, bob.json.token);
    check("bob reclaims released D", bobClaimD2.response.status === 200 && bobClaimD2.json?.id === jobD.json?.id);
    check("release reclaim attempts", bobClaimD2.json?.attempts === 3);

    const completeD = await request("POST", `/api/jobs/${jobD.json?.id}/complete`, { result: { ok: true } }, bob.json.token);
    check("complete D", completeD.response.status === 200 && completeD.json?.status === "completed");

    const scheduledClaim = await request("POST", `/api/queues/${queue.json?.id}/claim`, { now: later }, ada.json.token);
    check("scheduled job eventually ready", scheduledClaim.response.status === 200 && scheduledClaim.json?.id === jobC.json?.id);

    const finalSummary = await request("GET", `/api/queues/${queue.json?.id}/summary?now=${encodeURIComponent(later)}`);
    check("final queued count", finalSummary.json?.queuedCount === 0);
    check("final leased count", finalSummary.json?.leasedCount === 1);
    check("final completed count", finalSummary.json?.completedCount === 2);
    check("final dead count", finalSummary.json?.deadCount === 1);
    check("final completed ids", hasSameMembers(finalSummary.json?.completedJobIds, [jobB.json?.id, jobD.json?.id]));
    check("final dead ids", hasSameMembers(finalSummary.json?.deadJobIds, [jobA.json?.id]));
    check("final leased ids", hasSameMembers(finalSummary.json?.leasedJobIds, [jobC.json?.id]));
  } catch (error) {
    exception(error);
  }

  return result();
}
