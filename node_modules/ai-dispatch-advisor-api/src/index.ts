import cors from 'cors';
import express from 'express';
import { dispatchRouter } from './routes/dispatch';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-dispatch-advisor-api'
  });
});

app.use('/api/dispatch', dispatchRouter);

app.listen(PORT, () => {
  console.log(`AI Dispatch Advisor API listening on http://localhost:${PORT}`);
});