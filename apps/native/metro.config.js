const { getDefaultConfig } = require("expo/metro-config");

// Expo detects the Bun workspace root automatically; no custom watchFolders needed.
module.exports = getDefaultConfig(__dirname);
