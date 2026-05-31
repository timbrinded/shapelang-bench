"use strict";

const { Order } = require("../models");

async function create(data) {
  return Order.create(data);
}

async function findById(id) {
  return Order.findByPk(id);
}

async function findByUserAndExternalId(userId, externalId) {
  return Order.findOne({ where: { userId, externalId } });
}

async function countActiveForUser(userId, campaignId) {
  return Order.count({ where: { userId, campaignId, status: "active" } });
}

async function findActiveForCampaign(campaignId) {
  return Order.findAll({ where: { campaignId, status: "active" } });
}

async function findAllForCampaign(campaignId) {
  return Order.findAll({ where: { campaignId } });
}

async function save(order) {
  return order.save();
}

module.exports = {
  create,
  findById,
  findByUserAndExternalId,
  countActiveForUser,
  findActiveForCampaign,
  findAllForCampaign,
  save,
};
