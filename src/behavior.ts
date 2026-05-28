import { runBehaviorTests as runCommerceLedger } from "./behaviors/commerce-ledger.ts";
import { runBehaviorTests as runCouponRedemptions } from "./behaviors/coupon-redemptions.ts";
import { runBehaviorTests as runEntitlementGates } from "./behaviors/entitlement-gates.ts";
import { runBehaviorTests as runGiftCardRedemptions } from "./behaviors/gift-card-redemptions.ts";
import { runBehaviorTests as runGrantBudgets } from "./behaviors/grant-budgets.ts";
import { runBehaviorTests as runPromoOrders } from "./behaviors/promo-orders.ts";
import { runBehaviorTests as runRebateClaims } from "./behaviors/rebate-claims.ts";
import { runBehaviorTests as runRefundLedger } from "./behaviors/refund-ledger.ts";
import { runBehaviorTests as runStipendAwards } from "./behaviors/stipend-awards.ts";
import { runBehaviorTests as runVoucherIssues } from "./behaviors/voucher-issues.ts";
import { runBehaviorTests as runWarehouseLots } from "./behaviors/warehouse-lots.ts";

const runners = {
  "commerce-ledger": runCommerceLedger,
  "warehouse-lots": runWarehouseLots,
  "coupon-redemptions": runCouponRedemptions,
  "gift-card-redemptions": runGiftCardRedemptions,
  "grant-budgets": runGrantBudgets,
  "promo-orders": runPromoOrders,
  "rebate-claims": runRebateClaims,
  "refund-ledger": runRefundLedger,
  "voucher-issues": runVoucherIssues,
  "stipend-awards": runStipendAwards,
  "entitlement-gates": runEntitlementGates,
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
