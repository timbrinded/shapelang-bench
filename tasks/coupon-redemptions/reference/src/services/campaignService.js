"use strict";

const campaignRepository = require("../repositories/campaignRepository");
const orderRepository = require("../repositories/orderRepository");
const { ApiError } = require("./errors");

function serialize(campaign) {
  return {
    id: campaign.id,
    code: campaign.code,
    discountCents: campaign.discountCents,
    budgetCents: campaign.budgetCents,
    perUserLimit: campaign.perUserLimit,
    createdAt: campaign.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

async function createCampaign(body) {
  const { code, discountCents, budgetCents, perUserLimit } = body || {};
  if (
    typeof code !== "string" ||
    code.length < 1 ||
    !isPositiveInt(discountCents) ||
    !isPositiveInt(budgetCents) ||
    !isPositiveInt(perUserLimit)
  ) {
    throw new ApiError(400, "invalid campaign");
  }
  const existing = await campaignRepository.findByCode(code);
  if (existing) {
    throw new ApiError(409, "campaign code already exists");
  }
  const campaign = await campaignRepository.create({
    code,
    discountCents,
    budgetCents,
    perUserLimit,
  });
  return serialize(campaign);
}

async function summary(campaignId) {
  const campaign = await campaignRepository.findById(campaignId);
  if (!campaign) {
    throw new ApiError(404, "campaign not found");
  }
  const orders = await orderRepository.findAllForCampaign(campaign.id);
  const active = orders.filter((order) => order.status === "active");
  const canceled = orders.filter((order) => order.status === "canceled");
  const spentCents = active.reduce((sum, order) => sum + order.discountCents, 0);
  return {
    campaignId: campaign.id,
    activeOrderCount: active.length,
    canceledOrderCount: canceled.length,
    spentCents,
    remainingBudgetCents: campaign.budgetCents - spentCents,
    activeOrderIds: active.map((order) => order.id),
  };
}

module.exports = { createCampaign, summary, serialize };
