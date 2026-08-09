import type {
  EvaluationInput,
  EvaluationResult,
  EvaluatorAdapter,
} from "./types.js";

export interface CompositeEvaluatorOptions {
  mode?: "all" | "any";
  now?: () => Date;
}

export class CompositeEvaluator implements EvaluatorAdapter {
  readonly name = "composite-evaluator";
  readonly deterministic: boolean;

  private readonly mode: "all" | "any";
  private readonly now: () => Date;

  constructor(
    private readonly evaluators: readonly EvaluatorAdapter[],
    options: CompositeEvaluatorOptions = {},
  ) {
    if (evaluators.length === 0) {
      throw new Error("CompositeEvaluator requires at least one evaluator.");
    }
    this.mode = options.mode ?? "all";
    this.now = options.now ?? (() => new Date());
    this.deterministic = evaluators.every(
      (evaluator) => evaluator.deterministic,
    );
  }

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const results = await Promise.all(
      this.evaluators.map((evaluator) => evaluator.evaluate(input)),
    );
    const accepted =
      this.mode === "all"
        ? results.every((result) => result.accepted)
        : results.some((result) => result.accepted);
    return {
      evaluator: this.name,
      accepted,
      deterministic: this.deterministic,
      evaluatedAt: input.evaluatedAt ?? this.now().toISOString(),
      findings:
        accepted && this.mode === "any"
          ? []
          : results.flatMap((result) => result.findings),
      metrics: {
        mode: this.mode,
        evaluator_count: results.length,
        accepted_evaluator_count: results.filter((result) => result.accepted)
          .length,
        evaluator_results: results.map((result) => ({
          evaluator: result.evaluator,
          accepted: result.accepted,
        })),
      },
    };
  }
}
