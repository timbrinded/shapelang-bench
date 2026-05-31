"use strict";

const crypto = require("crypto");
const userRepository = require("../repositories/userRepository");
const { ApiError } = require("./errors");

function serialize(user) {
  return {
    id: user.id,
    username: user.username,
    token: user.token,
    createdAt: user.createdAt,
  };
}

async function createUser(body) {
  const username = body && body.username;
  if (typeof username !== "string" || username.length < 1) {
    throw new ApiError(400, "username is required");
  }
  const existing = await userRepository.findByUsername(username);
  if (existing) {
    throw new ApiError(409, "username already exists");
  }
  const token = crypto.randomBytes(24).toString("hex");
  const user = await userRepository.create(username, token);
  return serialize(user);
}

async function authenticate(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.match(/^Token\s+(.+)$/i);
  if (!match) return null;
  return userRepository.findByToken(match[1]);
}

module.exports = { createUser, authenticate, serialize };
