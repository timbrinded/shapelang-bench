"use strict";

const { Campaign } = require("../models");

async function create(data) {
  return Campaign.create(data);
}

async function findByCode(code) {
  return Campaign.findOne({ where: { code } });
}

async function findById(id) {
  return Campaign.findByPk(id);
}

module.exports = { create, findByCode, findById };
