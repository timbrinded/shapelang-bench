"use strict";

const orderRepository = require("../repositories/orderRepository");
const productRepository = require("../repositories/productRepository");
const { ApiError } = require("./errors");

function serializeItem(item) {
  return {
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    lineTotalCents: item.lineTotalCents,
  };
}

function serialize(order, items) {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    totalCents: order.totalCents,
    items: items.map(serializeItem),
    createdAt: order.createdAt,
  };
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

async function createOrder(user, body) {
  const items = body && body.items;
  if (!Array.isArray(items) || items.length < 1) {
    throw new ApiError(400, "items are required");
  }
  for (const line of items) {
    if (
      !line ||
      typeof line.sku !== "string" ||
      line.sku.length < 1 ||
      !isPositiveInt(line.quantity)
    ) {
      throw new ApiError(400, "invalid order item");
    }
  }

  // Resolve every product first; a single missing product fails the whole order
  // with 404 and changes no stock.
  const resolved = [];
  for (const line of items) {
    const product = await productRepository.findBySku(line.sku);
    if (!product) {
      throw new ApiError(404, `product ${line.sku} not found`);
    }
    resolved.push({ product, quantity: line.quantity });
  }

  // Aggregate requested quantity per product so repeated SKUs are checked
  // against a single stock balance, then verify stock before mutating anything.
  const requestedBySku = new Map();
  for (const entry of resolved) {
    requestedBySku.set(entry.product.sku, (requestedBySku.get(entry.product.sku) || 0) + entry.quantity);
  }
  for (const entry of resolved) {
    if (entry.product.stock < requestedBySku.get(entry.product.sku)) {
      throw new ApiError(409, `insufficient stock for ${entry.product.sku}`);
    }
  }

  let totalCents = 0;
  const lines = [];
  for (const entry of resolved) {
    const lineTotalCents = entry.product.priceCents * entry.quantity;
    totalCents += lineTotalCents;
    lines.push({
      sku: entry.product.sku,
      name: entry.product.name,
      quantity: entry.quantity,
      unitPriceCents: entry.product.priceCents,
      lineTotalCents,
    });
  }

  const order = await orderRepository.create({
    userId: user.id,
    status: "placed",
    totalCents,
  });

  const persistedItems = [];
  for (const line of lines) {
    persistedItems.push(await orderRepository.createItem({ orderId: order.id, ...line }));
  }

  for (const entry of resolved) {
    entry.product.stock -= entry.quantity;
    await productRepository.save(entry.product);
  }

  return serialize(order, persistedItems);
}

async function getOrder(user, orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new ApiError(404, "order not found");
  }
  if (order.userId !== user.id) {
    throw new ApiError(403, "order belongs to another user");
  }
  const items = await orderRepository.findItemsForOrder(order.id);
  return serialize(order, items);
}

async function cancelOrder(user, orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new ApiError(404, "order not found");
  }
  if (order.userId !== user.id) {
    throw new ApiError(403, "order belongs to another user");
  }
  if (order.status === "canceled") {
    throw new ApiError(409, "order already canceled");
  }

  const items = await orderRepository.findItemsForOrder(order.id);
  // Restore stock for every line before flipping the status.
  for (const item of items) {
    const product = await productRepository.findBySku(item.sku);
    if (product) {
      product.stock += item.quantity;
      await productRepository.save(product);
    }
  }

  order.status = "canceled";
  await orderRepository.save(order);
  return serialize(order, items);
}

async function summaryForUser(user) {
  const orders = await orderRepository.findAllForUser(user.id);
  const active = orders.filter((order) => order.status === "placed");
  const canceled = orders.filter((order) => order.status === "canceled");
  const totalSpentCents = active.reduce((sum, order) => sum + order.totalCents, 0);
  return {
    userId: user.id,
    activeOrderCount: active.length,
    canceledOrderCount: canceled.length,
    totalSpentCents,
    openOrderIds: active.map((order) => order.id),
  };
}

module.exports = { createOrder, getOrder, cancelOrder, summaryForUser, serialize };
