const { withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = config => withXcodeProject(config, async config => {
  const project = config.modResults, name = config.modRequest.projectName;
  const relative = path.join(name, 'SolveBackground.m');
  const target = path.join(config.modRequest.platformProjectRoot, relative);
  const { MAX_LOCAL_MODEL_RUNS } = await import('@solveflow/contracts/local');
  const source = (await fs.readFile(path.join(__dirname, 'solve-background/SolveBackground.m'), 'utf8')).replaceAll('__SOLVEFLOW_MAX_JOBS__', String(MAX_LOCAL_MODEL_RUNS));
  await fs.writeFile(target, source);
  const group = project.findPBXGroupKey({ name }) ?? project.findPBXGroupKey({ path: name });
  if (!group) throw new Error('IOS_APP_GROUP_REQUIRED');
  if (!project.hasFile(relative)) project.addSourceFile(relative, { target: project.getFirstTarget().uuid }, group);
  return config;
});
