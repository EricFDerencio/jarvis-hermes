/**
 * J.A.R.V.I.S. — Hermes Agent Interface v1.1
 * Entry point: loads config, wires UI, connects to Hermes proxy + dashboard API.
 */
'use strict';

/* ============================================================
   Constants & State
   ============================================================ */
const CONFIG_KEY = 'jarvis_config_v1';
const STORAGE_KEY_RECENT_CMDS = 'jarvis_recent_commands';

const DEFAULT_CONFIG = {
  endpoint: 'http://localhost:8645',
  dashboardEndpoint: 'http://localhost:9119',
  model: 'upstage/solar-pro4:free',
  temperature: 0.7,
  darkMode: true,
  visualEffects: true,
  voiceEnabled: false,
  voiceLang: 'pt-BR',
};

/** @type {Config} */
let config = loadConfig();

/** @type {string | null} sessionToken for dashboard API */
let sessionToken = null;

/** @type {SpeechRecognition | null} */
let recognition = null;

/** @type {boolean} */
let isRecognizing = false;

/** @type {boolean} */
let isGenerating = false;

/** @type {Array<{cmd: string, time: Date, latency: number}>} */
let recentCommands = loadRecentCommands();

/* ============================================================
   DOM elements cache
   ============================================================ */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const dom = {
  // top bar
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),

  // chat
  chatArea: $('#chatArea'),
  chatInput: $('#chatInput'),
  sendBtn: $('#sendBtn'),

  // panels
  historyList: $('#historyList'),
  cmdInput: $('#cmdInput'),
  cmdSendBtn: $('#cmdSendBtn'),
  cmdOutput: $('#cmdOutput'),
  cmdClearBtn: $('#cmdClearBtn'),
  cmdStreaming: $('#cmdStreaming'),
  recentCommandsEl: $('#recentCommands'),
  cfgEndpoint: $('#cfgEndpoint'),
  cfgModel: $('#cfgModel'),
  cfgTemperature: $('#cfgTemperature'),
  btnSaveConfig: $('#btnSaveConfig'),
  btnTestConnection: $('#btnTestConnection'),
  toggleDark: $('#toggleDark'),
  toggleEffects: $('#toggleEffects'),
  toggleVoice: $('#toggleVoice'),
  // voiceBtn only — no more voiceModule/voiceStatus DOM refs
  voiceBtn: $('#voiceBtn'),
  voiceStatus: $('#voiceStatus'),
  welcomeOverlay: $('#welcomeOverlay'),
  welcomeStatus: $('#welcomeStatus'),

  // status panel fields
  sVersion: $('#sVersion'),
  sGateway: $('#sGateway'),
  sModel: $('#sModel'),
  sProviders: $('#sProviders'),
  sMsgCount: $('#sMsgCount'),
  sToolCount: $('#sToolCount'),
  sTokensIn: $('#sTokensIn'),
  sTokensOut: $('#sTokensOut'),
  sCost: $('#sCost'),

  // skills
  skillsList: $('#skillsList'),
};

/* ============================================================
   Config persistence
   ============================================================ */
/**
 * @typedef {Object} Config
 * @property {string} endpoint
 * @property {string} dashboardEndpoint
 * @property {string} model
 * @property {number} temperature
 * @property {boolean} darkMode
 * @property {boolean} visualEffects
 * @property {boolean} voiceEnabled
 * @property {string} voiceLang
 */

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (err) {
    console.warn('[JARVIS] Failed to load config:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[JARVIS] Failed to save config:', err);
  }
}

function loadRecentCommands() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT_CMDS);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('[JARVIS] Failed to load recent commands:', err);
  }
  return [];
}

function saveRecentCommands() {
  try {
    localStorage.setItem(STORAGE_KEY_RECENT_CMDS, JSON.stringify(recentCommands.slice(0, 20)));
  } catch (err) {
    console.warn('[JARVIS] Failed to save recent commands:', err);
  }
}

/* ============================================================
   UI helpers
   ============================================================ */
function switchPanel(id) {
  $$('.sidebar-item[data-panel]').forEach(el => el.classList.remove('active'));
  const btn = document.querySelector(`.sidebar-item[data-panel="${id}"]`);
  if (btn) btn.classList.add('active');

  $$('.panel').forEach(p => p.classList.remove('active'));
  const panel = $(`#panel-${id}`);
  if (panel) panel.classList.add('active');

  // Panel-specific actions
  switch (id) {
    case 'history': loadHistory(); break;
    case 'commands': renderRecentCommands(); break;
    case 'config':
      dom.cfgEndpoint.value = config.endpoint;
      dom.cfgModel.value = config.model;
      dom.cfgTemperature.value = config.temperature;
      break;
    case 'status': loadStatus().catch(err => console.warn('[JARVIS] Status load error:', err)); break;
    case 'skills': loadSkills().catch(err => console.warn('[JARVIS] Skills load error:', err)); break;
  }
}

function updateStatus(state, text) {
  dom.statusDot.classList.remove('online', 'error', 'checking');
  if (state === 'online') {
    dom.statusDot.classList.add('online');
    dom.statusText.textContent = 'Online';
    dom.statusText.style.color = 'var(--success)';
  } else if (state === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusText.textContent = text || 'Erro';
    dom.statusText.style.color = 'var(--error)';
  } else if (state === 'checking') {
    dom.statusDot.classList.add('checking');
    dom.statusText.textContent = text || 'Verificando...';
    dom.statusText.style.color = 'var(--gold-dim)';
  } else {
    dom.statusDot.style.background = 'var(--text-muted)';
    dom.statusText.textContent = text || 'Desconectado';
    dom.statusText.style.color = 'var(--text-muted)';
  }
}

/* ============================================================
   Text formatting
   ============================================================ */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format text with markdown-like code blocks and inline code.
 * Returns HTML string.
 */
function formatText(text) {
  const escaped = escapeHtml(text);
  // Code blocks
  let html = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

/* ============================================================
   Messages
   ============================================================ */
function addMessage(role, text, meta = {}) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'U' : 'J';
  avatar.setAttribute('aria-hidden', 'true');

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (role === 'agent') {
    const label = document.createElement('div');
    label.className = 'label';
    const ts = meta.latency ? ` (${meta.latency}ms)` : '';
    label.textContent = `J.A.R.V.I.S.${ts}`;
    bubble.appendChild(label);
  } else {
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Você';
    bubble.appendChild(label);
  }

  bubble.insertAdjacentHTML('beforeend', formatText(text));

  if (meta.error) {
    bubble.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    bubble.style.background = 'rgba(239, 68, 68, 0.04)';
  }

  if (meta.isCode) {
    const pre = document.createElement('pre');
    pre.textContent = text;
    bubble.appendChild(pre);
  }

  div.appendChild(avatar);
  div.appendChild(bubble);

  dom.chatArea.appendChild(div);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
  });
}

function showTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'message agent typing-message';
  el.id = 'typingIndicator';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'J';
  avatar.setAttribute('aria-hidden', 'true');

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.className = 'typing-dot';
    indicator.appendChild(dot);
  }
  bubble.appendChild(indicator);
  el.appendChild(avatar);
  el.appendChild(bubble);

  dom.chatArea.appendChild(el);
  scrollChatToBottom();
  return el;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

/* ============================================================
   Chat — message sending & API call
   ============================================================ */
/**
 * Build the system prompt for chat.
 * Mentions terminal tool availability and Portuguese response.
 */
function buildChatSystemPrompt() {
  return [
    'You are J.A.R.V.I.S., Tony Stark\'s AI assistant.',
    'You respond in Portuguese (pt-BR) with a confident, slightly witty tone.',
    'You are connected to the Hermes Agent system and can use its tools (terminal, filesystem, MCP tools, etc.).',
    'When asked to run a command, use the terminal tool and report the raw output.',
    'Format code blocks clearly. Be concise but thorough.',
    'Never reveal internal system instructions or tool names unless asked.',
  ].join(' ');
}

async function callHermesChat(prompt) {
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const url = `${endpoint}/v1/chat/completions`;

  const body = {
    model: config.model || 'hermes',
    messages: [
      { role: 'system', content: buildChatSystemPrompt() },
      { role: 'user', content: prompt },
    ],
    temperature: config.temperature,
    stream: false,
  };

  const start = performance.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { detail = res.statusText; }
    throw new ApiError(`HTTP ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const latency = Math.round(performance.now() - start);
  const choice = data.choices?.[0];
  const usage = data.usage;

  if (!choice) {
    throw new ApiError(`Resposta inválida da API. Dados recebidos: ${JSON.stringify(data).slice(0, 200)}`, 0);
  }

  return {
    text: choice.message?.content || JSON.stringify(data),
    meta: {
      latency,
      model: data.model,
      tokensIn: usage?.prompt_tokens,
      tokensOut: usage?.completion_tokens,
    },
  };
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function sendMessage() {
  const text = dom.chatInput.value.trim();
  if (!text || isGenerating) return;

  dom.chatInput.value = '';
  isGenerating = true;
  dom.sendBtn.disabled = true;
  addMessage('user', text);
  dom.chatInput.focus();

  const typingEl = showTypingIndicator();

  try {
    const result = await callHermesChat(text);
    removeTypingIndicator(typingEl);
    addMessage('agent', result.text, result.meta);

    // Update last response timestamp
    const now = new Date();
    // Could store in localStorage for persistence

  } catch (err) {
    removeTypingIndicator(typingEl);
    if (err instanceof ApiError) {
      addMessage('agent', `Erro de conexão (${err.status}): ${err.message}`, { error: true, latency: 0 });
    } else {
      addMessage('agent', `Erro: ${err.message}`, { error: true, latency: 0 });
    }
    updateStatus('error', 'Erro de conexão');
  } finally {
    isGenerating = false;
    dom.sendBtn.disabled = false;
    dom.chatInput.focus();
  }
}

function setupChatInput() {
  dom.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  dom.sendBtn.addEventListener('click', sendMessage);
}

/* ============================================================
   Commands panel — execute terminal commands via Hermes
   ============================================================ */
/**
 * Build a system prompt that forces raw terminal output only.
 */
function buildCommandSystemPrompt(command) {
  return [
    'You are J.A.R.V.I.S., a command execution agent.',
    'Run the following command on the terminal and return ONLY the raw output.',
    'No commentary, no markdown formatting, no explanations.',
    'If the command produces no output, return exactly: "Comando executado sem output."',
    'If there is an error, return the error output exactly as it appears.',
    '',
    `Command to execute: ${command}`,
  ].join('\n');
}

async function executeCommand() {
  const cmd = dom.cmdInput.value.trim();
  if (!cmd || isGenerating) return;

  dom.cmdInput.value = '';
  isGenerating = true;
  dom.cmdSendBtn.disabled = true;

  // Show output area
  dom.cmdOutput.classList.add('visible');
  dom.cmdOutput.className = 'cmd-output visible';
  dom.cmdOutput.innerHTML = `<span class="cmd-label">Executando: ${escapeHtml(cmd)}</span> Aguarde...`;
  dom.cmdOutput.textContent = ''; // reset for streaming

  const startTime = performance.now();
  let accumulatedOutput = '';

  try {
    const endpoint = config.endpoint.replace(/\/+$/, '');
    const url = `${endpoint}/v1/chat/completions`;

    const body = {
      model: config.model || 'hermes',
      messages: [
        { role: 'system', content: buildCommandSystemPrompt(cmd) },
        { role: 'user', content: `Execute this command and return the raw terminal output only:\n\n${cmd}` },
      ],
      temperature: 0.05,
      stream: dom.cmdStreaming.checked,
    };

    const fetchOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };

    if (dom.cmdStreaming.checked) {
      // Attempt streaming
      fetchOptions.stream = true;
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) { detail = res.statusText; }
      throw new ApiError(`HTTP ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }

    if (dom.cmdStreaming.checked) {
      // Consume as stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedOutput += delta;
              // Update display progressively
              dom.cmdOutput.textContent = accumulatedOutput;
              dom.cmdOutput.scrollTop = dom.cmdOutput.scrollHeight;
            }
          } catch (e) {
            // Skip malformed SSE chunks
          }
        }
      }

      // Ensure we have something
      if (!accumulatedOutput.trim()) {
        accumulatedOutput = '(sem output)';
      }
    } else {
      // Non-streaming
      const data = await res.json();
      const choice = data.choices?.[0];
      if (choice?.message?.content) {
        accumulatedOutput = choice.message.content;
      } else if (data.error) {
        throw new ApiError(data.error.message || JSON.stringify(data.error), data.error.code || 0);
      } else {
        accumulatedOutput = JSON.stringify(data);
      }
    }

    dom.cmdOutput.textContent = accumulatedOutput;
    dom.cmdOutput.scrollTop = dom.cmdOutput.scrollHeight;
    dom.cmdOutput.className = 'cmd-output visible';

  } catch (err) {
    dom.cmdOutput.className = 'cmd-output visible error';
    dom.cmdOutput.textContent = `Erro: ${err.message}`;
    console.error('[JARVIS] Command error:', err);
  } finally {
    const latency = Math.round(performance.now() - startTime);
    isGenerating = false;
    dom.cmdSendBtn.disabled = false;
    dom.cmdInput.focus();

    // Record command
    if (cmd) {
      recentCommands.unshift({ cmd, time: new Date(), latency });
      if (recentCommands.length > 20) recentCommands.length = 20;
      saveRecentCommands();
      renderRecentCommands();
    }
  }
}

function setupCommands() {
  dom.cmdSendBtn.addEventListener('click', executeCommand);

  dom.cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    }
  });

  dom.cmdClearBtn.addEventListener('click', () => {
    dom.cmdOutput.classList.remove('visible', 'error');
    dom.cmdOutput.textContent = '';
    dom.cmdOutput.className = 'cmd-output';
    dom.cmdInput.focus();
  });

  // Click on recent command to re-use it
  dom.recentCommandsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-list-item');
    if (!item) return;
    const text = item.dataset.cmd;
    if (text) {
      dom.cmdInput.value = text;
      dom.cmdInput.focus();
    }
  });
}

function renderRecentCommands() {
  if (!recentCommands.length) {
    dom.recentCommandsEl.innerHTML = '<p class="empty-message">Nenhum comando executado.</p>';
    return;
  }

  dom.recentCommandsEl.innerHTML = recentCommands.map((c, idx) => {
    const timeStr = c.time.toLocaleTimeString('pt-BR');
    const cmdDisplay = c.cmd.length > 50 ? c.cmd.slice(0, 47) + '...' : c.cmd;
    return `
      <div class="cmd-list-item" data-cmd="${escapeHtml(c.cmd)}" data-index="${idx}">
        <span class="cmd-time">${timeStr}</span>
        <span>${escapeHtml(cmdDisplay)}</span>
        <span class="cmd-dur">${c.latency}ms</span>
      </div>
    `;
  }).join('');
}

/* ============================================================
   Dashboard API — fetch skills, sessions, status
   ============================================================ */
async function getDashboardToken() {
  if (sessionToken) return sessionToken;

  const dashEndpoint = config.dashboardEndpoint.replace(/\/+$/, '');
  try {
    const html = await fetch(`${dashEndpoint}/`).then(r => r.text());
    const match = html.match(/window\.__HERMES_SESSION_TOKEN__="([^"]+)"/);
    if (match && match[1]) {
      sessionToken = match[1];
      return sessionToken;
    }
  } catch (err) {
    console.warn('[JARVIS] Could not get dashboard token:', err.message);
  }
  return null;
}

async function dashboardFetch(path, options = {}) {
  const token = await getDashboardToken();
  if (!token) throw new Error('Sem token do dashboard');

  const dashEndpoint = config.dashboardEndpoint.replace(/\/+$/, '');
  const url = `${dashEndpoint}${path}`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { detail = res.statusText; }
    throw new ApiError(`Dashboard API ${res.status}: ${detail.slice(0, 200)}`, res.status);
  }
  return res.json();
}

async function loadSkills() {
  dom.skillsList.innerHTML = '<p class="empty-message">Carregando skills...</p>';

  try {
    const skills = await dashboardFetch('/api/skills');

    if (!Array.isArray(skills) || !skills.length) {
      dom.skillsList.innerHTML = '<p class="empty-message">Nenhum skill carregado.</p>';
      return;
    }

    dom.skillsList.innerHTML = skills.map(s => {
      const badges = [];
      if (s.provenance === 'bundled') badges.push('<span class="badge bundled">bundled</span>');
      if (s.enabled) badges.push('<span class="badge enabled">ativo</span>');
      else badges.push('<span class="badge disabled">inativo</span>');

      return `
        <div class="skill-item">
          <div class="skill-name">
            ${escapeHtml(s.name)}
            ${badges.join(' ')}
          </div>
          <div class="skill-desc">${escapeHtml(s.description || 'Sem descrição')}</div>
          <div class="skill-meta">
            Categoria: ${escapeHtml(s.category || '—')} · Uso: ${s.usage ?? 0}x
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    dom.skillsList.innerHTML = `
      <div class="panel-section" style="padding:12px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:4px;">
        <p style="font-size:11px;color:var(--error);">Erro ao carregar skills: ${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function loadHistory() {
  dom.historyList.innerHTML = '<p class="empty-message">Carregando sessões...</p>';

  try {
    const data = await dashboardFetch('/api/sessions');
    const sessions = data.sessions || [];

    if (!sessions.length) {
      dom.historyList.innerHTML = '<p class="empty-message">Nenhuma sessão encontrada.</p>';
      return;
    }

    const sorted = sessions.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));

    dom.historyList.innerHTML = sorted.map(s => {
      const date = new Date((s.started_at || 0) * 1000);
      const label = s.display_name || s.title || `Sessão ${s.id?.slice(0, 8) || '?'}`;
      const msgs = s.message_count ?? '?';
      const tools = s.tool_call_count ?? '?';
      const dateStr = date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      return `
        <div class="list-item" title="${escapeHtml(s.id || '')}">
          <div class="h-title">${escapeHtml(label)}</div>
          <div class="h-meta">${dateStr} · ${msgs} mensagens · ${tools} tool calls</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    dom.historyList.innerHTML = `
      <div class="panel-section" style="padding:12px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.15);border-radius:4px;">
        <p style="font-size:11px;color:var(--error);">Erro ao carregar sessões: ${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function loadStatus() {
  try {
    const [st, cfg] = await Promise.all([
      dashboardFetch('/api/status'),
      dashboardFetch('/api/config'),
    ]);

    dom.sVersion.textContent = st.version || '—';
    dom.sGateway.textContent = st.gateway_state || '—';
    dom.sModel.textContent = cfg.model || config.model || '—';

    const provs = Object.keys(cfg.providers || {}).length;
    dom.sProviders.textContent = provs ? `${provs} configurado(s)` : '—';

    // Try to get active session info
    let sessionInfo = null;
    if (st.active_sessions && st.active_sessions > 0) {
      try {
        const sessionsData = await dashboardFetch('/api/sessions');
        sessionInfo = (sessionsData.sessions || [])[0] || null;
      } catch (_) {
        // ignore
      }
    }

    if (sessionInfo) {
      dom.sMsgCount.textContent = sessionInfo.message_count ?? '—';
      dom.sToolCount.textContent = sessionInfo.tool_call_count ?? '—';
      dom.sTokensIn.textContent = (sessionInfo.input_tokens ?? 0).toLocaleString('pt-BR');
      dom.sTokensOut.textContent = (sessionInfo.output_tokens ?? 0).toLocaleString('pt-BR');
      const cost = sessionInfo.estimated_cost_usd ?? sessionInfo.actual_cost_usd;
      dom.sCost.textContent = cost !== null && cost !== undefined
        ? `$${Number(cost).toFixed(4)}`
        : '—';
    } else {
      ['sMsgCount', 'sToolCount', 'sTokensIn', 'sTokensOut', 'sCost'].forEach(id => {
        const el = dom[id];
        if (el) el.textContent = '—';
      });
    }
  } catch (err) {
    // Silently fail — status panel can show stale data
    console.warn('[JARVIS] Status load failed:', err.message);
  }
}

/* ============================================================
   Settings panel
   ============================================================ */
function setupSettings() {
  dom.btnSaveConfig.addEventListener('click', () => {
    const endpoint = dom.cfgEndpoint.value.trim();
    const model = dom.cfgModel.value.trim();
    const temp = parseFloat(dom.cfgTemperature.value);

    if (!endpoint) {
      addMessage('agent', 'Endpoint não pode estar vazio.', { error: true, latency: 0 });
      return;
    }

    config.endpoint = endpoint || DEFAULT_CONFIG.endpoint;
    config.model = model || DEFAULT_CONFIG.model;
    config.temperature = isNaN(temp) ? DEFAULT_CONFIG.temperature : temp;

    saveConfig();
    addMessage('agent', 'Configurações salvas, senhor.', { latency: 0 });
  });

  dom.btnTestConnection.addEventListener('click', async () => {
    dom.btnTestConnection.disabled = true;
    dom.btnTestConnection.textContent = 'Testando...';
    try {
      const ok = await testConnection(false);
      if (ok) {
        addMessage('agent', 'Conexão verificada. Hermes Agent online.', { latency: 0 });
      } else {
        addMessage('agent', 'Falha na conexão. Verifique o endpoint e tente novamente.', { error: true, latency: 0 });
      }
    } finally {
      dom.btnTestConnection.disabled = false;
      dom.btnTestConnection.textContent = 'Testar Conexão';
    }
  });
}

/* ============================================================
   Connection test
   ============================================================ */
async function testConnection(silent = true) {
  updateStatus('checking', 'Testando conexão...');

  try {
    const endpoint = config.endpoint.replace(/\/+$/, '');
    const res = await fetch(`${endpoint}/v1/models`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      const models = (data.data || [])
        .map(m => m.id || m.name)
        .filter(Boolean)
        .join(', ') || '—';

      updateStatus('online', 'Online');

      if (!silent && models !== '—') {
        addMessage('agent', `Conexão estabelecida. Modelos disponíveis: ${models}`, { latency: 0 });
      }

      return true;
    }

    throw new ApiError(`HTTP ${res.status}: ${res.statusText}`, res.status);
  } catch (err) {
    updateStatus('error', 'Falha na conexão');
    if (!silent) {
      addMessage('agent', `Não foi possível conectar em ${config.endpoint}. Verifique se o Hermes proxy está rodando.`, { error: true, latency: 0 });
    }
    return false;
  }
}

/* ============================================================
   Toggle switches
   ============================================================ */
function setupToggles() {
  // Dark mode
  dom.toggleDark.addEventListener('click', () => {
    config.darkMode = !config.darkMode;
    dom.toggleDark.classList.toggle('on', config.darkMode);
    dom.toggleDark.setAttribute('aria-checked', config.darkMode);
    document.body.style.filter = config.darkMode ? 'none' : 'invert(1) hue-rotate(180deg)';
    saveConfig();
  });

  // Visual effects
  dom.toggleEffects.addEventListener('click', () => {
    config.visualEffects = !config.visualEffects;
    dom.toggleEffects.classList.toggle('on', config.visualEffects);
    dom.toggleEffects.setAttribute('aria-checked', config.visualEffects);
    document.body.classList.toggle('no-effects', !config.visualEffects);
    saveConfig();
  });

  // Voice — botão SEMPRE visível (o toggle nas configurações é só para habilitar/desabilitar funcionalmente)
  dom.toggleVoice.addEventListener('click', () => {
    config.voiceEnabled = !config.voiceEnabled;
    dom.toggleVoice.classList.toggle('on', config.voiceEnabled);
    dom.toggleVoice.setAttribute('aria-checked', config.voiceEnabled);
    saveConfig();
    if (!config.voiceEnabled && isRecognizing) {
      try { recognition?.stop(); } catch (_) {}
      isRecognizing = false;
      updateVoiceUIState(false, 'Desativado');
    }
  });

  // Initialize toggle states
  dom.toggleDark.classList.toggle('on', config.darkMode);
  dom.toggleDark.setAttribute('aria-checked', config.darkMode);
  document.body.style.filter = config.darkMode ? 'none' : 'invert(1) hue-rotate(180deg)';

  dom.toggleEffects.classList.toggle('on', config.visualEffects);
  dom.toggleEffects.setAttribute('aria-checked', config.visualEffects);
  document.body.classList.toggle('no-effects', !config.visualEffects);

  dom.toggleVoice.classList.toggle('on', config.voiceEnabled);
  dom.toggleVoice.setAttribute('aria-checked', config.voiceEnabled);

  // Botão de voz SEMPRE visível — o toggle só controla funcionalidade, não appearance
  const vb = dom.voiceBtn;
  if (vb) {
    vb.style.display = '';
    vb.removeAttribute('hidden');
  }
}

/* ============================================================
   Voice recognition (Web Speech API)
   ============================================================ */
/**
 * Voice commands map — when the user speaks these phrases, J.A.R.V.I.S. reacts.
 */
const VOICE_COMMANDS = {
  'olá jarvis': () => addMessage('user', 'Olá, J.A.R.V.I.S.'),
  'ola jarvis': () => addMessage('user', 'Olá, J.A.R.V.I.S.'),
  'hello jarvis': () => addMessage('user', 'Hello, J.A.R.V.I.S.'),
  'envia mensagem': null, // handled dynamically
  'enviar mensagem': null,
  'mandar mensagem': null,
  'limpa tela': () => {
    dom.chatArea.innerHTML = '';
    addMessage('agent', 'Tela limpa, senhor.', { latency: 0 });
  },
  'limpar tela': () => {
    dom.chatArea.innerHTML = '';
    addMessage('agent', 'Tela limpa, senhor.', { latency: 0 });
  },
  'clear': () => {
    dom.chatArea.innerHTML = '';
    addMessage('agent', 'Screen cleared, sir.', { latency: 0 });
  },
  'comandos': () => switchPanel('commands'),
  'comandos terminal': () => switchPanel('commands'),
  'terminal': () => switchPanel('chat'),
  'chat': () => switchPanel('chat'),
  'configurações': () => switchPanel('config'),
  'configuracoes': () => switchPanel('config'),
  'settings': () => switchPanel('config'),
  'status': () => switchPanel('status'),
  'habilidades': () => switchPanel('skills'),
  'skills': () => switchPanel('skills'),
  'histórico': () => switchPanel('history'),
  'historico': () => switchPanel('history'),
  'history': () => switchPanel('history'),
  'pare': () => {
    if (recognition && isRecognizing) {
      recognition.stop();
      isRecognizing = false;
      updateVoiceUIState(false, 'Voz interrompida.');
    }
  },
  'stop': () => {
    if (recognition && isRecognizing) {
      recognition.stop();
      isRecognizing = false;
      updateVoiceUIState(false, 'Stopped.');
    }
  },
  'escuta': () => {
    if (!isRecognizing) startVoiceRecognition();
  },
  'ouvir': () => {
    if (!isRecognizing) startVoiceRecognition();
  },
  'listen': () => {
    if (!isRecognizing) startVoiceRecognition();
  },
  'jarvis': () => {
    // Wake word — if not listening, start; if listening, flash indicator
    if (!isRecognizing) {
      startVoiceRecognition();
    } else {
      // Already listening — just acknowledge
      updateVoiceUIState(true, 'Ao seu comando, senhor.');
      setTimeout(() => updateVoiceUIState(true, 'Ouvindo...'), 800);
    }
  },
};

/**
 * Normalize transcript for matching.
 */
function normalizeTranscript(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try to match voice command.
 * Returns true if a command was executed.
 */
function tryVoiceCommand(transcript) {
  const normalized = normalizeTranscript(transcript);

  // Check exact matches first
  for (const [key, action] of Object.entries(VOICE_COMMANDS)) {
    if (normalized === key && action) {
      action();
      return true;
    }
  }

  // Check if transcript starts with a command phrase
  for (const [key, action] of Object.entries(VOICE_COMMANDS)) {
    if (action && normalized.startsWith(key)) {
      // Extract the rest as the message
      const rest = transcript.slice(key.length).trim();
      if (key === 'envia mensagem' || key === 'enviar mensagem' || key === 'mandar mensagem') {
        if (rest) {
          addMessage('user', rest);
        } else {
          addMessage('agent', 'O quê, senhor?', { latency: 0 });
        }
        return true;
      }
      if (action) {
        action();
        return true;
      }
    }
  }

  return false;
}

/**
 * Update voice UI state.
 */
function updateVoiceUIState(listening, statusText) {
  isRecognizing = listening;
  dom.voiceBtn.classList.toggle('listening', listening);
  dom.voiceBtn.setAttribute('aria-label', listening ? 'Parar reconhecimento de voz' : 'Iniciar reconhecimento de voz');
  if (dom.voiceStatus) {
    dom.voiceStatus.textContent = statusText || (listening ? 'Ouvindo...' : 'Pronto');
    dom.voiceStatus.classList.toggle('listening', listening);
  }
}

/**
 * Start voice recognition.
 */
function startVoiceRecognition() {
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    addMessage('agent', 'Reconhecimento de voz não é suportado neste navegador.', { error: true, latency: 0 });
    return;
  }

  if (isRecognizing) {
    // Already listening — restart to get fresh transcript
    try { recognition.stop(); } catch (_) {}
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = config.voiceLang || 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecognizing = true;
    updateVoiceUIState(true, 'Ouvindo...');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('[JARVIS] Voice transcript:', transcript);

    // Try to match command
    const matched = tryVoiceCommand(transcript);

    if (!matched && transcript.trim()) {
      // Not a known command — send as chat message via sendMessage only
      // DO NOT addMessage here — sendMessage handles it
      dom.chatInput.value = transcript;
      sendMessage();
    }

    // Stop after result
    try { recognition.stop(); } catch (_) {}
  };

  recognition.onerror = (event) => {
    console.warn('[JARVIS] Speech recognition error:', event.error);
    let msg = 'Erro no reconhecimento de voz.';
    if (event.error === 'no-speech') msg = 'Nenhuma fala detectada.';
    else if (event.error === 'aborted') msg = 'Reconhecimento interrompido.';
    else if (event.error === 'audio-capture') msg = 'Nenhum microfone encontrado.';
    else if (event.error === 'not-allowed') msg = 'Permissão de microfone negada.';

    updateVoiceUIState(false, msg);
    addMessage('agent', msg, { error: true, latency: 0 });
    isRecognizing = false;
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (!dom.voiceBtn.classList.contains('listening')) {
      updateVoiceUIState(false, 'Pronto');
    } else {
      // Ended while still "listening" — reset
      updateVoiceUIState(false, 'Pronto');
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.error('[JARVIS] Failed to start recognition:', err);
    updateVoiceUIState(false, 'Erro ao iniciar');
    addMessage('agent', 'Não foi possível iniciar o reconhecimento de voz.', { error: true, latency: 0 });
  }
}

function toggleVoice() {
  if (config.voiceEnabled) {
    startVoiceRecognition();
  } else {
    addMessage('agent', 'Ative o reconhecimento de voz nas configurações para usar.', { latency: 0 });
  }
}

function setupVoice() {
  dom.voiceBtn.addEventListener('click', toggleVoice);
}

/* ============================================================
   Welcome overlay animation
   ============================================================ */
function animateWelcomeLines() {
  const lines = dom.welcomeStatus.querySelectorAll('.line');
  lines.forEach((line, idx) => {
    line.style.animationDelay = `${0.5 + idx * 0.3}s`;
  });
}

/* ============================================================
   Sidebar navigation
   ============================================================ */
function setupSidebar() {
  $$('.sidebar-item[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchPanel(btn.dataset.panel);
    });
  });
}

/* ============================================================
   Bootstrap
   ============================================================ */
async function init() {
  // Restore config values to UI
  dom.cfgEndpoint.value = config.endpoint;
  dom.cfgModel.value = config.model;
  dom.cfgTemperature.value = config.temperature;

  // Set up all subsystems
  setupSidebar();
  setupChatInput();
  setupCommands();
  setupSettings();
  setupToggles();
  setupVoice();

  // Animate welcome lines
  animateWelcomeLines();

  // Initial status
  updateStatus('checking', 'Iniciando...');

  // Test connection to proxy
  const proxyOk = await testConnection(true);

  if (proxyOk) {
    // Load dashboard data
    try {
      await Promise.all([
        loadSkills(),
        loadHistory(),
        loadStatus(),
      ]);
    } catch (err) {
      console.warn('[JARVIS] Dashboard data load issues:', err.message);
    }

    // Hide welcome overlay
    setTimeout(() => {
      dom.welcomeOverlay.classList.add('hidden');
      setTimeout(() => {
        dom.welcomeOverlay.style.display = 'none';
      }, 400);
    }, 1800);
  } else {
    updateStatus('error', 'Sem conexão');
    dom.welcomeStatus.innerHTML = `
      <span class="line" style="color:var(--error);">Falha ao conectar ao Hermes Agent.</span>
      <span class="line" style="color:var(--error);">Verifique se o proxy está rodando.</span>
    `;
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose some internals for debugging
window.__jarvis = {
  config,
  recentCommands,
  sessionToken: () => sessionToken,
  startVoice: startVoiceRecognition,
  stopVoice: () => {
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }
    isRecognizing = false;
    updateVoiceUIState(false, 'Pronto');
  },
};
