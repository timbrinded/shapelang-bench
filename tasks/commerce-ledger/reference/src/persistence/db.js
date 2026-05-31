"use strict";

const { Sequelize } = require("sequelize");

// SQLite persistence. In-memory so each process run starts with a clean schema
// created via sequelize.sync().
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: process.env.SQLITE_PATH || ":memory:",
  logging: false,
});

module.exports = { sequelize };
