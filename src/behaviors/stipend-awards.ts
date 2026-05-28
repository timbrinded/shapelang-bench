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

    const badStipend = await request("POST", "/api/stipends", {
      code: "BAD",
      awardCents: 0,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("invalid stipend returns 400", badStipend.response.status === 400);

    const stipend = await request("POST", "/api/stipends", {
      code: "FIELD",
      awardCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("create stipend", stipend.response.status === 201, stipend.text);
    check("stipend shape", isObject(stipend.json) && stipend.json.code === "FIELD");

    const duplicateStipend = await request("POST", "/api/stipends", {
      code: "FIELD",
      awardCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("duplicate stipend returns 409", duplicateStipend.response.status === 409);

    const noAuth = await request("POST", "/api/awards", {
      externalId: "no-auth",
      stipendCode: "FIELD",
    });
    check("missing auth award returns 401", noAuth.response.status === 401);

    const adaAward = await request(
      "POST",
      "/api/awards",
      { externalId: "ada-1", stipendCode: "FIELD" },
      ada.json.token,
    );
    check("ada award status", adaAward.response.status === 201, adaAward.text);
    check("ada award amount", adaAward.json?.awardCents === 10);

    const repeatAda = await request(
      "POST",
      "/api/awards",
      { externalId: "ada-1", stipendCode: "FIELD" },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same award", repeatAda.json?.id === adaAward.json?.id);

    const adaLimit = await request(
      "POST",
      "/api/awards",
      { externalId: "ada-2", stipendCode: "FIELD" },
      ada.json.token,
    );
    check("per user limit returns 409", adaLimit.response.status === 409);

    const bobAward = await request(
      "POST",
      "/api/awards",
      { externalId: "bob-1", stipendCode: "FIELD" },
      bob.json.token,
    );
    check("bob award status", bobAward.response.status === 201, bobAward.text);

    const budgetExceeded = await request(
      "POST",
      "/api/awards",
      { externalId: "cara-1", stipendCode: "FIELD" },
      cara.json.token,
    );
    check("budget exceeded returns 409", budgetExceeded.response.status === 409);

    const summaryFull = await request("GET", `/api/stipends/${stipend.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeAwardCount === 2);
    check("summary awarded full", summaryFull.json?.awardedCents === 20);
    check("summary remaining full", summaryFull.json?.remainingBudgetCents === 0);

    const bobRescindAda = await request(
      "POST",
      `/api/awards/${adaAward.json?.id}/rescind`,
      undefined,
      bob.json.token,
    );
    check("other user rescind returns 403", bobRescindAda.response.status === 403);

    const rescinded = await request(
      "POST",
      `/api/awards/${adaAward.json?.id}/rescind`,
      undefined,
      ada.json.token,
    );
    check("rescind award status", rescinded.response.status === 200, rescinded.text);
    check("rescind changes status", rescinded.json?.status === "rescinded");

    const summaryAfterRescind = await request("GET", `/api/stipends/${stipend.json?.id}/summary`);
    check("summary active after rescind", summaryAfterRescind.json?.activeAwardCount === 1);
    check("summary rescinded after rescind", summaryAfterRescind.json?.rescindedAwardCount === 1);
    check("summary releases budget", summaryAfterRescind.json?.remainingBudgetCents === 10);
    check(
      "summary active ids after rescind",
      hasSameMembers(summaryAfterRescind.json?.activeAwardIds, [bobAward.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/awards",
      { externalId: "ada-2", stipendCode: "FIELD" },
      ada.json.token,
    );
    check("rescinded award releases user limit", adaSecond.response.status === 201, adaSecond.text);

    const rescindAgain = await request(
      "POST",
      `/api/awards/${adaAward.json?.id}/rescind`,
      undefined,
      ada.json.token,
    );
    check("rescind twice returns 409", rescindAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
