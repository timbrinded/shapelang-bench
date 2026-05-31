"use strict";

const claimRepository = require("../repositories/claimRepository");
const grantRepository = require("../repositories/grantRepository");
const { ApiError } = require("./errors");

function serialize(claim, grantCode) {
  return {
    id: claim.id,
    userId: claim.userId,
    externalId: claim.externalId,
    grantId: claim.grantId,
    grantCode,
    awardCents: claim.awardCents,
    status: claim.status,
    createdAt: claim.createdAt,
  };
}

// Returns { status, claim } so the route can map 200 (idempotent replay) vs 201.
async function createClaim(user, body) {
  const { externalId, grantCode } = body || {};
  if (
    typeof externalId !== "string" ||
    externalId.length < 1 ||
    typeof grantCode !== "string" ||
    grantCode.length < 1
  ) {
    throw new ApiError(400, "invalid claim");
  }

  const grant = await grantRepository.findByCode(grantCode);
  if (!grant) {
    throw new ApiError(404, "grant not found");
  }

  // Idempotency is keyed on (user, externalId) and takes precedence over limit
  // and budget checks: a replay returns the original claim without re-spending.
  const existing = await claimRepository.findByUserAndExternalId(user.id, externalId);
  if (existing) {
    return { status: 200, claim: serialize(existing, grant.code) };
  }

  const activeForUser = await claimRepository.countActiveForUser(user.id, grant.id);
  if (activeForUser >= grant.perUserLimit) {
    throw new ApiError(409, "per-user limit exceeded");
  }

  const activeClaims = await claimRepository.findActiveForGrant(grant.id);
  const awarded = activeClaims.reduce((sum, claim) => sum + claim.awardCents, 0);
  if (awarded + grant.awardCents > grant.budgetCents) {
    throw new ApiError(409, "grant budget exceeded");
  }

  const claim = await claimRepository.create({
    userId: user.id,
    grantId: grant.id,
    externalId,
    awardCents: grant.awardCents,
    status: "active",
  });
  return { status: 201, claim: serialize(claim, grant.code) };
}

async function voidClaim(user, claimId) {
  const claim = await claimRepository.findById(claimId);
  if (!claim) {
    throw new ApiError(404, "claim not found");
  }
  if (claim.userId !== user.id) {
    throw new ApiError(403, "claim belongs to another user");
  }
  if (claim.status === "voided") {
    throw new ApiError(409, "claim already voided");
  }
  claim.status = "voided";
  await claimRepository.save(claim);
  const grant = await grantRepository.findById(claim.grantId);
  return serialize(claim, grant ? grant.code : undefined);
}

module.exports = { createClaim, voidClaim, serialize };
