import fs from "node:fs";
import path from "node:path";
import solc from "solc";

export interface CompiledToken {
  abi: unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  compilerVersion: string;
}

export function compileA2A402Token(): CompiledToken {
  const sourcePath = path.resolve("contracts/A2A402Token.sol");
  const input = {
    language: "Solidity",
    sources: {
      "contracts/A2A402Token.sol": {
        content: fs.readFileSync(sourcePath, "utf8"),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import(importPath: string) {
        const resolved = path.resolve("node_modules", importPath);
        return fs.existsSync(resolved)
          ? { contents: fs.readFileSync(resolved, "utf8") }
          : { error: `Import not found: ${importPath}` };
      },
    }),
  ) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts?: Record<
      string,
      Record<
        string,
        {
          abi: unknown[];
          evm: {
            bytecode: { object: string };
            deployedBytecode: { object: string };
          };
        }
      >
    >;
  };
  const failures = (output.errors ?? []).filter(
    (error) => error.severity === "error",
  );
  if (failures.length)
    throw new Error(failures.map((error) => error.formattedMessage).join("\n"));
  const contract = output.contracts?.["contracts/A2A402Token.sol"]?.A2A402Token;
  if (!contract) throw new Error("A2A402Token compiler output was missing.");
  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    compilerVersion: solc.version(),
  };
}

if (process.argv[1]?.endsWith("compile-token.ts")) {
  const compiled = compileA2A402Token();
  process.stdout.write(
    JSON.stringify({
      compiler_version: compiled.compilerVersion,
      bytecode_bytes: (compiled.bytecode.length - 2) / 2,
    }) + "\n",
  );
}
