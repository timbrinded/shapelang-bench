"use strict";

const stipendRepository = require("../repositories/stipendRepository");
const awardRepository = require("../repositories/awardRepository");
const { ApiError } = require("./errors");

function serialize(stipend) {
  return {
    id: stipend.id,
    code: stipend.code,
    awardCents: stipend.awardCents,
    budgetCents: stipend.budgetCents,
    perUserLimit: stipend.perUserLimit,
    createdAt: stipend.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

async function createStipend(body) {
  const { code, awardCents, budgetCents, perUserLimit } = body || {};
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    !isPositiveInt(awardCents) ||
    !isPositiveInt(budgetCents) ||
    !isPositiveInt(perUserLimit)
  ) {
    throw new ApiError(400, "invalid stipend");
  }
  const existing = await stipendRepository.findByCode(code);
  if (existing) {
    throw new ApiError(409, "stipend code already exists");
  }
  const stipend = await stipendRepository.create({
    code,
    awardCents,
    budgetCents,
    perUserLimit,
  });
  return serialize(stipend);
}

async function summary(stipendId) {
  const stipend = await stipendRepository.findById(stipendId);
  if (!stipend) {
    throw new ApiError(404, "stipend not found");
  }
  const awards = await awardRepository.findAllForStipend(stipend.id);
  const active = awards.filter((award) => award.status === "active");
  const rescinded = awards.filter((award) => award.status === "rescinded");
  const awardedCents = active.reduce((sum, award) => sum + award.awardCents, 0);
  return {
    stipendId: stipend.id,
    activeAwardCount: active.length,
    rescindedAwardCount: rescinded.length,
    awardedCents,
    remainingBudgetCents: stipend.budgetCents - awardedCents,
    activeAwardIds: active.map((award) => award.id),
  };
}

module.exports = { createStipend, summary, serialize };
