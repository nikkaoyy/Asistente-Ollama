/* ═══════════════════════════════════════════════
   OllamaForge — Main Application
   Modules: OllamaClient, ChatManager, CodeAgent, 
            ComparePanel, ConversationManager, App
   ═══════════════════════════════════════════════ */

// ─── Configuration ───
const API_BASE = window.location.origin;
const DEFAULT_MODEL = 'qwen2.5:32b'; // Fallback if no models found initially

// ═══════════════════════════════════════════════
// MODULE: OllamaClient
// Handles all communication with the proxy server
// ═══════════════════════════════════════════════
const OllamaClient = {
  async fetchModels() {
    const res = await fetch(`${API_BASE}/api/models`);
    if (!res.ok) throw new Error('Failed to fetch models');
    const data = await res.json();
    return data.models || [];
  },

  async chat(model, messages, system, onToken, signal) {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, system }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onToken('', true);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.message && parsed.message.content) {
              onToken(parsed.message.content, parsed.done || false);
            }
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') {
              console.warn('SSE parse error:', e);
            }
          }
        }
      }
    }
    onToken('', true);
  },

  async compare(models, prompt, system, onToken) {
    const res = await fetch(`${API_BASE}/api/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models, prompt, system }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.model && parsed.message && parsed.message.content) {
              onToken(parsed.model, parsed.message.content, parsed.done || false);
            } else if (parsed.model && parsed.done) {
              onToken(parsed.model, '', true);
            } else if (parsed.model && parsed.error) {
              onToken(parsed.model, `\n\n**Error:** ${parsed.error}`, true);
            }
          } catch {
            // skip
          }
        }
      }
    }
  }
};

// ═══════════════════════════════════════════════
// MODULE: CodeAgent
// Provides system prompt and structure for the chat
// ═══════════════════════════════════════════════
const CodeAgent = {
  SYSTEM_PROMPT: `You are an expert AI assistant powered by Ollama.

## Capabilities
- Answer questions accurately and concisely.
- Write code, scripts, and documentation when requested (You're specialist in HTML and CSS).
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
// MODULE: ConversationManager
// Manages conversations in localStorage
// ═══════════════════════════════════════════════
const ConversationManager = {
  STORAGE_KEY: 'ollamaforge_conversations_v2', // changed key for new version
  conversations: [],
  activeId: null,

  init() {
    this.load();
    if (this.conversations.length === 0) {
      this.create('Nueva Conversación');
    }
    this.activeId = this.conversations[0].id;
    this.renderList();
  },

  load() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      this.conversations = raw ? JSON.parse(raw) : [];
    } catch {
      this.conversations = [];
    }
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.conversations));
  },

  create(title) {
    const conv = {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: title || 'Nueva Conversación',
      messages: [],
      createdAt: Date.now(),
    };
    this.conversations.unshift(conv);
    this.activeId = conv.id;
    this.save();
    this.renderList();
    return conv;
  },

  delete(id) {
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (this.activeId === id) {
      if (this.conversations.length === 0) {
        this.create('Nueva Conversación');
      }
      this.activeId = this.conversations[0].id;
    }
    this.save();
    this.renderList();
  },

  getActive() {
    return this.conversations.find((c) => c.id === this.activeId) || this.conversations[0];
  },

  setActive(id) {
    this.activeId = id;
    this.renderList();
  },

  addMessage(role, content) {
    const conv = this.getActive();
    if (!conv) return;
    conv.messages.push({ role, content, timestamp: Date.now() });
    
    // Auto-title from first user message
    if (conv.messages.length === 1 && role === 'user') {
      conv.title = content.slice(0, 40) + (content.length > 40 ? '...' : '');
    }
    this.save();
    this.renderList();
  },

  getMessages() {
    const conv = this.getActive();
    return conv ? conv.messages : [];
  },

  renderList() {
    const list = document.getElementById('conversation-list');
    if (!list) return;

    list.innerHTML = this.conversations.map((conv) => `
      <div class="conversation-item ${conv.id === this.activeId ? 'active' : ''}" data-id="${conv.id}">
        <span class="conv-icon">💬</span>
        <span class="conv-title">${this._escapeHtml(conv.title)}</span>
        <button class="conv-delete" data-delete-id="${conv.id}" title="Eliminar">✕</button>
      </div>
    `).join('');

    // Bind click events
    list.querySelectorAll('.conversation-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('conv-delete')) return;
        this.setActive(el.dataset.id);
        ChatManager.loadConversation();
      });
    });

    list.querySelectorAll('.conv-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.delete(btn.dataset.deleteId);
        ChatManager.loadConversation();
      });
    });
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};

// ═══════════════════════════════════════════════
// MODULE: ChatManager
// Manages chat UI, message rendering, and streaming
// ═══════════════════════════════════════════════
const ChatManager = {
  isStreaming: false,
  abortController: null,

  init() {
    this.bindEvents();
    this.loadConversation();
  },

  bindEvents() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });

    sendBtn.addEventListener('click', () => this.sendMessage());
  },

  async sendMessage() {
    if (this.isStreaming) return;

    const input = document.getElementById('chat-input');
    const userText = input.value.trim();
    if (!userText) return;

    // Add to conversation visually
    ConversationManager.addMessage('user', userText);
    this.appendMessage('user', userText);

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Build context
    const model = document.getElementById('model-select').value || DEFAULT_MODEL;
    const system = CodeAgent.getSystemPrompt();
    const allMessages = ConversationManager.getMessages().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Start streaming
    this.setStreaming(true);
    const assistantDiv = this.appendMessage('assistant', '');
    const bodyEl = assistantDiv.querySelector('.message-body');
    let fullResponse = '';

    try {
      this.abortController = new AbortController();
      await OllamaClient.chat(model, allMessages, system, (token, done) => {
        if (done) return;
        fullResponse += token;
        this.renderMarkdown(bodyEl, fullResponse);
        this.scrollToBottom();
      }, this.abortController.signal);

      ConversationManager.addMessage('assistant', fullResponse);
    } catch (err) {
      if (err.name === 'AbortError') {
        fullResponse += '\n\n*[Respuesta cancelada]*';
      } else {
        fullResponse = `**Error:** ${err.message}`;
        App.showToast(err.message, 'error');
      }
      this.renderMarkdown(bodyEl, fullResponse);
    } finally {
      this.setStreaming(false);
      this.abortController = null;
    }
  },

  appendMessage(role, content) {
    const container = document.getElementById('chat-messages');
    const avatar = role === 'user' ? '👤' : '⚡';
    const sender = role === 'user' ? 'Tú' : 'Ollama';

    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-sender">${sender}</div>
        <div class="message-body"></div>
      </div>
    `;

    const bodyEl = div.querySelector('.message-body');
    if (content) {
      this.renderMarkdown(bodyEl, content);
    }

    // Remove welcome message if present
    const welcome = container.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    container.appendChild(div);
    this.scrollToBottom();
    return div;
  },

  renderMarkdown(el, text) {
    if (!text) {
      el.innerHTML = '<span class="typing-cursor">▋</span>';
      return;
    }

    if (window.marked) {
      marked.setOptions({
        highlight: function (code, lang) {
          if (window.hljs && lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return code;
        },
        breaks: true,
      });
      el.innerHTML = marked.parse(text);
    } else {
      el.textContent = text;
    }

    // Add Copy button to code blocks
    el.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-block-actions')) return;
      const actions = document.createElement('div');
      actions.className = 'code-block-actions';
      actions.innerHTML = `
        <button class="code-action-btn" data-action="copy" title="Copiar código">📋 Copiar</button>
      `;
      pre.style.position = 'relative';
      pre.appendChild(actions);

      actions.querySelector('[data-action="copy"]').addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code);
        App.showToast('Código copiado al portapapeles');
      });
    });
  },

  loadConversation() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';

    const messages = ConversationManager.getMessages();
    if (messages.length === 0) {
      container.innerHTML = `
        <div class="welcome-message">
          <div class="welcome-icon">⚡</div>
          <h3>¿En qué puedo ayudarte hoy?</h3>
          <p>Asistente impulsado por modelos locales de Ollama.</p>
        </div>
      `;
      return;
    }

    messages.forEach((msg) => {
      this.appendMessage(msg.role, msg.content);
    });
    this.scrollToBottom();
  },

  setStreaming(streaming) {
    this.isStreaming = streaming;
    const indicator = document.getElementById('streaming-indicator');
    const sendBtn = document.getElementById('send-btn');

    if (streaming) {
      indicator.classList.remove('hidden');
      sendBtn.disabled = true;
    } else {
      indicator.classList.add('hidden');
      sendBtn.disabled = false;
    }
  },

  scrollToBottom() {
    const container = document.getElementById('chat-messages-container');
    container.scrollTop = container.scrollHeight;
  },
};

// ═══════════════════════════════════════════════
// MODULE: ComparePanel
// Model comparison with parallel streaming
// ═══════════════════════════════════════════════
const ComparePanel = {
  isComparing: false,

  init() {
    document.getElementById('compare-send-btn').addEventListener('click', () => {
      this.compare();
    });

    document.getElementById('compare-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.compare();
      }
    });
  },

  renderModelCheckboxes(models) {
    const container = document.getElementById('compare-model-checkboxes');
    container.innerHTML = models.map((m) => `
      <label class="compare-model-checkbox">
        <input type="checkbox" value="${m.name}" checked>
        <span>${m.name}</span>
      </label>
    `).join('');
  },

  getSelectedModels() {
    const checkboxes = document.querySelectorAll('#compare-model-checkboxes input:checked');
    return Array.from(checkboxes).map((cb) => cb.value);
  },

  async compare() {
    if (this.isComparing) return;

    const input = document.getElementById('compare-input');
    const prompt = input.value.trim();
    if (!prompt) return;

    const models = this.getSelectedModels();
    if (models.length === 0) {
      App.showToast('Selecciona al menos un modelo para comparar', 'error');
      return;
    }

    this.isComparing = true;
    const resultsContainer = document.getElementById('compare-results');
    resultsContainer.innerHTML = '';

    const cards = {};
    const startTimes = {};
    const tokenCounts = {};

    models.forEach((model) => {
      startTimes[model] = Date.now();
      tokenCounts[model] = 0;

      const card = document.createElement('div');
      card.className = 'compare-result-card';
      card.innerHTML = `
        <div class="compare-result-header">
          <span class="compare-result-model">${model}</span>
          <div class="compare-result-stats">
            <span class="stat-time" data-model="${model}">⏱ 0.0s</span>
            <span class="stat-tokens" data-model="${model}">📝 0 tokens</span>
          </div>
        </div>
        <div class="compare-result-body" data-model="${model}">
          <span class="typing-cursor" style="color: var(--neon-cyan);">▋</span>
        </div>
      `;
      resultsContainer.appendChild(card);
      cards[model] = '';
    });

    try {
      await OllamaClient.compare(models, prompt, CodeAgent.getSystemPrompt(), (model, token, done) => {
        if (!done && token) {
          cards[model] += token;
          tokenCounts[model]++;
          const bodyEl = resultsContainer.querySelector(`.compare-result-body[data-model="${model}"]`);
          if (bodyEl && window.marked) {
            bodyEl.innerHTML = marked.parse(cards[model]);
            bodyEl.querySelectorAll('pre code').forEach((block) => {
              if (window.hljs) hljs.highlightElement(block);
            });
          }
        }

        const elapsed = ((Date.now() - startTimes[model]) / 1000).toFixed(1);
        const timeEl = resultsContainer.querySelector(`.stat-time[data-model="${model}"]`);
        const tokenEl = resultsContainer.querySelector(`.stat-tokens[data-model="${model}"]`);
        if (timeEl) timeEl.textContent = `⏱ ${elapsed}s`;
        if (tokenEl) tokenEl.textContent = `📝 ${tokenCounts[model]} tokens`;
      });
    } catch (err) {
      App.showToast(`Compare error: ${err.message}`, 'error');
    } finally {
      this.isComparing = false;
    }
  },
};

// ═══════════════════════════════════════════════
// MODULE: App
// Main application controller
// ═══════════════════════════════════════════════
const App = {
  models: [],
  currentMode: 'agent',

  async init() {
    ConversationManager.init();
    ChatManager.init();
    ComparePanel.init();

    await this.loadModels();
    this.bindEvents();
    this.updateStatus('connected');
  },

  async loadModels() {
    try {
      this.models = await OllamaClient.fetchModels();
      const select = document.getElementById('model-select');

      select.innerHTML = this.models.map((m) => {
        return `<option value="${m.name}" ${m.name === DEFAULT_MODEL ? 'selected' : ''}>
          ${m.name}
        </option>`;
      }).join('');

      this.updateModelInfo();
      ComparePanel.renderModelCheckboxes(this.models);

      const badge = document.getElementById('chat-model-badge');
      badge.textContent = select.value || 'sin modelo';

      this.updateStatus('connected');
    } catch (err) {
      console.error('Failed to load models:', err);
      this.updateStatus('error');
      this.showToast('No se pudo conectar con Ollama. ¿Está ejecutándose?', 'error');
    }
  },

  updateModelInfo() {
    const select = document.getElementById('model-select');
    const info = document.getElementById('model-info');
    const model = this.models.find((m) => m.name === select.value);
    if (model) {
      const sizeGB = model.size ? (model.size / 1e9).toFixed(1) + ' GB' : '';
      info.textContent = sizeGB;
    }
  },

  updateStatus(status) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');

    dot.className = 'status-dot';
    if (status === 'connected') {
      dot.classList.add('connected');
      text.textContent = `Ollama conectado · ${this.models.length} modelos`;
    } else if (status === 'error') {
      dot.classList.add('error');
      text.textContent = 'Ollama desconectado';
    } else {
      text.textContent = 'Conectando...';
    }
  },

  bindEvents() {
    // Model selector change
    document.getElementById('model-select').addEventListener('change', (e) => {
      document.getElementById('chat-model-badge').textContent = e.target.value;
      this.updateModelInfo();
    });

    // Mode toggle
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setMode(btn.dataset.mode);
      });
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('app').classList.toggle('sidebar-collapsed');
    });

    // New conversation button
    document.getElementById('new-conversation-btn').addEventListener('click', () => {
      ConversationManager.create('Nueva Conversación');
      ChatManager.loadConversation();
    });
  },

  setMode(mode) {
    this.currentMode = mode;

    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const chatMessages = document.getElementById('chat-messages-container');
    const chatInput = document.getElementById('chat-input-area');
    const compare = document.getElementById('compare-panel');
    const title = document.getElementById('chat-title');

    if (mode === 'agent') {
      chatMessages.classList.remove('hidden');
      chatInput.classList.remove('hidden');
      compare.classList.add('hidden');
      title.textContent = 'Ollama Agent';
    } else {
      chatMessages.classList.add('hidden');
      chatInput.classList.add('hidden');
      compare.classList.remove('hidden');
      title.textContent = 'Comparación';
    }
  },

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },
};

// ─── Bootstrap ───
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
