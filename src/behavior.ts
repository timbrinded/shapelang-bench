import { runBehaviorTests as runCommerceLedger } from "./behaviors/commerce-ledger.ts";
import { runBehaviorTests as runCouponRedemptions } from "./behaviors/coupon-redemptions.ts";
import { runBehaviorTests as runGrantBudgets } from "./behaviors/grant-budgets.ts";
import { runBehaviorTests as runRebateClaims } from "./behaviors/rebate-claims.ts";
import { runBehaviorTests as runStipendAwards } from "./behaviors/stipend-awards.ts";

const runners = {
  "commerce-ledger": runCommerceLedger,
  "coupon-redemptions": runCouponRedemptions,
  "grant-budgets": runGrantBudgets,
  "rebate-claims": runRebateClaims,
  "stipend-awards": runStipendAwards,
};

export async function runBehaviorTests(taskId, baseUrl) {
  const runner = runners[taskId];
  if (!runner) {
    return {
      assertionsPassed: 0,
      assertionsTotal: 1,
      assertionPassRate: 0,
      failures: [{ name: "unknown task", detail: taskId }],
    };
  }
  return runner(baseUrl);
}
