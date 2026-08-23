import { runEconomyDemo } from "../apps/demo-agents/src/economy.js";

const report = await runEconomyDemo({ silent: true, asset: "A2A402" });
process.stdout.write(
  `${JSON.stringify(
    {
      mode: report.mode,
      warning: "Simulation fixture only; no Base Sepolia transaction was sent.",
      lifecycle: report.proof,
      fees: report.fees,
      receipts: report.receipts,
      provenance_lineage: report.provenance_lineage,
      accounting_invariants: report.accounting_invariants,
    },
    null,
    2,
  )}\n`,
);
