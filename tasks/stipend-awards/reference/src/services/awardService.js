"use strict";

const awardRepository = require("../repositories/awardRepository");
const stipendRepository = require("../repositories/stipendRepository");
const { ApiError } = require("./errors");

function serialize(award) {
  return {
    id: award.id,
    userId: award.userId,
    externalId: award.externalId,
    stipendId: award.stipendId,
    stipendCode: award.stipendCode,
    awardCents: award.awardCents,
    status: award.status,
    createdAt: award.createdAt,
  };
}

// Returns { status, award } so the route can map 200 (idempotent replay) vs 201.
async function createAward(user, body) {
  const { externalId, stipendCode } = body || {};
  if (
    typeof externalId !== "string" ||
    externalId.length < 1 ||
    typeof stipendCode !== "string" ||
    stipendCode.length < 1
  ) {
    throw new ApiError(400, "invalid award");
  }

  const stipend = await stipendRepository.findByCode(stipendCode);
  if (!stipend) {
    throw new ApiError(404, "stipend not found");
  }

  // Idempotency is keyed on (user, externalId) and takes precedence over limit
  // and budget checks: a replay returns the original award without re-spending.
  const existing = await awardRepository.findByUserAndExternalId(user.id, externalId);
  if (existing) {
    return { status: 200, award: serialize(existing) };
  }

  const activeForUser = await awardRepository.countActiveForUser(user.id, stipend.id);
  if (activeForUser >= stipend.perUserLimit) {
    throw new ApiError(409, "per-user limit exceeded");
  }

  const activeAwards = await awardRepository.findActiveForStipend(stipend.id);
  const awarded = activeAwards.reduce((sum, award) => sum + award.awardCents, 0);
  if (awarded + stipend.awardCents > stipend.budgetCents) {
    throw new ApiError(409, "stipend budget exceeded");
  }

  const award = await awardRepository.create({
    userId: user.id,
    stipendId: stipend.id,
    externalId,
    stipendCode: stipend.code,
    awardCents: stipend.awardCents,
    status: "active",
  });
  return { status: 201, award: serialize(award) };
}

async function rescindAward(user, awardId) {
  const award = await awardRepository.findById(awardId);
  if (!award) {
    throw new ApiError(404, "award not found");
  }
  if (award.userId !== user.id) {
    throw new ApiError(403, "award belongs to another user");
  }
  if (award.status === "rescinded") {
    throw new ApiError(409, "award already rescinded");
  }
  award.status = "rescinded";
  await awardRepository.save(award);
  return serialize(award);
}

module.exports = { createAward, rescindAward, serialize };
