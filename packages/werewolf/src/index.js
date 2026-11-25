"use strict";

const roles = require("./config/roles");
const engine = require("./engine/game-engine");

module.exports = {
  ...roles,
  ...engine
};
