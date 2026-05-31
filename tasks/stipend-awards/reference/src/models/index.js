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

const Stipend = sequelize.define(
  "Stipend",
  {
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    awardCents: { type: DataTypes.INTEGER, allowNull: false },
    budgetCents: { type: DataTypes.INTEGER, allowNull: false },
    perUserLimit: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "stipends" },
);

const Award = sequelize.define(
  "Award",
  {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    stipendId: { type: DataTypes.INTEGER, allowNull: false },
    externalId: { type: DataTypes.STRING, allowNull: false },
    stipendCode: { type: DataTypes.STRING, allowNull: false },
    awardCents: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
  },
  {
    tableName: "awards",
    indexes: [{ unique: true, fields: ["userId", "externalId"] }],
  },
);

module.exports = { sequelize, User, Stipend, Award };
