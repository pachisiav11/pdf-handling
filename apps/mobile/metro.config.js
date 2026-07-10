const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * Monorepo-aware Metro config: watch the whole workspace so @pdfx/core
 * (consumed as TypeScript source) resolves and hot-reloads.
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
