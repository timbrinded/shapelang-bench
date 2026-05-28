import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.mjs";

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

    const badGrant = await request("POST", "/api/grants", {
      code: "BAD",
      awardCents: 0,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("invalid grant returns 400", badGrant.response.status === 400);

    const grant = await request("POST", "/api/grants", {
      code: "TRAVEL",
      awardCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("create grant", grant.response.status === 201, grant.text);
    check("grant shape", isObject(grant.json) && grant.json.code === "TRAVEL");

    const duplicateGrant = await request("POST", "/api/grants", {
      code: "TRAVEL",
      awardCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("duplicate grant returns 409", duplicateGrant.response.status === 409);

    const noAuth = await request("POST", "/api/claims", {
      externalId: "no-auth",
      grantCode: "TRAVEL",
    });
    check("missing auth claim returns 401", noAuth.response.status === 401);

    const adaClaim = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-1", grantCode: "TRAVEL" },
      ada.json.token,
    );
    check("ada claim status", adaClaim.response.status === 201, adaClaim.text);
    check("ada claim award", adaClaim.json?.awardCents === 10);

    const repeatAda = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-1", grantCode: "TRAVEL" },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same claim", repeatAda.json?.id === adaClaim.json?.id);

    const adaLimit = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-2", grantCode: "TRAVEL" },
      ada.json.token,
    );
    check("per user limit returns 409", adaLimit.response.status === 409);

    const bobClaim = await request(
      "POST",
      "/api/claims",
      { externalId: "bob-1", grantCode: "TRAVEL" },
      bob.json.token,
    );
    check("bob claim status", bobClaim.response.status === 201, bobClaim.text);

    const budgetExceeded = await request(
      "POST",
      "/api/claims",
      { externalId: "cara-1", grantCode: "TRAVEL" },
      cara.json.token,
    );
    check("budget exceeded returns 409", budgetExceeded.response.status === 409);

    const summaryFull = await request("GET", `/api/grants/${grant.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeClaimCount === 2);
    check("summary awarded full", summaryFull.json?.awardedCents === 20);
    check("summary remaining full", summaryFull.json?.remainingBudgetCents === 0);

    const bobVoidAda = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/void`,
      undefined,
      bob.json.token,
    );
    check("other user void returns 403", bobVoidAda.response.status === 403);

    const voided = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/void`,
      undefined,
      ada.json.token,
    );
    check("void claim status", voided.response.status === 200, voided.text);
    check("void changes status", voided.json?.status === "voided");

    const summaryAfterVoid = await request("GET", `/api/grants/${grant.json?.id}/summary`);
    check("summary active after void", summaryAfterVoid.json?.activeClaimCount === 1);
    check("summary voided after void", summaryAfterVoid.json?.voidedClaimCount === 1);
    check("summary releases budget", summaryAfterVoid.json?.remainingBudgetCents === 10);
    check(
      "summary active ids after void",
      hasSameMembers(summaryAfterVoid.json?.activeClaimIds, [bobClaim.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/claims",
      { externalId: "ada-2", grantCode: "TRAVEL" },
      ada.json.token,
    );
    check("voided claim releases user limit", adaSecond.response.status === 201, adaSecond.text);

    const voidAgain = await request(
      "POST",
      `/api/claims/${adaClaim.json?.id}/void`,
      undefined,
      ada.json.token,
    );
    check("void twice returns 409", voidAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
