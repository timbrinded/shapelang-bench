"use strict";

const { Product } = require("../models");

async function create(data) {
  return Product.create(data);
}

async function findBySku(sku) {
  return Product.findOne({ where: { sku } });
}

async function findAll() {
  return Product.findAll({ order: [["id", "ASC"]] });
}

async function save(product) {
  return product.save();
}

module.exports = { create, findBySku, findAll, save };
