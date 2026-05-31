"use strict";

const { Award } = require("../models");

async function create(data) {
  return Award.create(data);
}

async function findById(id) {
  return Award.findByPk(id);
}

async function findByUserAndExternalId(userId, externalId) {
  return Award.findOne({ where: { userId, externalId } });
}

async function countActiveForUser(userId, stipendId) {
  return Award.count({ where: { userId, stipendId, status: "active" } });
}

async function findActiveForStipend(stipendId) {
  return Award.findAll({ where: { stipendId, status: "active" } });
}

async function findAllForStipend(stipendId) {
  return Award.findAll({ where: { stipendId } });
}

async function save(award) {
  return award.save();
}

module.exports = {
  create,
  findById,
  findByUserAndExternalId,
  countActiveForUser,
  findActiveForStipend,
  findAllForStipend,
  save,
};
