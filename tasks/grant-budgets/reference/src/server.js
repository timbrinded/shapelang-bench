"use strict";

const express = require("express");
const { sequelize } = require("./models");
const { buildRouter } = require("./routes");

const app = express();
app.use(express.json());
app.use("/api", buildRouter());

const port = process.env.PORT ? Number(process.env.PORT) : 3137;

// Create the schema on startup, then listen at top level so `bun run start`
// brings the server up directly.
sequelize.sync().then(() => {
  app.listen(port, () => {
    console.log(`grant-budgets reference listening on ${port}`);
  });
});
