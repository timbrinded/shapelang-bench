import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 31;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const ada = await request("POST", "/api/users", { username: "ada" });
    check("create ada", ada.response.status === 201, ada.text);
    check("ada token", typeof ada.json?.token === "string" && ada.json.token.length > 8);
    check("ada createdAt", isIsoString(ada.json?.createdAt));

    const bob = await request("POST", "/api/users", { username: "bob" });
    check("create bob", bob.response.status === 201, bob.text);

    const cara = await request("POST", "/api/users", { username: "cara" });
    check("create cara", cara.response.status === 201, cara.text);

    const badCard = await request("POST", "/api/cards", {
      code: "BAD",
      initialBalanceCents: 0,
    });
    check("invalid card returns 400", badCard.response.status === 400);

    const card = await request("POST", "/api/cards", {
      code: "GIFT20",
      initialBalanceCents: 20,
    });
    check("create card", card.response.status === 201, card.text);
    check("card shape", isObject(card.json) && card.json.code === "GIFT20");
    check("card balance starts full", card.json?.balanceCents === 20);

    const duplicateCard = await request("POST", "/api/cards", {
      code: "GIFT20",
      initialBalanceCents: 20,
    });
    check("duplicate card returns 409", duplicateCard.response.status === 409);

    const noAuth = await request("POST", "/api/charges", {
      externalId: "no-auth",
      cardCode: "GIFT20",
      amountCents: 7,
    });
    check("missing auth charge returns 401", noAuth.response.status === 401);

    const adaCharge = await request(
      "POST",
      "/api/charges",
      { externalId: "ada-1", cardCode: "GIFT20", amountCents: 7 },
      ada.json.token,
    );
    check("ada charge status", adaCharge.response.status === 201, adaCharge.text);
    check("ada charge amount", adaCharge.json?.amountCents === 7);

    const repeatAda = await request(
      "POST",
      "/api/charges",
      { externalId: "ada-1", cardCode: "GIFT20", amountCents: 7 },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same charge", repeatAda.json?.id === adaCharge.json?.id);

    const bobCharge = await request(
      "POST",
      "/api/charges",
      { externalId: "bob-1", cardCode: "GIFT20", amountCents: 13 },
      bob.json.token,
    );
    check("bob charge status", bobCharge.response.status === 201, bobCharge.text);

    const insufficient = await request(
      "POST",
      "/api/charges",
      { externalId: "cara-1", cardCode: "GIFT20", amountCents: 1 },
      cara.json.token,
    );
    check("insufficient balance returns 409", insufficient.response.status === 409);

    const summaryFull = await request("GET", `/api/cards/${card.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeChargeCount === 2);
    check("summary spent full", summaryFull.json?.spentCents === 20);
    check("summary balance full", summaryFull.json?.balanceCents === 0);

    const bobCancelAda = await request(
      "POST",
      `/api/charges/${adaCharge.json?.id}/cancel`,
      undefined,
      bob.json.token,
    );
    check("other user cancel returns 403", bobCancelAda.response.status === 403);

    const canceled = await request(
      "POST",
      `/api/charges/${adaCharge.json?.id}/cancel`,
      undefined,
      ada.json.token,
    );
    check("cancel charge status", canceled.response.status === 200, canceled.text);
    check("cancel changes status", canceled.json?.status === "canceled");

    const summaryAfterCancel = await request("GET", `/api/cards/${card.json?.id}/summary`);
    check("summary active after cancel", summaryAfterCancel.json?.activeChargeCount === 1);
    check("summary canceled after cancel", summaryAfterCancel.json?.canceledChargeCount === 1);
    check("summary restores balance", summaryAfterCancel.json?.balanceCents === 7);
    check(
      "summary active ids after cancel",
      hasSameMembers(summaryAfterCancel.json?.activeChargeIds, [bobCharge.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/charges",
      { externalId: "ada-2", cardCode: "GIFT20", amountCents: 7 },
      ada.json.token,
    );
    check("canceled charge releases balance", adaSecond.response.status === 201, adaSecond.text);

    const cancelAgain = await request(
      "POST",
      `/api/charges/${adaCharge.json?.id}/cancel`,
      undefined,
      ada.json.token,
    );
    check("cancel twice returns 409", cancelAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
