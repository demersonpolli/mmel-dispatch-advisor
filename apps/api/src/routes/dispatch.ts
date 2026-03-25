import { Router } from 'express';
import { analyzeDispatch } from '../services/dispatchEngine';
import { AnalyzeDispatchRequest } from '../types/dispatch';

export const dispatchRouter = Router();

dispatchRouter.post('/analyze', (req, res) => {
  const body = req.body as AnalyzeDispatchRequest;

  if (!body?.issue || typeof body.issue !== 'string') {
    return res.status(400).json({
      error: 'The request body must include a non-empty "issue" string.'
    });
  }

  const result = analyzeDispatch(body);
  return res.json(result);
});