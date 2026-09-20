import type { ApprovedSkillManifest } from "./skill-admission.js";
/** Reviewed student resources only; this list grants no tool permissions. */
export const approvedSkills = [
  { name: "exams", directory: "exams", files: ["SKILL.md", "references/sat.md", "references/act.md", "references/ap.md"], requiredTools: [] },
  { name: "general", directory: "general", files: ["SKILL.md"], requiredTools: [] },
  { name: "math", directory: "math", files: ["SKILL.md", "references/algebra.md"], requiredTools: ["calculate"] },
  { name: "diagram", directory: "diagram", files: ["SKILL.md", "references/example.md", "references/economics.md"], requiredTools: ["calculate"] },
  { name: "economics", directory: "economics", files: ["SKILL.md"], requiredTools: ["calculate"] },
  { name: "physics", directory: "physics", files: ["SKILL.md", "references/models.md"], requiredTools: ["calculate"] },
  { name: "chemistry", directory: "chemistry", files: ["SKILL.md", "references/stoichiometry.md"], requiredTools: ["calculate"] },
  { name: "biology", directory: "biology", files: ["SKILL.md", "references/genetics-and-experiments.md"], requiredTools: ["calculate"] },
] as const satisfies readonly ApprovedSkillManifest[];
