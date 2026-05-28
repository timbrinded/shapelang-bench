import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.mjs";

const EXPECTED_ASSERTIONS = 44;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const badUser = await request("POST", "/api/users", {});
    check("invalid user returns 400", badUser.response.status === 400);

    const alice = await request("POST", "/api/users", { username: "alice" });
    check("create alice status", alice.response.status === 201, alice.text);
    check("alice shape", isObject(alice.json) && alice.json.username === "alice");
    check("alice token", typeof alice.json?.token === "string" && alice.json.token.length > 8);
    check("alice createdAt", isIsoString(alice.json?.createdAt));

    const duplicateAlice = await request("POST", "/api/users", { username: "alice" });
    check("duplicate user returns 409", duplicateAlice.response.status === 409);

    const bob = await request("POST", "/api/users", { username: "bob" });
    check("create bob status", bob.response.status === 201, bob.text);

    const doctor = await request("POST", "/api/doctors", {
      code: "cardio",
      name: "Dr Heart",
    });
    check("create doctor status", doctor.response.status === 201, doctor.text);
    check("doctor code", doctor.json?.code === "cardio");
    check("doctor createdAt", isIsoString(doctor.json?.createdAt));

    const duplicateDoctor = await request("POST", "/api/doctors", {
      code: "cardio",
      name: "Other",
    });
    check("duplicate doctor returns 409", duplicateDoctor.response.status === 409);

    const badAvailability = await request("POST", `/api/doctors/${doctor.json?.id}/availability`, {
      startsAt: "2026-06-01T12:00:00.000Z",
      endsAt: "2026-06-01T09:00:00.000Z",
    });
    check("invalid availability returns 400", badAvailability.response.status === 400);

    const availability = await request("POST", `/api/doctors/${doctor.json?.id}/availability`, {
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-01T12:00:00.000Z",
    });
    check("availability status", availability.response.status === 201, availability.text);
    check("availability doctor", availability.json?.doctorId === doctor.json?.id);

    const noAuth = await request("POST", "/api/appointments", {
      doctorId: doctor.json?.id,
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-01T10:00:00.000Z",
      reason: "checkup",
    });
    check("missing auth appointment returns 401", noAuth.response.status === 401);

    const outside = await request(
      "POST",
      "/api/appointments",
      {
        doctorId: doctor.json?.id,
        startsAt: "2026-06-01T08:00:00.000Z",
        endsAt: "2026-06-01T09:00:00.000Z",
        reason: "too early",
      },
      alice.json.token,
    );
    check("outside availability returns 409", outside.response.status === 409);

    const first = await request(
      "POST",
      "/api/appointments",
      {
        doctorId: doctor.json?.id,
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-01T10:00:00.000Z",
        reason: "checkup",
      },
      alice.json.token,
    );
    check("first appointment status", first.response.status === 201, first.text);
    check("first owner", first.json?.patientId === alice.json?.id);
    check("first status booked", first.json?.status === "booked");

    const overlap = await request(
      "POST",
      "/api/appointments",
      {
        doctorId: doctor.json?.id,
        startsAt: "2026-06-01T09:30:00.000Z",
        endsAt: "2026-06-01T10:30:00.000Z",
        reason: "overlap",
      },
      bob.json.token,
    );
    check("overlap returns 409", overlap.response.status === 409);

    const adjacent = await request(
      "POST",
      "/api/appointments",
      {
        doctorId: doctor.json?.id,
        startsAt: "2026-06-01T10:00:00.000Z",
        endsAt: "2026-06-01T11:00:00.000Z",
        reason: "adjacent",
      },
      bob.json.token,
    );
    check("adjacent appointment status", adjacent.response.status === 201, adjacent.text);
    check("adjacent owner", adjacent.json?.patientId === bob.json?.id);

    const scheduleBefore = await request("GET", `/api/doctors/${doctor.json?.id}/schedule`);
    check("schedule before status", scheduleBefore.response.status === 200, scheduleBefore.text);
    check("schedule before booked count", scheduleBefore.json?.bookedCount === 2);
    check("schedule before canceled count", scheduleBefore.json?.canceledCount === 0);
    check(
      "schedule before appointment ids",
      hasSameMembers(scheduleBefore.json?.appointments, [first.json?.id, adjacent.json?.id]),
    );

    const bobCancelAlice = await request(
      "POST",
      `/api/appointments/${first.json?.id}/cancel`,
      undefined,
      bob.json.token,
    );
    check("other patient cannot cancel", bobCancelAlice.response.status === 403);

    const cancel = await request(
      "POST",
      `/api/appointments/${first.json?.id}/cancel`,
      undefined,
      alice.json.token,
    );
    check("cancel status", cancel.response.status === 200, cancel.text);
    check("cancel changes status", cancel.json?.status === "canceled");

    const cancelAgain = await request(
      "POST",
      `/api/appointments/${first.json?.id}/cancel`,
      undefined,
      alice.json.token,
    );
    check("cancel twice returns 409", cancelAgain.response.status === 409);

    const freedSlot = await request(
      "POST",
      "/api/appointments",
      {
        doctorId: doctor.json?.id,
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-01T10:00:00.000Z",
        reason: "freed",
      },
      bob.json.token,
    );
    check("canceled slot can be rebooked", freedSlot.response.status === 201, freedSlot.text);

    const aliceAppointments = await request(
      "GET",
      "/api/users/me/appointments",
      undefined,
      alice.json.token,
    );
    check("alice appointments status", aliceAppointments.response.status === 200, aliceAppointments.text);
    check(
      "alice sees own canceled appointment only",
      Array.isArray(aliceAppointments.json) &&
        aliceAppointments.json.length === 1 &&
        aliceAppointments.json[0]?.id === first.json?.id &&
        aliceAppointments.json[0]?.status === "canceled",
    );

    const scheduleAfter = await request("GET", `/api/doctors/${doctor.json?.id}/schedule`);
    check("schedule after booked count", scheduleAfter.json?.bookedCount === 2);
    check("schedule after canceled count", scheduleAfter.json?.canceledCount === 1);
    check(
      "schedule after appointment ids",
      hasSameMembers(scheduleAfter.json?.appointments, [adjacent.json?.id, freedSlot.json?.id]),
    );
  } catch (error) {
    exception(error);
  }

  return result();
}

