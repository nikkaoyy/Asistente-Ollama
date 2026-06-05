import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Inline Agent module for testing ───
const CodeAgent = {
  SYSTEM_PROMPT: `You are an expert AI assistant powered by Ollama.

## Capabilities
- Answer questions accurately and concisely.
- Write code, scripts, and documentation when requested.
- Provide step-by-step explanations for complex topics.

## Guidelines
- Respond in the language of the user's prompt (e.g., Spanish if they write in Spanish).
- Format your responses clearly using Markdown.
- Use code blocks with the correct language tags for any code snippets.
- Be helpful, direct, and professional.`,

  buildMessages(userPrompt) {
    return [{ role: 'user', content: userPrompt }];
  },

  getSystemPrompt() {
    return this.SYSTEM_PROMPT;
  },
};

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

describe('AI Agent', () => {
  it('system prompt includes general guidelines', () => {
    const prompt = CodeAgent.getSystemPrompt();
    assert.ok(prompt.includes('expert AI assistant'), 'should define role');
    assert.ok(prompt.includes('Markdown'), 'should mention Markdown formatting');
  });

  it('buildMessages passes through user prompt directly', () => {
    const msgs = CodeAgent.buildMessages('hello world');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'hello world');
    assert.equal(msgs[0].role, 'user');
  });
});
