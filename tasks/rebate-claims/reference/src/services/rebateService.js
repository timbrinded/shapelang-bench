"use strict";

const rebateRepository = require("../repositories/rebateRepository");
const claimRepository = require("../repositories/claimRepository");
const { ApiError } = require("./errors");

function serialize(rebate) {
  return {
    id: rebate.id,
    code: rebate.code,
    payoutCents: rebate.payoutCents,
    budgetCents: rebate.budgetCents,
    perUserLimit: rebate.perUserLimit,
    createdAt: rebate.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

async function createRebate(body) {
  const { code, payoutCents, budgetCents, perUserLimit } = body || {};
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    !isPositiveInt(payoutCents) ||
    !isPositiveInt(budgetCents) ||
    !isPositiveInt(perUserLimit)
  ) {
    throw new ApiError(400, "invalid rebate");
  }
  const existing = await rebateRepository.findByCode(code);
  if (existing) {
    throw new ApiError(409, "rebate code already exists");
  }
  const rebate = await rebateRepository.create({
    code,
    payoutCents,
    budgetCents,
    perUserLimit,
  });
  return serialize(rebate);
}

async function summary(rebateId) {
  const rebate = await rebateRepository.findById(rebateId);
  if (!rebate) {
    throw new ApiError(404, "rebate not found");
  }
  const claims = await claimRepository.findAllForRebate(rebate.id);
  const active = claims.filter((claim) => claim.status === "active");
  const reversed = claims.filter((claim) => claim.status === "reversed");
  const paidOutCents = active.reduce((sum, claim) => sum + claim.payoutCents, 0);
  return {
    rebateId: rebate.id,
    activeClaimCount: active.length,
    reversedClaimCount: reversed.length,
    paidOutCents,
    remainingBudgetCents: rebate.budgetCents - paidOutCents,
    activeClaimIds: active.map((claim) => claim.id),
  };
}

module.exports = { createRebate, summary, serialize };
