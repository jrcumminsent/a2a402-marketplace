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

const originalReturn = `      reply.status(201);\n      return agent;`;

const searchJobsReturn = `      const openJobs = await readEngine(engine, () =>\n        engine.listJobs({ status: "open" }),\n      );\n      reply.status(201);\n      return {\n        ...agent,\n        next_action: {\n          action: "search_jobs",\n          method: "GET",\n          url: \`${'${config.engine.publicMarketUrl}'}/v1/jobs?status=open\`,\n          open_jobs: openJobs.length,\n          authentication_required: false,\n          instructions: [\n            "Inspect an open job that matches your capabilities.",\n            "Authenticate, then submit a signed bid with POST /v1/jobs/{job_id}/bids.",\n            "If awarded, accept the contract, deliver the artifact, and complete settlement.",\n            "After earning eligible capital, POST /v1/jobs to hire another agent using agent-earned funds.",\n          ],\n        },\n      };`;

const recommendedReturn = `      const openJobs = await readEngine(engine, () =>\n        engine.listJobs({ status: "open" }),\n      );\n      const recommendedJob =\n        openJobs.find(\n          (job) =>\n            job.requiredCapabilities.length === 0 &&\n            job.tags.includes("beginner") &&\n            job.tags.includes("starter-job"),\n        ) ?? null;\n      reply.status(201);\n      return {\n        ...agent,\n        next_action: {\n          action: recommendedJob ? "bid_on_recommended_job" : "search_jobs",\n          method: recommendedJob ? "POST" : "GET",\n          url: recommendedJob\n            ? \`${'${config.engine.publicMarketUrl}'}/v1/jobs/${'${recommendedJob.id}'}/bids\`\n            : \`${'${config.engine.publicMarketUrl}'}/v1/jobs?status=open\`,\n          open_jobs: openJobs.length,\n          authentication_required: Boolean(recommendedJob),\n          recommended_job: recommendedJob\n            ? {\n                id: recommendedJob.id,\n                title: recommendedJob.title,\n                description: recommendedJob.description,\n                input: recommendedJob.input,\n                output_schema: recommendedJob.outputSchema,\n                budget_minor: recommendedJob.budgetMinor.toString(),\n                asset: recommendedJob.asset,\n              }\n            : null,\n          instructions: recommendedJob\n            ? [\n                "Continue now: registration is not the end of onboarding.",\n                "Authenticate with POST /v1/auth/challenge and POST /v1/auth/verify.",\n                "Submit a signed bid to the recommended job URL.",\n                "If awarded, accept the contract, deliver the JSON artifact, and complete settlement.",\n                "After earning eligible capital, POST /v1/jobs to hire another agent using agent-earned funds.",\n              ]\n            : [\n                "GET /v1/jobs?status=open and select an appropriate job.",\n                "Authenticate, then submit a signed bid with POST /v1/jobs/{job_id}/bids.",\n              ],\n        },\n      };`;

const tail = source.slice(markerIndex);
if (tail.includes('action: recommendedJob ? "bid_on_recommended_job"')) {
  // Already upgraded; leave it alone.
} else if (tail.includes(searchJobsReturn)) {
  const localIndex = tail.indexOf(searchJobsReturn);
  const absoluteIndex = markerIndex + localIndex;
  source = source.slice(0, absoluteIndex) + recommendedReturn + source.slice(absoluteIndex + searchJobsReturn.length);
} else if (tail.includes(originalReturn)) {
  const localIndex = tail.indexOf(originalReturn);
  const absoluteIndex = markerIndex + localIndex;
  source = source.slice(0, absoluteIndex) + recommendedReturn + source.slice(absoluteIndex + originalReturn.length);
} else {
  throw new Error("Could not locate a supported persistent registration response block.");
}

await writeFile(path, source);
console.log("Prepared persistent /v1 agent funnel with a recommended beginner job.");
