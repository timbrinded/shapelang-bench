"use strict";

const express = require("express");
const userService = require("../services/userService");
const rebateService = require("../services/rebateService");
const claimService = require("../services/claimService");
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

  router.post("/rebates", async (req, res) => {
    try {
      res.status(201).json(await rebateService.createRebate(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/rebates/:rebateId/summary", async (req, res) => {
    try {
      res.status(200).json(await rebateService.summary(Number(req.params.rebateId)));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/claims", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const { status, claim } = await claimService.createClaim(user, req.body);
      res.status(status).json(claim);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/claims/:claimId/reverse", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const claim = await claimService.reverseClaim(user, Number(req.params.claimId));
      res.status(200).json(claim);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { buildRouter };
