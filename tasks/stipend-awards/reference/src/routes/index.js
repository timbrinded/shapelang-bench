"use strict";

const express = require("express");
const userService = require("../services/userService");
const stipendService = require("../services/stipendService");
const awardService = require("../services/awardService");
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

  router.post("/stipends", async (req, res) => {
    try {
      res.status(201).json(await stipendService.createStipend(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/stipends/:stipendId/summary", async (req, res) => {
    try {
      res.status(200).json(await stipendService.summary(Number(req.params.stipendId)));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/awards", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const { status, award } = await awardService.createAward(user, req.body);
      res.status(status).json(award);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/awards/:awardId/rescind", async (req, res) => {
    try {
      const user = await requireUser(req, res);
      if (!user) return;
      const award = await awardService.rescindAward(user, Number(req.params.awardId));
      res.status(200).json(award);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

module.exports = { buildRouter };
