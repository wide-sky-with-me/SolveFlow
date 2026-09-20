const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const path = require('node:path');
config.resolver.resolveRequest = (context, moduleName, platform) => moduleName === '@solveflow/agent/mobile' ? { type: 'sourceFile', filePath: path.resolve(__dirname, '.generated/agent.mjs') } : context.resolveRequest(context, moduleName, platform);
module.exports = config;
