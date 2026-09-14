import type { PopupConnState, PopupResponse } from './shared/messages.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const serverUrlInput = $<HTMLInputElement>('server-url');
const tokenInput = $<HTMLInputElement>('token');
const saveBtn = $<HTMLButtonElement>('save');
const retryBtn = $<HTMLButtonElement>('retry');
const statusDot = $<HTMLSpanElement>('status-dot');
const statusText = $<HTMLSpanElement>('status-text');
const guidance = $<HTMLParagraphElement>('guidance');

async function send<T = PopupResponse>(message: unknown): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

const DOT_CLASS: Record<PopupConnState, string> = {
  connected: 'online',
  connecting: 'pending',
  disconnected: 'offline',
  unconfigured: 'warn',
  auth_failed: 'warn',
};

function setStatus(state: PopupConnState, label: string, message: string): void {
  statusDot.className = `dot ${DOT_CLASS[state]}`;
  statusText.textContent = label;
  guidance.textContent = message;
  const isConnected = state === 'connected';
  saveBtn.textContent = isConnected ? 'Connected ✓' : 'Save & Connect';
  saveBtn.disabled = isConnected;
  // 已连接时无需重试；其余状态允许重试
  retryBtn.disabled = isConnected;
}

async function refreshState(): Promise<void> {
  const st = await send<Extract<PopupResponse, { type: 'state' }>>({ type: 'state:get' });
  setStatus(st.state, st.label, st.guidance);
}

async function refreshConfig(): Promise<void> {
  const cfg = await send<Extract<PopupResponse, { type: 'config' }>>({ type: 'config:get' });
  serverUrlInput.value = cfg.serverUrl;
  tokenInput.value = cfg.token;
}

saveBtn.addEventListener('click', () => {
  void (async () => {
    await send({
      type: 'config:set',
      config: { serverUrl: serverUrlInput.value.trim(), token: tokenInput.value.trim() },
    });
    await refreshState();
  })();
});

retryBtn.addEventListener('click', () => {
  void (async () => {
    await send({ type: 'state:retry' });
    await refreshState();
  })();
});

// 打开 popup 时刷新；popup 存活期间每 1.5s 轮询连接状态
void refreshConfig();
void refreshState();
setInterval(() => {
  void refreshState();
}, 1500);
