const { withAppBuildGradle } = require('expo/config-plugins');
const marker = '// SolveFlow local DOM bootstrap';
module.exports = function withDomBootstrap(config) {
  return withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') throw new Error('Unsupported Android build script');
    if (!config.modResults.contents.includes(marker)) config.modResults.contents += `
${marker}
def solveFlowDomBootstrap = new File(rootDir, "../../../scripts/prepare-dom-bootstrap.mjs")
tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
    inputs.file(solveFlowDomBootstrap)
    doLast {
        def generatedAssets = jsBundleDir.get().asFile.absolutePath
        def prepared = providers.exec {
            commandLine("node", solveFlowDomBootstrap.absolutePath, generatedAssets)
        }
        logger.lifecycle(prepared.standardOutput.asText.get())
    }
}
`;
    return config;
  });
};
