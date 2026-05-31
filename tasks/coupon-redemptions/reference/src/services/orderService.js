"use strict";

const orderRepository = require("../repositories/orderRepository");
const campaignRepository = require("../repositories/campaignRepository");
const { ApiError } = require("./errors");

function serialize(order) {
  return {
    id: order.id,
    userId: order.userId,
    externalId: order.externalId,
    campaignId: order.campaignId,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    status: order.status,
    createdAt: order.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

// Returns { status, order } so the route can map 200 (idempotent replay) vs 201.
async function createOrder(user, body) {
  const { externalId, subtotalCents, couponCode } = body || {};
  if (
    typeof externalId !== "string" ||
    externalId.length < 1 ||
    !isPositiveInt(subtotalCents) ||
    typeof couponCode !== "string" ||
    couponCode.length < 1
  ) {
    throw new ApiError(400, "invalid order");
  }

  const campaign = await campaignRepository.findByCode(couponCode);
  if (!campaign) {
    throw new ApiError(404, "campaign not found");
  }

  // Idempotency is keyed on (user, externalId) and takes precedence over limit
  // and budget checks: a replay returns the original order without re-spending.
  const existing = await orderRepository.findByUserAndExternalId(user.id, externalId);
  if (existing) {
    return { status: 200, order: serialize(existing) };
  }

  const activeForUser = await orderRepository.countActiveForUser(user.id, campaign.id);
  if (activeForUser >= campaign.perUserLimit) {
    throw new ApiError(409, "per-user limit exceeded");
  }

  const activeOrders = await orderRepository.findActiveForCampaign(campaign.id);
  const spent = activeOrders.reduce((sum, order) => sum + order.discountCents, 0);
  if (spent + campaign.discountCents > campaign.budgetCents) {
    throw new ApiError(409, "campaign budget exceeded");
  }

  const order = await orderRepository.create({
    userId: user.id,
    campaignId: campaign.id,
    externalId,
    subtotalCents,
    discountCents: campaign.discountCents,
    status: "active",
  });
  return { status: 201, order: serialize(order) };
}

async function cancelOrder(user, orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new ApiError(404, "order not found");
  }
  if (order.userId !== user.id) {
    throw new ApiError(403, "order belongs to another user");
  }
  if (order.status === "canceled") {
    throw new ApiError(409, "order already canceled");
  }
  order.status = "canceled";
  await orderRepository.save(order);
  return serialize(order);
}

module.exports = { createOrder, cancelOrder, serialize };
