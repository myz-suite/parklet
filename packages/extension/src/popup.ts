import type { PopupResponse } from './shared/messages.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const serverUrlInput = $<HTMLInputElement>('server-url');
const tokenInput = $<HTMLInputElement>('token');
const saveBtn = $<HTMLButtonElement>('save');
const statusDot = $<HTMLSpanElement>('status-dot');
const statusText = $<HTMLSpanElement>('status-text');
const approvalList = $<HTMLUListElement>('approval-list');
const approvalsEmpty = $<HTMLElement>('approvals-empty');

async function send<T = PopupResponse>(message: unknown): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function setStatus(connected: boolean): void {
  statusDot.className = `dot ${connected ? 'online' : 'offline'}`;
  statusText.textContent = connected ? 'connected' : 'disconnected';
}

async function refreshConfig(): Promise<void> {
  const cfg = await send<Extract<PopupResponse, { type: 'config' }>>({ type: 'config:get' });
  serverUrlInput.value = cfg.serverUrl;
  tokenInput.value = cfg.token;
  setStatus(cfg.connected);
}

async function refreshApprovals(): Promise<void> {
  const res = await send<Extract<PopupResponse, { type: 'approvals' }>>({ type: 'approvals:list' });
  approvalList.replaceChildren();
  approvalsEmpty.classList.toggle('hidden', res.items.length > 0);
  for (const item of res.items) {
    const li = document.createElement('li');
    const summary = document.createElement('span');
    summary.className = 'summary';
    summary.textContent = `${item.method} ${item.summary}`;
    const approveBtn = document.createElement('button');
    approveBtn.className = 'secondary';
    approveBtn.textContent = '✔';
    approveBtn.title = 'Approve';
    approveBtn.addEventListener('click', () => void respond(item.requestId, true));
    const denyBtn = document.createElement('button');
    denyBtn.className = 'secondary';
    denyBtn.textContent = '✖';
    denyBtn.title = 'Deny';
    denyBtn.addEventListener('click', () => void respond(item.requestId, false));
    li.append(summary, approveBtn, denyBtn);
    approvalList.append(li);
  }
}

async function respond(requestId: string, approved: boolean): Promise<void> {
  await send({ type: 'approval:respond', requestId, approved });
  await refreshApprovals();
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

// 打开 popup 时刷新；popup 存活期间每 1.5s 轮询状态与批准队列
void refreshConfig();
setInterval(() => {
  void (async () => {
    const st = await send<Extract<PopupResponse, { type: 'state' }>>({ type: 'state:get' });
    setStatus(st.connected);
    void refreshApprovals();
  })();
}, 1500);
