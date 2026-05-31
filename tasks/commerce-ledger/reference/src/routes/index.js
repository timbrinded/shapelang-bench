"use strict";

const express = require("express");
const userService = require("../services/userService");
const productService = require("../services/productService");
const orderService = require("../services/orderService");
const { ApiError } = require("../services/errors");

function sendError(res, error) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  return res.status(500).json({ error: "internal error" });
}

async function requireUser(req, res) {
  const user = await userService.authenticate(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "missing or invalid token" });
    return null;
  }
  return user;
}

function buildRouter() {
  const router = express.Router();

  router.get("/health-check", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  router.post("/users", async (req, res) => {
    try {
      res.status(201).json(await userService.createUser(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/products", async (req, res) => {
    try {
      res.status(201).json(await productService.createProduct(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/products", async (req, res) => {
    try {
      let threshold;
      const raw = req.query.lowStockThreshold;
      if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new ApiError(400, "invalid lowStockThreshold");
        }
        threshold = parsed;
      }
      res.status(200).json(await productService.listProducts(threshold));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/orders", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      res.status(201).json(await orderService.createOrder(user, req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/orders/:orderId", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      res.status(200).json(await orderService.getOrder(user, req.params.orderId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/orders/:orderId/cancel", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      res.status(200).json(await orderService.cancelOrder(user, req.params.orderId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/users/me/summary", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      res.status(200).json(await orderService.summaryForUser(user));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { buildRouter };
