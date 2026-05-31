"use strict";

const express = require("express");
const userService = require("../services/userService");
const campaignService = require("../services/campaignService");
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

  router.post("/campaigns", async (req, res) => {
    try {
      res.status(201).json(await campaignService.createCampaign(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/campaigns/:campaignId/summary", async (req, res) => {
    try {
      res.status(200).json(await campaignService.summary(Number(req.params.campaignId)));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/orders", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const { status, order } = await orderService.createOrder(user, req.body);
      res.status(status).json(order);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/orders/:orderId/cancel", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const order = await orderService.cancelOrder(user, Number(req.params.orderId));
      res.status(200).json(order);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { buildRouter };
