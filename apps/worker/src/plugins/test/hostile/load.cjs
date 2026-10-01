// CommonJS inside the hostile plugin: Module._load, the loader under require.
"use strict";

module.exports = {
  viaLoad: () => module.constructor._load("net", module, false),
};
