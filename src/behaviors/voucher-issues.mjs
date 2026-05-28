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

    const badProgram = await request("POST", "/api/programs", {
      code: "BAD",
      valueCents: 0,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("invalid program returns 400", badProgram.response.status === 400);

    const program = await request("POST", "/api/programs", {
      code: "WELCOME",
      valueCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("create program", program.response.status === 201, program.text);
    check("program shape", isObject(program.json) && program.json.code === "WELCOME");

    const duplicateProgram = await request("POST", "/api/programs", {
      code: "WELCOME",
      valueCents: 10,
      budgetCents: 20,
      perUserLimit: 1,
    });
    check("duplicate program returns 409", duplicateProgram.response.status === 409);

    const noAuth = await request("POST", "/api/issues", {
      externalId: "no-auth",
      programCode: "WELCOME",
    });
    check("missing auth issue returns 401", noAuth.response.status === 401);

    const adaIssue = await request(
      "POST",
      "/api/issues",
      { externalId: "ada-1", programCode: "WELCOME" },
      ada.json.token,
    );
    check("ada issue status", adaIssue.response.status === 201, adaIssue.text);
    check("ada issue value", adaIssue.json?.valueCents === 10);

    const repeatAda = await request(
      "POST",
      "/api/issues",
      { externalId: "ada-1", programCode: "WELCOME" },
      ada.json.token,
    );
    check("repeat external id returns 200", repeatAda.response.status === 200);
    check("repeat external id same issue", repeatAda.json?.id === adaIssue.json?.id);

    const adaLimit = await request(
      "POST",
      "/api/issues",
      { externalId: "ada-2", programCode: "WELCOME" },
      ada.json.token,
    );
    check("per user limit returns 409", adaLimit.response.status === 409);

    const bobIssue = await request(
      "POST",
      "/api/issues",
      { externalId: "bob-1", programCode: "WELCOME" },
      bob.json.token,
    );
    check("bob issue status", bobIssue.response.status === 201, bobIssue.text);

    const budgetExceeded = await request(
      "POST",
      "/api/issues",
      { externalId: "cara-1", programCode: "WELCOME" },
      cara.json.token,
    );
    check("budget exceeded returns 409", budgetExceeded.response.status === 409);

    const summaryFull = await request("GET", `/api/programs/${program.json?.id}/summary`);
    check("summary full status", summaryFull.response.status === 200, summaryFull.text);
    check("summary active count full", summaryFull.json?.activeIssueCount === 2);
    check("summary issued full", summaryFull.json?.issuedCents === 20);
    check("summary remaining full", summaryFull.json?.remainingBudgetCents === 0);

    const bobRevokeAda = await request(
      "POST",
      `/api/issues/${adaIssue.json?.id}/revoke`,
      undefined,
      bob.json.token,
    );
    check("other user revoke returns 403", bobRevokeAda.response.status === 403);

    const revoked = await request(
      "POST",
      `/api/issues/${adaIssue.json?.id}/revoke`,
      undefined,
      ada.json.token,
    );
    check("revoke issue status", revoked.response.status === 200, revoked.text);
    check("revoke changes status", revoked.json?.status === "revoked");

    const summaryAfterRevoke = await request("GET", `/api/programs/${program.json?.id}/summary`);
    check("summary active after revoke", summaryAfterRevoke.json?.activeIssueCount === 1);
    check("summary revoked after revoke", summaryAfterRevoke.json?.revokedIssueCount === 1);
    check("summary releases budget", summaryAfterRevoke.json?.remainingBudgetCents === 10);
    check(
      "summary active ids after revoke",
      hasSameMembers(summaryAfterRevoke.json?.activeIssueIds, [bobIssue.json?.id]),
    );

    const adaSecond = await request(
      "POST",
      "/api/issues",
      { externalId: "ada-2", programCode: "WELCOME" },
      ada.json.token,
    );
    check("revoked issue releases user limit", adaSecond.response.status === 201, adaSecond.text);

    const revokeAgain = await request(
      "POST",
      `/api/issues/${adaIssue.json?.id}/revoke`,
      undefined,
      ada.json.token,
    );
    check("revoke twice returns 409", revokeAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
