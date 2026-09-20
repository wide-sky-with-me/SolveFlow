import { createExtensionRuntime, type Extension, type ResourceLoader, type Skill } from "@earendil-works/pi-coding-agent";

/** Accept only metadata admitted from reviewed resources. Never runs default
 * discovery of cwd, HOME, parent AGENTS, extensions, templates or themes. */
export function createApprovedResourceLoader(system: string, admittedSkills: readonly Skill[], admittedExtensions: readonly Extension[] = []): ResourceLoader {
  const skills = structuredClone([...admittedSkills]);
  if (skills.length > 16 || new Set(skills.map(skill => skill.name)).size !== skills.length) {
    throw new Error("INVALID_SKILL_CATALOG");
  }
  if (admittedExtensions.length > 16) throw new Error("INVALID_EXTENSION_CATALOG");
  const extensions = { extensions: [...admittedExtensions], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: structuredClone(skills), diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => system,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error("RESOURCE_EXTENSION_DENIED"); },
    reload: async () => {},
  };
}
