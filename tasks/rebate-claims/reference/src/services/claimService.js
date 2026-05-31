"use strict";

const claimRepository = require("../repositories/claimRepository");
const rebateRepository = require("../repositories/rebateRepository");
const { ApiError } = require("./errors");

function serialize(claim, rebateCode) {
  return {
    id: claim.id,
    userId: claim.userId,
    externalId: claim.externalId,
    rebateId: claim.rebateId,
    rebateCode,
    payoutCents: claim.payoutCents,
    status: claim.status,
    createdAt: claim.createdAt,
  };
}

// Returns { status, claim } so the route can map 200 (idempotent replay) vs 201.
async function createClaim(user, body) {
  const { externalId, rebateCode } = body || {};
  if (
    typeof externalId !== "string" ||
    externalId.length < 1 ||
    typeof rebateCode !== "string" ||
    rebateCode.length < 1
  ) {
    throw new ApiError(400, "invalid claim");
  }

  const rebate = await rebateRepository.findByCode(rebateCode);
  if (!rebate) {
    throw new ApiError(404, "rebate not found");
  }

  // Idempotency is keyed on (user, externalId) and takes precedence over limit
  // and budget checks: a replay returns the original claim without re-spending.
  const existing = await claimRepository.findByUserAndExternalId(user.id, externalId);
  if (existing) {
    return { status: 200, claim: serialize(existing, rebate.code) };
  }

  const activeForUser = await claimRepository.countActiveForUser(user.id, rebate.id);
  if (activeForUser >= rebate.perUserLimit) {
    throw new ApiError(409, "per-user limit exceeded");
  }

  const activeClaims = await claimRepository.findActiveForRebate(rebate.id);
  const paidOut = activeClaims.reduce((sum, claim) => sum + claim.payoutCents, 0);
  if (paidOut + rebate.payoutCents > rebate.budgetCents) {
    throw new ApiError(409, "rebate budget exceeded");
  }

  const claim = await claimRepository.create({
    userId: user.id,
    rebateId: rebate.id,
    externalId,
    payoutCents: rebate.payoutCents,
    status: "active",
  });
  return { status: 201, claim: serialize(claim, rebate.code) };
}

async function reverseClaim(user, claimId) {
  const claim = await claimRepository.findById(claimId);
  if (!claim) {
    throw new ApiError(404, "claim not found");
  }
  if (claim.userId !== user.id) {
    throw new ApiError(403, "claim belongs to another user");
  }
  if (claim.status === "reversed") {
    throw new ApiError(409, "claim already reversed");
  }
  claim.status = "reversed";
  await claimRepository.save(claim);
  const rebate = await rebateRepository.findById(claim.rebateId);
  return serialize(claim, rebate ? rebate.code : undefined);
}

module.exports = { createClaim, reverseClaim, serialize };
