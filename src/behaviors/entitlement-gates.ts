import { createBehaviorHarness, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 39;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const account = await request("POST", "/api/accounts", { slug: "acme" });
    check("create account", account.response.status === 201, account.text);
    check("account shape", isObject(account.json) && account.json.slug === "acme");
    check("account createdAt", isIsoString(account.json?.createdAt));

    const duplicateAccount = await request("POST", "/api/accounts", { slug: "acme" });
    check("duplicate account returns 409", duplicateAccount.response.status === 409);

    const free = await request("POST", "/api/plans", { code: "free", monthlyQuota: 5 });
    check("create free plan", free.response.status === 201, free.text);

    const pro = await request("POST", "/api/plans", { code: "pro", monthlyQuota: 10 });
    check("create pro plan", pro.response.status === 201, pro.text);

    const duplicatePlan = await request("POST", "/api/plans", { code: "free", monthlyQuota: 5 });
    check("duplicate plan returns 409", duplicatePlan.response.status === 409);

    const subscription = await request("POST", "/api/subscriptions", {
      accountId: account.json?.id,
      planCode: "free",
      startsAt: "2026-06-01T00:00:00.000Z",
    });
    check("create subscription", subscription.response.status === 201, subscription.text);
    check("subscription active", subscription.json?.status === "active");

    const duplicateSubscription = await request("POST", "/api/subscriptions", {
      accountId: account.json?.id,
      planCode: "pro",
      startsAt: "2026-06-02T00:00:00.000Z",
    });
    check("duplicate active subscription returns 409", duplicateSubscription.response.status === 409);

    const beforeStartUsage = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 1,
      occurredAt: "2026-05-31T23:00:00.000Z",
    });
    check("usage before subscription returns 409", beforeStartUsage.response.status === 409);

    const usage1 = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 3,
      occurredAt: "2026-06-10T12:00:00.000Z",
    });
    check("usage 1 status", usage1.response.status === 201, usage1.text);
    check("usage 1 period", usage1.json?.period === "2026-06");

    const usage2 = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 2,
      occurredAt: "2026-06-11T12:00:00.000Z",
    });
    check("usage 2 status", usage2.response.status === 201, usage2.text);

    const overQuota = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 1,
      occurredAt: "2026-06-12T12:00:00.000Z",
    });
    check("over quota returns 409", overQuota.response.status === 409);

    const june = await request("GET", `/api/accounts/${account.json?.id}/entitlement?period=2026-06`);
    check("june entitlement status", june.response.status === 200, june.text);
    check("june used", june.json?.used === 5);
    check("june remaining", june.json?.remaining === 0);
    check("june allowed false", june.json?.allowed === false);

    const julyBefore = await request("GET", `/api/accounts/${account.json?.id}/entitlement?period=2026-07`);
    check("july separate period used", julyBefore.json?.used === 0);
    check("july separate period allowed", julyBefore.json?.allowed === true);

    const canceled = await request("POST", `/api/subscriptions/${subscription.json?.id}/cancel`);
    check("cancel subscription", canceled.response.status === 200, canceled.text);
    check("cancel changes status", canceled.json?.status === "canceled");

    const afterCancelUsage = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 1,
      occurredAt: "2026-07-01T12:00:00.000Z",
    });
    check("usage after cancel returns 409", afterCancelUsage.response.status === 409);

    const proSubscription = await request("POST", "/api/subscriptions", {
      accountId: account.json?.id,
      planCode: "pro",
      startsAt: "2026-07-01T00:00:00.000Z",
    });
    check("new subscription after cancel", proSubscription.response.status === 201, proSubscription.text);

    const julyUsage = await request("POST", "/api/usage-events", {
      accountId: account.json?.id,
      units: 7,
      occurredAt: "2026-07-02T12:00:00.000Z",
    });
    check("july usage accepted on pro", julyUsage.response.status === 201, julyUsage.text);

    const julyAfter = await request("GET", `/api/accounts/${account.json?.id}/entitlement?period=2026-07`);
    check("july plan is pro", julyAfter.json?.planCode === "pro");
    check("july quota is pro quota", julyAfter.json?.quota === 10);
    check("july used after pro usage", julyAfter.json?.used === 7);
    check("july remaining after pro usage", julyAfter.json?.remaining === 3);

    const cancelAgain = await request("POST", `/api/subscriptions/${subscription.json?.id}/cancel`);
    check("cancel twice returns 409", cancelAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
