"use strict";

const { Claim } = require("../models");

async function create(data) {
  return Claim.create(data);
}

async function findById(id) {
  return Claim.findByPk(id);
}

async function findByUserAndExternalId(userId, externalId) {
  return Claim.findOne({ where: { userId, externalId } });
}

async function countActiveForUser(userId, grantId) {
  return Claim.count({ where: { userId, grantId, status: "active" } });
}

async function findActiveForGrant(grantId) {
  return Claim.findAll({ where: { grantId, status: "active" } });
}

async function findAllForGrant(grantId) {
  return Claim.findAll({ where: { grantId } });
}

async function save(claim) {
  return claim.save();
}

module.exports = {
  create,
  findById,
  findByUserAndExternalId,
  countActiveForUser,
  findActiveForGrant,
  findAllForGrant,
  save,
};
