"use strict";

const { Rebate } = require("../models");

async function create(data) {
  return Rebate.create(data);
}

async function findByCode(code) {
  return Rebate.findOne({ where: { code } });
}

async function findById(id) {
  return Rebate.findByPk(id);
}

module.exports = { create, findByCode, findById };
