import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ConcurrencyGate } from '../middleware/concurrencyGate';
import { RequestAbandonedError, RequestScope } from '../services/requestScope';
import type { WalkResult, WalkService } from '../services/walkService';
import { HttpError } from '../utils/httpError';

/**
 * Coarse location: a city name and nothing else. Letters, spaces and a little punctuation only, so no
 * URLs, digits or markup. The city is used for one weather lookup. It is never logged, traced or sent to Gemma.
 */
const citySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .,'\u2019-]*$/u);

const bodySchema = z.object({
  minutes: z.union([z.literal(10), z.literal(20), z.literal(40)]),
  energy: z.enum(['easy', 'normal']).default('normal'),
  location: z.object({ city: citySchema }).optional(),
});

export interface WalkControllerOptions {
  /** Caps simultaneous plans. Omit for no cap (tests). */
  gate?: ConcurrencyGate;
  /** Whole-request server deadline. */
  deadlineMs: number;
}

const DEADLINE = Symbol('deadline');

export function createWalkController(service: WalkService, options: WalkControllerOptions) {
  return {
    async plan(req: Request, res: Response): Promise<void> {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'Invalid request: minutes must be 10, 20 or 40; energy must be easy or normal; location.city, if given, must be 2 to 80 letters.');
      }
      // Capacity is taken only after the body is known to be valid, and returned in the `finally` below on EVERY path.
      const release = options.gate ? options.gate.tryAcquire() : () => undefined;
      if (!release) {
        res.setHeader('Retry-After', '2');
        throw new HttpError(503, 'PocketWalk is busy right now. Please try again in a moment.');
      }

      const scope = new RequestScope({ deadlineMs: options.deadlineMs });
      // Closed before the response finished = the client went away: stop starting work and cancel provider calls.
      const onClose = (): void => {
        if (!res.writableFinished) scope.abort('disconnect');
      };
      res.on('close', onClose);

      try {
        const work = service.planWalk(parsed.data, scope);
        work.catch(() => undefined); // if the deadline wins, a later failure of this promise must not be unhandled
        const outcome = await Promise.race([work, scope.deadline.then(() => DEADLINE)]);

        if (scope.reason === 'disconnect') return; // nobody is listening
        let result: WalkResult;
        if (outcome === DEADLINE) {
          // Out of time with no answer. A safe, validated fallback can still be built without any provider; if not, a controlled error.
          try {
            result = await service.planFallbackNow(parsed.data);
          } catch {
            throw new HttpError(504, 'This took longer than expected. Please try again.');
          }
        } else {
          result = outcome as WalkResult;
        }
        if (!res.headersSent && !res.destroyed) res.json(result);
      } catch (err) {
        if (err instanceof RequestAbandonedError || scope.reason === 'disconnect') return;
        throw err;
      } finally {
        res.off('close', onClose);
        scope.dispose();
        release();
      }
    },
  };
}
