"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../persistence/db");

const User = sequelize.define(
  "User",
  {
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    token: { type: DataTypes.STRING, allowNull: false, unique: true },
  },
  { tableName: "users" },
);

const Rebate = sequelize.define(
  "Rebate",
  {
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    payoutCents: { type: DataTypes.INTEGER, allowNull: false },
    budgetCents: { type: DataTypes.INTEGER, allowNull: false },
    perUserLimit: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "rebates" },
);

const Claim = sequelize.define(
  "Claim",
  {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    rebateId: { type: DataTypes.INTEGER, allowNull: false },
    externalId: { type: DataTypes.STRING, allowNull: false },
    payoutCents: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
  },
  {
    tableName: "claims",
    indexes: [{ unique: true, fields: ["userId", "externalId"] }],
  },
);

module.exports = { sequelize, User, Rebate, Claim };
