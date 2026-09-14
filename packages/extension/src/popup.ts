import type { PopupResponse } from './shared/messages.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const serverUrlInput = $<HTMLInputElement>('server-url');
const tokenInput = $<HTMLInputElement>('token');
const saveBtn = $<HTMLButtonElement>('save');
const statusDot = $<HTMLSpanElement>('status-dot');
const statusText = $<HTMLSpanElement>('status-text');

async function send<T = PopupResponse>(message: unknown): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function setStatus(connected: boolean): void {
  statusDot.className = `dot ${connected ? 'online' : 'offline'}`;
  statusText.textContent = connected ? 'connected' : 'disconnected';
  if (connected) {
    saveBtn.textContent = 'Connected ✓';
    saveBtn.disabled = true;
  } else {
    saveBtn.textContent = 'Save & Connect';
    saveBtn.disabled = false;
  }
}

async function refreshConfig(): Promise<void> {
  const cfg = await send<Extract<PopupResponse, { type: 'config' }>>({ type: 'config:get' });
  serverUrlInput.value = cfg.serverUrl;
  tokenInput.value = cfg.token;
  setStatus(cfg.connected);
}

saveBtn.addEventListener('click', () => {
  void (async () => {
    await send({
      type: 'config:set',
      config: { serverUrl: serverUrlInput.value.trim(), token: tokenInput.value.trim() },
    });
    await refreshConfig();
  })();
});

// 打开 popup 时刷新；popup 存活期间每 1.5s 轮询连接状态
void refreshConfig();
setInterval(() => {
  void (async () => {
    const st = await send<Extract<PopupResponse, { type: 'state' }>>({ type: 'state:get' });
    setStatus(st.connected);
  })();
}, 1500);
