"use strict";

const express = require("express");
const userService = require("../services/userService");
const grantService = require("../services/grantService");
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

  router.post("/grants", async (req, res) => {
    try {
      res.status(201).json(await grantService.createGrant(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/grants/:grantId/summary", async (req, res) => {
    try {
      res.status(200).json(await grantService.summary(Number(req.params.grantId)));
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

  router.post("/claims/:claimId/void", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const claim = await claimService.voidClaim(user, Number(req.params.claimId));
      res.status(200).json(claim);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { buildRouter };
