"use strict";

const grantRepository = require("../repositories/grantRepository");
const claimRepository = require("../repositories/claimRepository");
const { ApiError } = require("./errors");

function serialize(grant) {
  return {
    id: grant.id,
    code: grant.code,
    awardCents: grant.awardCents,
    budgetCents: grant.budgetCents,
    perUserLimit: grant.perUserLimit,
    createdAt: grant.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

async function createGrant(body) {
  const { code, awardCents, budgetCents, perUserLimit } = body || {};
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    !isPositiveInt(awardCents) ||
    !isPositiveInt(budgetCents) ||
    !isPositiveInt(perUserLimit)
  ) {
    throw new ApiError(400, "invalid grant");
  }
  const existing = await grantRepository.findByCode(code);
  if (existing) {
    throw new ApiError(409, "grant code already exists");
  }
  const grant = await grantRepository.create({
    code,
    awardCents,
    budgetCents,
    perUserLimit,
  });
  return serialize(grant);
}

async function summary(grantId) {
  const grant = await grantRepository.findById(grantId);
  if (!grant) {
    throw new ApiError(404, "grant not found");
  }
  const claims = await claimRepository.findAllForGrant(grant.id);
  const active = claims.filter((claim) => claim.status === "active");
  const voided = claims.filter((claim) => claim.status === "voided");
  const awardedCents = active.reduce((sum, claim) => sum + claim.awardCents, 0);
  return {
    grantId: grant.id,
    activeClaimCount: active.length,
    voidedClaimCount: voided.length,
    awardedCents,
    remainingBudgetCents: grant.budgetCents - awardedCents,
    activeClaimIds: active.map((claim) => claim.id),
  };
}

module.exports = { createGrant, summary, serialize };
