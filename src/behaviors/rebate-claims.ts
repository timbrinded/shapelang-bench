import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 31;

export async function runBehaviorTests(baseUrl: string) {
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

    const badRebate = await request("POST", "/api/rebates", {
      code: "BAD",
      payoutCents: 0,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("invalid rebate returns 400", badRebate.response.status === 400);

    const rebate = await request("POST", "/api/rebates", {
      code: "GREEN",
      payoutCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("create rebate", rebate.response.status === 201, rebate.text);
    check("rebate shape", isObject(rebate.json) && rebate.json.code === "GREEN");

    const duplicateRebate = await request("POST", "/api/rebates", {
      code: "GREEN",
      payoutCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("duplicate rebate returns 409", duplicateRebate.response.status === 409);

    const noAuth = await request("POST", "/api/claims", {
      externalId: "no-auth",
      rebateCode: "GREEN",
    });
    check("missing auth claim returns 401", noAuth.response.status === 401);

    const adaClaim = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-1", rebateCode: "GREEN" },
      ada.json.token,
    );
    check("ada claim status", adaClaim.response.status === 201, adaClaim.text);
    check("ada claim payout", adaClaim.json?.payoutCents === 10);

    const repeatAda = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-1", rebateCode: "GREEN" },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same claim", repeatAda.json?.id === adaClaim.json?.id);

    const adaLimit = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-2", rebateCode: "GREEN" },
      ada.json.token,
    );
    check("per user limit returns 409", adaLimit.response.status === 409);

    const bobClaim = await request(
      "POST",
      "/api/claims",
      { externalId: "bob-1", rebateCode: "GREEN" },
      bob.json.token,
    );
    check("bob claim status", bobClaim.response.status === 201, bobClaim.text);

    const budgetExceeded = await request(
      "POST",
      "/api/claims",
      { externalId: "cara-1", rebateCode: "GREEN" },
      cara.json.token,
    );
    check("budget exceeded returns 409", budgetExceeded.response.status === 409);

    const summaryFull = await request("GET", `/api/rebates/${rebate.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeClaimCount === 2);
    check("summary paid full", summaryFull.json?.paidOutCents === 20);
    check("summary remaining full", summaryFull.json?.remainingBudgetCents === 0);

    const bobReverseAda = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/reverse`,
      undefined,
      bob.json.token,
    );
    check("other user reverse returns 403", bobReverseAda.response.status === 403);

    const reversed = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/reverse`,
      undefined,
      ada.json.token,
    );
    check("reverse claim status", reversed.response.status === 200, reversed.text);
    check("reverse changes status", reversed.json?.status === "reversed");

    const summaryAfterReverse = await request("GET", `/api/rebates/${rebate.json?.id}/summary`);
    check("summary active after reverse", summaryAfterReverse.json?.activeClaimCount === 1);
    check("summary reversed after reverse", summaryAfterReverse.json?.reversedClaimCount === 1);
    check("summary releases budget", summaryAfterReverse.json?.remainingBudgetCents === 10);
    check(
      "summary active ids after reverse",
      hasSameMembers(summaryAfterReverse.json?.activeClaimIds, [bobClaim.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-2", rebateCode: "GREEN" },
      ada.json.token,
    );
    check("reversed claim releases user limit", adaSecond.response.status === 201, adaSecond.text);

    const reverseAgain = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/reverse`,
      undefined,
      ada.json.token,
    );
    check("reverse twice returns 409", reverseAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
