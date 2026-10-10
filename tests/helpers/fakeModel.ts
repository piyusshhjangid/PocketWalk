import { PlannerError } from '../../src/ai/errors';
import type { ModelClient, ModelResponse } from '../../src/ai/modelClient';

type Behaviour = (prompt: string, signal: AbortSignal) => Promise<ModelResponse>;

/** A model client that never touches the network. Tests script exactly what the "model" says. */
export class FakeModelClient implements ModelClient {
  readonly provider = 'fake';
  readonly model = 'fake-gemma';
  readonly maxOutputTokens = 256;
  readonly temperature = 0;
  readonly prompts: string[] = [];

  constructor(private readonly behaviour: Behaviour) {}

  generate(prompt: string, { signal }: { signal: AbortSignal }): Promise<ModelResponse> {
    this.prompts.push(prompt);
    return this.behaviour(prompt, signal);
  }

  static replying(text: string): FakeModelClient {
    return new FakeModelClient(async () => ({ text, usage: { inputTokens: 100, outputTokens: 50 } }));
  }
  static failing(reason: ConstructorParameters<typeof PlannerError>[0]): FakeModelClient {
    return new FakeModelClient(async () => {
      throw new PlannerError(reason, 'scripted failure');
    });
  }
  /** Never answers and ignores the abort signal: proves the timeout is enforced by the planner. */
  static hanging(): FakeModelClient {
    return new FakeModelClient(() => new Promise(() => {}));
  }
}

/** A plan that satisfies every rule for the given duration. */
export function validPlanJson(minutes: number): string {
  const a = Math.round(minutes * 0.4);
  return JSON.stringify({
    title: 'Quiet block loop',
    steps: [
      { minutes: a, text: 'Walk out slowly along the nearest footpath.' },
      { minutes: minutes - 2 * a, text: 'Stop and listen for distant birds.' },
      { minutes: a, text: 'Return the way you came, unhurried.' },
    ],
    notice: 'Notice how many shades of green you can find.',
  });
}
