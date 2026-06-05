import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // GET /api/models — list available Ollama models
  app.get('/api/models', async (req, res) => {
    try {
      const response = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama responded with status ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: 'Failed to connect to Ollama',
        details: err.message
      });
    }
  });

  // POST /api/chat — streaming chat proxy (SSE)
  app.post('/api/chat', async (req, res) => {
    const { model, messages, system } = req.body;

    if (!model || !messages) {
      return res.status(400).json({ error: 'model and messages are required' });
    }

    try {
      const ollamaBody = {
        model,
        messages,
        stream: true,
      };
      if (system) {
        ollamaBody.messages = [{ role: 'system', content: system }, ...messages];
      }

      const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama error ${response.status}: ${errText}`);
      }

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
              if (parsed.done) {
                res.write('data: [DONE]\n\n');
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
        } catch {
          // Skip malformed
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Failed to stream from Ollama',
          details: err.message,
        });
      } else {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // POST /api/compare — parallel model comparison
  app.post('/api/compare', async (req, res) => {
    const { models, prompt, system } = req.body;

    if (!models || !Array.isArray(models) || models.length === 0 || !prompt) {
      return res.status(400).json({ error: 'models (array) and prompt are required' });
    }

    try {
      const messages = [{ role: 'user', content: prompt }];
      const allMessages = system
        ? [{ role: 'system', content: system }, ...messages]
        : messages;

      // Set up SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Launch parallel requests
      const streamPromises = models.map(async (model) => {
        try {
          const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: allMessages, stream: true }),
          });

          if (!response.ok) {
            res.write(`data: ${JSON.stringify({ model, error: `Ollama error ${response.status}` })}\n\n`);
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const parsed = JSON.parse(line);
                  res.write(`data: ${JSON.stringify({ model, ...parsed })}\n\n`);
                } catch {
                  // Skip malformed
                }
              }
            }
          }

          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              res.write(`data: ${JSON.stringify({ model, ...parsed })}\n\n`);
            } catch {
              // Skip malformed
            }
          }

          res.write(`data: ${JSON.stringify({ model, done: true })}\n\n`);
        } catch (err) {
          res.write(`data: ${JSON.stringify({ model, error: err.message })}\n\n`);
        }
      });

      await Promise.all(streamPromises);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Compare failed', details: err.message });
      } else {
        res.end();
      }
    }
  });

  return app;
}

// Start server if run directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(`\n  ⚡ OllamaForge running at http://localhost:${PORT}`);
    console.log(`  🔗 Ollama backend: ${OLLAMA_BASE}\n`);
  });
}
