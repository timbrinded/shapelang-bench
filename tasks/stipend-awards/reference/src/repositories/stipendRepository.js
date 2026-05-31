"use strict";

const { Stipend } = require("../models");

async function create(data) {
  return Stipend.create(data);
}

async function findByCode(code) {
  return Stipend.findOne({ where: { code } });
}

async function findById(id) {
  return Stipend.findByPk(id);
}

module.exports = { create, findByCode, findById };
