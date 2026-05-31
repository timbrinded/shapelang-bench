"use strict";

const { User } = require("../models");

async function create(username, token) {
  return User.create({ username, token });
}

async function findByUsername(username) {
  return User.findOne({ where: { username } });
}

async function findByToken(token) {
  return User.findOne({ where: { token } });
}

module.exports = { create, findByUsername, findByToken };
