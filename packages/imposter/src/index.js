"use strict";

const words = require("./config/words");
const engine = require("./engine/game-engine");

module.exports = {
  ...words,
  ...engine
};
