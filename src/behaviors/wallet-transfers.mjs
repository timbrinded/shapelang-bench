import { createBehaviorHarness, hasSameMembers, isObject } from "./helpers.mjs";

const EXPECTED_ASSERTIONS = 45;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const alice = await request("POST", "/api/users", { username: "alice" });
    check("create alice", alice.response.status === 201, alice.text);
    check("alice token", typeof alice.json?.token === "string" && alice.json.token.length > 8);

    const bob = await request("POST", "/api/users", { username: "bob" });
    check("create bob", bob.response.status === 201, bob.text);

    const duplicateAlice = await request("POST", "/api/users", { username: "alice" });
    check("duplicate user returns 409", duplicateAlice.response.status === 409);

    const noAuthAccount = await request("POST", "/api/accounts", { name: "cash" });
    check("missing auth account returns 401", noAuthAccount.response.status === 401);

    const aliceAccount = await request("POST", "/api/accounts", { name: "cash" }, alice.json.token);
    check("create alice account", aliceAccount.response.status === 201, aliceAccount.text);
    check("alice account owner", aliceAccount.json?.userId === alice.json?.id);
    check("alice account balance zero", aliceAccount.json?.balanceCents === 0);

    const bobAccount = await request("POST", "/api/accounts", { name: "cash" }, bob.json.token);
    check("create bob account", bobAccount.response.status === 201, bobAccount.text);

    const badDeposit = await request(
      "POST",
      `/api/accounts/${aliceAccount.json?.id}/deposits`,
      { amountCents: -1 },
      alice.json.token,
    );
    check("bad deposit returns 400", badDeposit.response.status === 400);

    const deposit = await request(
      "POST",
      `/api/accounts/${aliceAccount.json?.id}/deposits`,
      { amountCents: 1000 },
      alice.json.token,
    );
    check("deposit status", deposit.response.status === 201, deposit.text);
    check("deposit amount", deposit.json?.amountCents === 1000);

    const bobDepositAlice = await request(
      "POST",
      `/api/accounts/${aliceAccount.json?.id}/deposits`,
      { amountCents: 1 },
      bob.json.token,
    );
    check("other user cannot deposit", bobDepositAlice.response.status === 403);

    const aliceAccountAfterDeposit = await request(
      "GET",
      `/api/accounts/${aliceAccount.json?.id}`,
      undefined,
      alice.json.token,
    );
    check("balance after deposit", aliceAccountAfterDeposit.json?.balanceCents === 1000);

    const bobGetAlice = await request(
      "GET",
      `/api/accounts/${aliceAccount.json?.id}`,
      undefined,
      bob.json.token,
    );
    check("other user cannot inspect account", bobGetAlice.response.status === 403);

    const transfer = await request(
      "POST",
      "/api/transfers",
      {
        fromAccountId: aliceAccount.json?.id,
        toAccountId: bobAccount.json?.id,
        amountCents: 300,
      },
      alice.json.token,
      { "Idempotency-Key": "transfer-1" },
    );
    check("transfer status", transfer.response.status === 201, transfer.text);
    check("transfer shape", isObject(transfer.json) && transfer.json.amountCents === 300);

    const repeatTransfer = await request(
      "POST",
      "/api/transfers",
      {
        fromAccountId: aliceAccount.json?.id,
        toAccountId: bobAccount.json?.id,
        amountCents: 300,
      },
      alice.json.token,
      { "Idempotency-Key": "transfer-1" },
    );
    check("repeat transfer returns existing", repeatTransfer.response.status === 200);
    check("repeat transfer same id", repeatTransfer.json?.id === transfer.json?.id);

    const aliceAfterTransfer = await request(
      "GET",
      `/api/accounts/${aliceAccount.json?.id}`,
      undefined,
      alice.json.token,
    );
    check("alice balance after transfer", aliceAfterTransfer.json?.balanceCents === 700);

    const bobAfterTransfer = await request(
      "GET",
      `/api/accounts/${bobAccount.json?.id}`,
      undefined,
      bob.json.token,
    );
    check("bob balance after transfer", bobAfterTransfer.json?.balanceCents === 300);

    const insufficient = await request(
      "POST",
      "/api/transfers",
      {
        fromAccountId: aliceAccount.json?.id,
        toAccountId: bobAccount.json?.id,
        amountCents: 9999,
      },
      alice.json.token,
      { "Idempotency-Key": "transfer-2" },
    );
    check("insufficient funds returns 409", insufficient.response.status === 409);

    const aliceAfterFailed = await request(
      "GET",
      `/api/accounts/${aliceAccount.json?.id}`,
      undefined,
      alice.json.token,
    );
    check("failed transfer does not debit", aliceAfterFailed.json?.balanceCents === 700);

    const aliceStatement = await request(
      "GET",
      `/api/accounts/${aliceAccount.json?.id}/statement`,
      undefined,
      alice.json.token,
    );
    check("alice statement status", aliceStatement.response.status === 200, aliceStatement.text);
    check("alice statement has two entries", Array.isArray(aliceStatement.json) && aliceStatement.json.length === 2);
    check(
      "alice statement amounts",
      hasSameMembers(
        aliceStatement.json?.map((entry) => entry.amountCents),
        [1000, -300],
      ),
    );

    const bobStatement = await request(
      "GET",
      `/api/accounts/${bobAccount.json?.id}/statement`,
      undefined,
      bob.json.token,
    );
    check("bob statement has one entry", Array.isArray(bobStatement.json) && bobStatement.json.length === 1);
    check("bob statement credit", bobStatement.json?.[0]?.amountCents === 300);

    const aliceSummary = await request("GET", "/api/users/me/summary", undefined, alice.json.token);
    check("alice summary account count", aliceSummary.json?.accountCount === 1);
    check("alice summary balance", aliceSummary.json?.totalBalanceCents === 700);
    check("alice summary ledger count", aliceSummary.json?.ledgerEntryCount === 2);

    const bobSummary = await request("GET", "/api/users/me/summary", undefined, bob.json.token);
    check("bob summary balance", bobSummary.json?.totalBalanceCents === 300);
    check("bob summary ledger count", bobSummary.json?.ledgerEntryCount === 1);
  } catch (error) {
    exception(error);
  }

  return result();
}

