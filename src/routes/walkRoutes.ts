import { Router } from 'express';
import { createWalkController, type WalkControllerOptions } from '../controllers/walkController';
import type { WalkService } from '../services/walkService';

export function createWalkRouter(service: WalkService, options: WalkControllerOptions): Router {
  const router = Router();
  const controller = createWalkController(service, options);
  router.post('/walks/plan', controller.plan);
  return router;
}
