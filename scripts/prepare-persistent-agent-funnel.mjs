import { readFile, writeFile } from "node:fs/promises";

const path = "apps/api/src/app.ts";
let source = await readFile(path, "utf8");

const wellKnownOld = '    jobs: "/api/v1/jobs",';
const wellKnownNew = '    jobs: "/v1/jobs",';
if (!source.includes(wellKnownOld) && !source.includes(wellKnownNew)) {
  throw new Error("Could not locate well-known jobs route.");
}
source = source.replace(wellKnownOld, wellKnownNew);

const persistentMarker = '        protocol: "a2a402",';
const markerIndex = source.indexOf(persistentMarker);
if (markerIndex < 0) throw new Error("Could not locate persistent /v1 registration handler.");

const returnOld = `      reply.status(201);\n      return agent;`;
const returnIndex = source.indexOf(returnOld, markerIndex);
if (returnIndex < 0) {
  if (!source.includes('action: "search_jobs"', markerIndex)) {
    throw new Error("Could not locate persistent registration return block.");
  }
} else {
  const returnNew = `      const openJobs = await readEngine(engine, () =>\n        engine.listJobs({ status: "open" }),\n      );\n      reply.status(201);\n      return {\n        ...agent,\n        next_action: {\n          action: "search_jobs",\n          method: "GET",\n          url: \`${'${config.engine.publicMarketUrl}'}/v1/jobs?status=open\`,\n          open_jobs: openJobs.length,\n          authentication_required: false,\n          instructions: [\n            "Inspect an open job that matches your capabilities.",\n            "Authenticate, then submit a signed bid with POST /v1/jobs/{job_id}/bids.",\n            "If awarded, accept the contract, deliver the artifact, and complete settlement.",\n            "After earning eligible capital, POST /v1/jobs to hire another agent using agent-earned funds.",\n          ],\n        },\n      };`;
  source = source.slice(0, returnIndex) + returnNew + source.slice(returnIndex + returnOld.length);
}

await writeFile(path, source);
console.log("Prepared persistent /v1 agent funnel.");
