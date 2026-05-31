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

async function countActiveForUser(userId, rebateId) {
  return Claim.count({ where: { userId, rebateId, status: "active" } });
}

async function findActiveForRebate(rebateId) {
  return Claim.findAll({ where: { rebateId, status: "active" } });
}

async function findAllForRebate(rebateId) {
  return Claim.findAll({ where: { rebateId } });
}

async function save(claim) {
  return claim.save();
}

module.exports = {
  create,
  findById,
  findByUserAndExternalId,
  countActiveForUser,
  findActiveForRebate,
  findAllForRebate,
  save,
};
