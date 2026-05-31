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

    const badCampaign = await request("POST", "/api/campaigns", {
      code: "BAD",
      discountCents: 0,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("invalid campaign returns 400", badCampaign.response.status === 400);

    const campaign = await request("POST", "/api/campaigns", {
      code: "SAVE10",
      discountCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("create campaign", campaign.response.status === 201, campaign.text);
    check("campaign shape", isObject(campaign.json) && campaign.json.code === "SAVE10");

    const duplicateCampaign = await request("POST", "/api/campaigns", {
      code: "SAVE10",
      discountCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("duplicate campaign returns 409", duplicateCampaign.response.status === 409);

    const noAuth = await request("POST", "/api/orders", {
      externalId: "no-auth",
      subtotalCents: 100,
      couponCode: "SAVE10",
    });
    check("missing auth order returns 401", noAuth.response.status === 401);

    const adaOrder = await request(
      "POST",
      "/api/orders",
      { externalId: "ada-1", subtotalCents: 100, couponCode: "SAVE10" },
      ada.json.token,
    );
    check("ada order status", adaOrder.response.status === 201, adaOrder.text);
    check("ada order discount", adaOrder.json?.discountCents === 10);

    const repeatAda = await request(
      "POST",
      "/api/orders",
      { externalId: "ada-1", subtotalCents: 100, couponCode: "SAVE10" },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same order", repeatAda.json?.id === adaOrder.json?.id);

    const adaLimit = await request(
      "POST",
      "/api/orders",
      { externalId: "ada-2", subtotalCents: 100, couponCode: "SAVE10" },
      ada.json.token,
    );
    check("per user limit returns 409", adaLimit.response.status === 409);

    const bobOrder = await request(
      "POST",
      "/api/orders",
      { externalId: "bob-1", subtotalCents: 100, couponCode: "SAVE10" },
      bob.json.token,
    );
    check("bob order status", bobOrder.response.status === 201, bobOrder.text);

    const budgetExceeded = await request(
      "POST",
      "/api/orders",
      { externalId: "cara-1", subtotalCents: 100, couponCode: "SAVE10" },
      cara.json.token,
    );
    check("budget exceeded returns 409", budgetExceeded.response.status === 409);

    const summaryFull = await request("GET", `/api/campaigns/${campaign.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeOrderCount === 2);
    check("summary spent full", summaryFull.json?.spentCents === 20);
    check("summary remaining full", summaryFull.json?.remainingBudgetCents === 0);

    const bobCancelAda = await request(
      "POST",
      `/api/orders/${adaOrder.json?.id}/cancel`,
      undefined,
      bob.json.token,
    );
    check("other user cancel returns 403", bobCancelAda.response.status === 403);

    const canceled = await request(
      "POST",
      `/api/orders/${adaOrder.json?.id}/cancel`,
      undefined,
      ada.json.token,
    );
    check("cancel order status", canceled.response.status === 200, canceled.text);
    check("cancel changes status", canceled.json?.status === "canceled");

    const summaryAfterCancel = await request("GET", `/api/campaigns/${campaign.json?.id}/summary`);
    check("summary active after cancel", summaryAfterCancel.json?.activeOrderCount === 1);
    check("summary canceled after cancel", summaryAfterCancel.json?.canceledOrderCount === 1);
    check("summary releases budget", summaryAfterCancel.json?.remainingBudgetCents === 10);
    check(
      "summary active ids after cancel",
      hasSameMembers(summaryAfterCancel.json?.activeOrderIds, [bobOrder.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/orders",
      { externalId: "ada-2", subtotalCents: 100, couponCode: "SAVE10" },
      ada.json.token,
    );
    check("canceled order releases user limit", adaSecond.response.status === 201, adaSecond.text);

    const cancelAgain = await request(
      "POST",
      `/api/orders/${adaOrder.json?.id}/cancel`,
      undefined,
      ada.json.token,
    );
    check("cancel twice returns 409", cancelAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
