const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * Monorepo-aware Metro config: watch the whole workspace so @pdfx/core
 * (consumed as TypeScript source) resolves and hot-reloads.
 *
 * `@pdfx/core/mobile` is aliased explicitly to its source file. The core
 * package.json exposes it via an `exports` map, but Metro's package-exports
 * support is opt-in and enabling it globally changes resolution for every
 * other dependency — a targeted alias is safer.
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === '@pdfx/core/mobile') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(workspaceRoot, 'packages/core/src/mobile.ts'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
