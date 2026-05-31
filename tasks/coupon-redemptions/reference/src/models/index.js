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

const Campaign = sequelize.define(
  "Campaign",
  {
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    discountCents: { type: DataTypes.INTEGER, allowNull: false },
    budgetCents: { type: DataTypes.INTEGER, allowNull: false },
    perUserLimit: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "campaigns" },
);

const Order = sequelize.define(
  "Order",
  {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    campaignId: { type: DataTypes.INTEGER, allowNull: false },
    externalId: { type: DataTypes.STRING, allowNull: false },
    subtotalCents: { type: DataTypes.INTEGER, allowNull: false },
    discountCents: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "active" },
  },
  {
    tableName: "orders",
    indexes: [{ unique: true, fields: ["userId", "externalId"] }],
  },
);

module.exports = { sequelize, User, Campaign, Order };
