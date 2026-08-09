import { canonicalJson, type JsonValue } from "@a2a402/shared";
import { resolveJsonPointer } from "./json-pointer.js";
import type {
  DeterministicRule,
  EvaluationFinding,
  EvaluationInput,
  EvaluationResult,
  EvaluatorAdapter,
} from "./types.js";

export interface DeterministicRuleEvaluatorOptions {
  now?: () => Date;
  maxPatternLength?: number;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function evaluateRule(
  rule: DeterministicRule,
  input: unknown,
  maxPatternLength: number,
): { passed: boolean; actual: JsonValue } {
  const resolved = resolveJsonPointer(input, rule.path);
  const actual = (
    resolved.found ? JSON.parse(JSON.stringify(resolved.value)) : null
  ) as JsonValue;
  switch (rule.operator) {
    case "exists":
      return { passed: resolved.found, actual };
    case "equals":
      return {
        passed: resolved.found && jsonEqual(resolved.value, rule.expected),
        actual,
      };
    case "not_equals":
      return {
        passed: resolved.found && !jsonEqual(resolved.value, rule.expected),
        actual,
      };
    case "type":
      return {
        passed:
          resolved.found &&
          typeof rule.expected === "string" &&
          valueType(resolved.value) === rule.expected,
        actual,
      };
    case "minimum":
      return {
        passed:
          resolved.found &&
          typeof resolved.value === "number" &&
          Number.isFinite(resolved.value) &&
          rule.minimum !== undefined &&
          resolved.value >= rule.minimum,
        actual,
      };
    case "maximum":
      return {
        passed:
          resolved.found &&
          typeof resolved.value === "number" &&
          Number.isFinite(resolved.value) &&
          rule.maximum !== undefined &&
          resolved.value <= rule.maximum,
        actual,
      };
    case "matches": {
      if (
        !resolved.found ||
        typeof resolved.value !== "string" ||
        !rule.pattern ||
        rule.pattern.length > maxPatternLength
      ) {
        return { passed: false, actual };
      }
      try {
        return {
          passed: new RegExp(rule.pattern, rule.flags ?? "").test(
            resolved.value,
          ),
          actual,
        };
      } catch {
        return { passed: false, actual };
      }
    }
    case "includes":
      return {
        passed:
          resolved.found &&
          (typeof resolved.value === "string"
            ? typeof rule.expected === "string" &&
              resolved.value.includes(rule.expected)
            : Array.isArray(resolved.value) &&
              resolved.value.some((item) => jsonEqual(item, rule.expected))),
        actual,
      };
    case "length_between": {
      const length =
        typeof resolved.value === "string" || Array.isArray(resolved.value)
          ? resolved.value.length
          : undefined;
      return {
        passed:
          resolved.found &&
          length !== undefined &&
          (rule.minimum === undefined || length >= rule.minimum) &&
          (rule.maximum === undefined || length <= rule.maximum),
        actual,
      };
    }
    case "in":
      return {
        passed:
          resolved.found &&
          Array.isArray(rule.expected) &&
          rule.expected.some((candidate) =>
            jsonEqual(candidate, resolved.value),
          ),
        actual,
      };
  }
}

export class DeterministicRuleEvaluator implements EvaluatorAdapter {
  readonly name = "deterministic-rule-evaluator";
  readonly deterministic = true;

  private readonly now: () => Date;
  private readonly maxPatternLength: number;

  constructor(options: DeterministicRuleEvaluatorOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxPatternLength = options.maxPatternLength ?? 512;
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const rules = input.requirements.deterministicRules ?? [];
    const findings: EvaluationFinding[] = [];
    let passedCount = 0;
    for (const rule of rules) {
      const result = evaluateRule(
        rule,
        input.delivery.result,
        this.maxPatternLength,
      );
      if (result.passed) {
        passedCount += 1;
      } else {
        findings.push({
          code: "RULE_FAILED",
          message: `Deterministic acceptance rule ${rule.id} failed.`,
          path: rule.path,
          ruleId: rule.id,
          details: {
            operator: rule.operator,
            actual: result.actual,
            expected: rule.expected ?? null,
            minimum: rule.minimum ?? null,
            maximum: rule.maximum ?? null,
          },
        });
      }
    }
    const mode = input.requirements.deterministicRuleMode ?? "all";
    const accepted =
      rules.length === 0 ||
      (mode === "all" ? findings.length === 0 : passedCount > 0);
    return {
      evaluator: this.name,
      accepted,
      deterministic: this.deterministic,
      evaluatedAt: input.evaluatedAt ?? this.now().toISOString(),
      findings: mode === "any" && accepted ? [] : findings,
      metrics: {
        rule_count: rules.length,
        passed_rule_count: passedCount,
        rule_mode: mode,
      },
    };
  }
}
