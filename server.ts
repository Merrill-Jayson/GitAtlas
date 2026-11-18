import express from 'express';
import fs from 'fs';
import path from 'path';
import { createApiApp, ensureBackendInitialized } from './server/app.ts';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  await ensureBackendInitialized();
  const app = createApiApp();

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GitAtlas Graph-RAG server running at http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal server bootstrap error:', err);
  process.exit(1);
});
