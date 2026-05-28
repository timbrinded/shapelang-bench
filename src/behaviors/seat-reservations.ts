import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

function section(summary: any, name: string) {
  return Array.isArray(summary?.sections) ? summary.sections.find((entry) => entry.name === name) : null;
}

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(baseUrl, 63);
  const now = "2026-01-01T10:00:00.000Z";
  const afterExpiry = "2026-01-01T10:02:00.000Z";

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200);

    const ada = await request("POST", "/api/users", { username: "ada" });
    check("ada created", ada.response.status === 201);
    check("ada token", typeof ada.json?.token === "string" && ada.json.token.length > 8);
    check("ada id", typeof ada.json?.id === "string" && ada.json.id.length > 0);

    const bob = await request("POST", "/api/users", { username: "bob" });
    check("bob created", bob.response.status === 201);
    check("bob token", typeof bob.json?.token === "string" && bob.json.token.length > 8);

    const duplicateUser = await request("POST", "/api/users", { username: "ada" });
    check("duplicate user rejected", duplicateUser.response.status === 409);

    const badEvent = await request("POST", "/api/events", {
      code: "BAD",
      holdSeconds: 60,
      perUserActiveHoldLimit: 2,
      sections: [{ name: "floor", capacity: 0 }],
    });
    check("bad event rejected", badEvent.response.status === 400);

    const event = await request("POST", "/api/events", {
      code: "GALA",
      holdSeconds: 60,
      perUserActiveHoldLimit: 2,
      sections: [
        { name: "floor", capacity: 3 },
        { name: "balcony", capacity: 2 },
      ],
    });
    check("event created", event.response.status === 201);
    check("event shape", isObject(event.json) && event.json.code === "GALA");

    const duplicateEvent = await request("POST", "/api/events", {
      code: "GALA",
      holdSeconds: 60,
      perUserActiveHoldLimit: 2,
      sections: [{ name: "floor", capacity: 3 }],
    });
    check("duplicate event rejected", duplicateEvent.response.status === 409);

    const noAuthHold = await request("POST", "/api/holds", {
      eventCode: "GALA",
      externalId: "no-auth",
      now,
      seats: [{ section: "floor", quantity: 1 }],
    });
    check("hold requires auth", noAuthHold.response.status === 401);

    const unknownEventHold = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "MISSING",
        externalId: "missing",
        now,
        seats: [{ section: "floor", quantity: 1 }],
      },
      ada.json.token,
    );
    check("unknown event rejected", unknownEventHold.response.status === 404);

    const unknownSectionHold = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "missing-section",
        now,
        seats: [{ section: "mezzanine", quantity: 1 }],
      },
      ada.json.token,
    );
    check("unknown section rejected", unknownSectionHold.response.status === 404);

    const adaFloor = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-floor",
        now,
        seats: [{ section: "floor", quantity: 2 }],
      },
      ada.json.token,
    );
    check("ada floor hold created", adaFloor.response.status === 201);
    check("ada floor active", adaFloor.json?.status === "active");
    check("ada floor expiry", isIsoString(adaFloor.json?.expiresAt));
    check("ada floor owner", adaFloor.json?.userId === ada.json?.id);

    const duplicateAdaFloor = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-floor",
        now,
        seats: [{ section: "floor", quantity: 2 }],
      },
      ada.json.token,
    );
    check("duplicate hold returns existing", duplicateAdaFloor.response.status === 200);
    check("duplicate hold same id", duplicateAdaFloor.json?.id === adaFloor.json?.id);

    const conflictingAdaFloor = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-floor",
        now,
        seats: [{ section: "floor", quantity: 1 }],
      },
      ada.json.token,
    );
    check("conflicting hold rejected", conflictingAdaFloor.response.status === 409);

    const bobTooManyFloor = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "bob-too-many",
        now,
        seats: [{ section: "floor", quantity: 2 }],
      },
      bob.json.token,
    );
    check("capacity conflict rejected", bobTooManyFloor.response.status === 409);

    const bobMixed = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "bob-mixed",
        now,
        seats: [
          { section: "floor", quantity: 1 },
          { section: "balcony", quantity: 1 },
        ],
      },
      bob.json.token,
    );
    check("bob mixed hold created", bobMixed.response.status === 201);
    check("bob mixed sections", Array.isArray(bobMixed.json?.seats) && bobMixed.json.seats.length === 2);

    const adaBalcony = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-balcony",
        now,
        seats: [{ section: "balcony", quantity: 1 }],
      },
      ada.json.token,
    );
    check("ada balcony hold created", adaBalcony.response.status === 201);

    const adaTooManyActive = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-third",
        now,
        seats: [{ section: "balcony", quantity: 1 }],
      },
      ada.json.token,
    );
    check("per-user active hold limit enforced", adaTooManyActive.response.status === 409);

    const summaryHeld = await request("GET", `/api/events/${event.json?.id}/summary?now=${encodeURIComponent(now)}`);
    check("summary active ids", hasSameMembers(summaryHeld.json?.activeHoldIds, [adaFloor.json?.id, bobMixed.json?.id, adaBalcony.json?.id]));
    check("summary floor held", section(summaryHeld.json, "floor")?.activeHeld === 3);
    check("summary balcony held", section(summaryHeld.json, "balcony")?.activeHeld === 2);
    check("summary floor available zero", section(summaryHeld.json, "floor")?.available === 0);
    check("summary balcony available zero", section(summaryHeld.json, "balcony")?.available === 0);

    const wrongConfirm = await request("POST", `/api/holds/${bobMixed.json?.id}/confirm`, { now }, ada.json.token);
    check("wrong user cannot confirm", wrongConfirm.response.status === 403);

    const confirmBob = await request("POST", `/api/holds/${bobMixed.json?.id}/confirm`, { now }, bob.json.token);
    check("bob confirm status", confirmBob.response.status === 200);
    check("bob confirmed", confirmBob.json?.status === "confirmed");
    check("bob confirmation id", typeof confirmBob.json?.reservationId === "string" && confirmBob.json.reservationId.length > 0);

    const cancelConfirmed = await request("POST", `/api/holds/${bobMixed.json?.id}/cancel`, undefined, bob.json.token);
    check("confirmed hold cannot cancel", cancelConfirmed.response.status === 409);

    const wrongCancel = await request("POST", `/api/holds/${adaFloor.json?.id}/cancel`, undefined, bob.json.token);
    check("wrong user cannot cancel", wrongCancel.response.status === 403);

    const cancelAdaFloor = await request("POST", `/api/holds/${adaFloor.json?.id}/cancel`, undefined, ada.json.token);
    check("ada floor cancel status", cancelAdaFloor.response.status === 200);
    check("ada floor canceled", cancelAdaFloor.json?.status === "canceled");

    const repeatCancel = await request("POST", `/api/holds/${adaFloor.json?.id}/cancel`, undefined, ada.json.token);
    check("repeat cancel rejected", repeatCancel.response.status === 409);

    const summaryAfterCancel = await request("GET", `/api/events/${event.json?.id}/summary?now=${encodeURIComponent(now)}`);
    check("after cancel floor confirmed", section(summaryAfterCancel.json, "floor")?.confirmed === 1);
    check("after cancel floor available", section(summaryAfterCancel.json, "floor")?.available === 2);
    check("after cancel balcony held", section(summaryAfterCancel.json, "balcony")?.activeHeld === 1);
    check("after cancel canceled ids", hasSameMembers(summaryAfterCancel.json?.canceledHoldIds, [adaFloor.json?.id]));
    check("after cancel confirmed ids", hasSameMembers(summaryAfterCancel.json?.confirmedHoldIds, [bobMixed.json?.id]));

    const expire = await request("POST", `/api/events/${event.json?.id}/expire-holds`, { now: afterExpiry });
    check("expire status", expire.response.status === 200);
    check("expire count", expire.json?.expiredCount === 1);
    check("expire ids", hasSameMembers(expire.json?.expiredHoldIds, [adaBalcony.json?.id]));

    const confirmExpired = await request("POST", `/api/holds/${adaBalcony.json?.id}/confirm`, { now: afterExpiry }, ada.json.token);
    check("expired hold cannot confirm", confirmExpired.response.status === 409);

    const summaryAfterExpire = await request("GET", `/api/events/${event.json?.id}/summary?now=${encodeURIComponent(afterExpiry)}`);
    check("after expire active empty", hasSameMembers(summaryAfterExpire.json?.activeHoldIds, []));
    check("after expire expired ids", hasSameMembers(summaryAfterExpire.json?.expiredHoldIds, [adaBalcony.json?.id]));
    check("after expire floor available", section(summaryAfterExpire.json, "floor")?.available === 2);
    check("after expire balcony available", section(summaryAfterExpire.json, "balcony")?.available === 1);

    const bobFinal = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "bob-final",
        now: afterExpiry,
        seats: [
          { section: "floor", quantity: 2 },
          { section: "balcony", quantity: 1 },
        ],
      },
      bob.json.token,
    );
    check("bob final hold created", bobFinal.response.status === 201);

    const adaNoCapacity = await request(
      "POST",
      "/api/holds",
      {
        eventCode: "GALA",
        externalId: "ada-no-capacity",
        now: afterExpiry,
        seats: [{ section: "balcony", quantity: 1 }],
      },
      ada.json.token,
    );
    check("no capacity after final hold", adaNoCapacity.response.status === 409);

    const confirmFinal = await request("POST", `/api/holds/${bobFinal.json?.id}/confirm`, { now: afterExpiry }, bob.json.token);
    check("confirm final status", confirmFinal.response.status === 200);
    check("confirm final confirmed", confirmFinal.json?.status === "confirmed");

    const finalSummary = await request("GET", `/api/events/${event.json?.id}/summary?now=${encodeURIComponent(afterExpiry)}`);
    check("final active empty", hasSameMembers(finalSummary.json?.activeHoldIds, []));
    check("final floor confirmed full", section(finalSummary.json, "floor")?.confirmed === 3);
    check("final balcony confirmed full", section(finalSummary.json, "balcony")?.confirmed === 2);
    check("final floor available zero", section(finalSummary.json, "floor")?.available === 0);
    check("final balcony available zero", section(finalSummary.json, "balcony")?.available === 0);
    check("final confirmed ids", hasSameMembers(finalSummary.json?.confirmedHoldIds, [bobMixed.json?.id, bobFinal.json?.id]));
  } catch (error) {
    exception(error);
  }

  return result();
}
