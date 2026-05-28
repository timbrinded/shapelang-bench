import { runBehaviorTests as runCommerceLedger } from "./behaviors/commerce-ledger.mjs";
import { runBehaviorTests as runCouponRedemptions } from "./behaviors/coupon-redemptions.mjs";
import { runBehaviorTests as runEntitlementGates } from "./behaviors/entitlement-gates.mjs";
import { runBehaviorTests as runGiftCardRedemptions } from "./behaviors/gift-card-redemptions.mjs";
import { runBehaviorTests as runGrantBudgets } from "./behaviors/grant-budgets.mjs";
import { runBehaviorTests as runPromoOrders } from "./behaviors/promo-orders.mjs";
import { runBehaviorTests as runRebateClaims } from "./behaviors/rebate-claims.mjs";
import { runBehaviorTests as runRefundLedger } from "./behaviors/refund-ledger.mjs";
import { runBehaviorTests as runStipendAwards } from "./behaviors/stipend-awards.mjs";
import { runBehaviorTests as runVoucherIssues } from "./behaviors/voucher-issues.mjs";
import { runBehaviorTests as runWarehouseLots } from "./behaviors/warehouse-lots.mjs";

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
