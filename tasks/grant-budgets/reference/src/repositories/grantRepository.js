"use strict";

const { Grant } = require("../models");

async function create(data) {
  return Grant.create(data);
}

async function findByCode(code) {
  return Grant.findOne({ where: { code } });
}

async function findById(id) {
  return Grant.findByPk(id);
}

module.exports = { create, findByCode, findById };
