"use strict";

const { Order, OrderItem } = require("../models");

async function create(data) {
  return Order.create(data);
}

async function findById(id) {
  return Order.findByPk(id);
}

async function findAllForUser(userId) {
  return Order.findAll({ where: { userId }, order: [["id", "ASC"]] });
}

async function save(order) {
  return order.save();
}

async function createItem(data) {
  return OrderItem.create(data);
}

async function findItemsForOrder(orderId) {
  return OrderItem.findAll({ where: { orderId }, order: [["id", "ASC"]] });
}

module.exports = {
  create,
  findById,
  findAllForUser,
  save,
  createItem,
  findItemsForOrder,
};
