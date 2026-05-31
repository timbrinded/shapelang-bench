"use strict";

const { Sequelize } = require("sequelize");

// SQLite persistence. File-backed so state survives within a process run; the
// schema is created on startup via sequelize.sync().
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: process.env.SQLITE_PATH || "./data.sqlite",
  logging: false,
});

module.exports = { sequelize };
