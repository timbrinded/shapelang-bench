"use strict";

const productRepository = require("../repositories/productRepository");
const { ApiError } = require("./errors");

function serialize(product) {
  return {
    sku: product.sku,
    name: product.name,
    priceCents: product.priceCents,
    stock: product.stock,
    createdAt: product.createdAt,
  };
}

function isInt(value) {
  return Number.isInteger(value);
}

async function createProduct(body) {
  const { sku, name, priceCents, stock } = body || {};
  if (
    typeof sku !== "string" ||
    sku.length < 1 ||
    typeof name !== "string" ||
    name.length < 1 ||
    !isInt(priceCents) ||
    priceCents < 1 ||
    !isInt(stock) ||
    stock < 0
  ) {
    throw new ApiError(400, "invalid product");
  }
  const existing = await productRepository.findBySku(sku);
  if (existing) {
    throw new ApiError(409, "sku already exists");
  }
  const product = await productRepository.create({ sku, name, priceCents, stock });
  return serialize(product);
}

async function listProducts(lowStockThreshold) {
  const products = await productRepository.findAll();
  let filtered = products;
  if (lowStockThreshold !== undefined) {
    filtered = products.filter((product) => product.stock <= lowStockThreshold);
  }
  return filtered.map(serialize);
}

module.exports = { createProduct, listProducts, serialize };
