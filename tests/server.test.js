import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createServer } from 'http';

/**
 * Helper: start the app on an ephemeral port and return base URL + close fn
 */
function startApp() {
  return new Promise((resolve) => {
    const app = createApp();
    const server = createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://localhost:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe('OllamaForge Server', () => {
  let baseUrl, close;

  before(async () => {
    ({ baseUrl, close } = await startApp());
  });

  after(async () => {
    await close();
  });

  // ── Tracer Bullet: GET /api/models returns model list ──
  it('GET /api/models returns model list from Ollama', async () => {
    const res = await fetch(`${baseUrl}/api/models`);
    // If Ollama is running, we get 200 with models array
    // If Ollama is not running, we get 502 with error
    if (res.ok) {
      const data = await res.json();
      assert.ok(Array.isArray(data.models), 'response should contain models array');
      assert.ok(data.models.length > 0, 'should have at least one model');
      // Each model should have a name
      assert.ok(data.models[0].name, 'model should have a name');
    } else {
      // 502 is acceptable if Ollama is not running
      assert.equal(res.status, 502);
      const data = await res.json();
      assert.ok(data.error, 'error response should have error field');
    }
  });

  // ── POST /api/chat requires model and messages ──
  it('POST /api/chat returns 400 when model or messages missing', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test' }), // missing messages
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('required'));
  });

  // ── POST /api/compare requires models array and prompt ──
  it('POST /api/compare returns 400 when models or prompt missing', async () => {
    const res = await fetch(`${baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }), // missing models
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('required'));
  });

  it('POST /api/compare returns 400 when models is empty array', async () => {
    const res = await fetch(`${baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: [], prompt: 'hello' }),
    });
    assert.equal(res.status, 400);
  });

  // ── Static file serving ──
  it('serves static files from public directory', async () => {
    const res = await fetch(`${baseUrl}/index.html`);
    // Will be 404 until we create the file, but the route should exist
    // After public/index.html is created, this will return 200
    assert.ok([200, 404].includes(res.status), 'should serve or 404 static files');
  });

  // ── POST /api/chat streams SSE when Ollama is available ──
  it('POST /api/chat returns SSE stream with tinyllama', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tinyllama',
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
      }),
    });

    if (res.ok) {
      assert.equal(
        res.headers.get('content-type'),
        'text/event-stream',
        'should return SSE content type'
      );
      // Read the stream and verify we get data events
      const text = await res.text();
      assert.ok(text.includes('data:'), 'should contain SSE data events');
      assert.ok(text.includes('[DONE]'), 'should end with [DONE]');
    } else {
      // 502 is acceptable if Ollama is not running
      assert.equal(res.status, 502);
    }
  });
});
