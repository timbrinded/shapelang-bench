"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../persistence/db");

const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    token: { type: DataTypes.STRING, allowNull: false, unique: true },
  },
  { tableName: "users" },
);

const Product = sequelize.define(
  "Product",
  {
    sku: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    priceCents: { type: DataTypes.INTEGER, allowNull: false },
    stock: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "products" },
);

const Order = sequelize.define(
  "Order",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "placed" },
    totalCents: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "orders" },
);

const OrderItem = sequelize.define(
  "OrderItem",
  {
    orderId: { type: DataTypes.UUID, allowNull: false },
    sku: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    unitPriceCents: { type: DataTypes.INTEGER, allowNull: false },
    lineTotalCents: { type: DataTypes.INTEGER, allowNull: false },
  },
  { tableName: "order_items" },
);

module.exports = { sequelize, User, Product, Order, OrderItem };
