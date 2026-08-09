import type {
  EvaluationInput,
  EvaluationResult,
  EvaluatorAdapter,
} from "./types.js";

export interface MockAgentEvaluatorOptions {
  accepted?: boolean;
  evaluate?: (input: EvaluationInput) => boolean | Promise<boolean>;
  now?: () => Date;
}

export class MockAgentEvaluator implements EvaluatorAdapter {
  readonly name = "mock-agent-evaluator";
  readonly deterministic = true;

  private readonly accepted: boolean;
  private readonly evaluateInput:
    ((input: EvaluationInput) => boolean | Promise<boolean>) | undefined;
  private readonly now: () => Date;

  constructor(options: MockAgentEvaluatorOptions = {}) {
    this.accepted = options.accepted ?? true;
    this.evaluateInput = options.evaluate;
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const accepted = this.evaluateInput
      ? await this.evaluateInput(input)
      : this.accepted;
    return {
      evaluator: this.name,
      accepted,
      deterministic: this.deterministic,
      evaluatedAt: input.evaluatedAt ?? this.now().toISOString(),
      findings: accepted
        ? []
        : [
            {
              code: "RULE_FAILED",
              message: "The configured mock evaluator rejected the delivery.",
            },
          ],
      metrics: { simulation: true },
    };
  }
}
