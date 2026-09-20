import assert from "node:assert/strict";
import { createApprovedResourceLoader } from "../packages/agent/dist/pi/approved-resource-loader.js";
import { loadConfig, safeSummary } from "../packages/config/dist/index.js";
import * as contracts from "../packages/contracts/dist/agent.js";
import "./check-mobile-build.mjs";

assert.deepEqual(createApprovedResourceLoader("offline build probe", []).getSkills().skills, []);
assert.ok(safeSummary(loadConfig({})));
assert.ok(Object.keys(contracts).length > 0);
console.log("Built workspace modules load in plain Node without network calls.");
