/** 扩展内部消息类型：SW ↔ content script、SW ↔ popup。 */

// SW → content：执行命令
export interface ContentCommand {
  type: 'pl:command';
  id: string;
  method: string;
  params: Record<string, unknown>;
  /** background 解析出的目标 tab 与 navId（连续性的自证来源） */
  tabId: number;
  navId: number;
}

// content → SW：命令结果
export interface ContentResult {
  type: 'pl:result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

// popup → SW
export type PopupRequest =
  | { type: 'config:get' }
  | { type: 'config:set'; config: { serverUrl: string; token: string } }
  | { type: 'state:get' }
  | { type: 'state:retry' };

export type PopupConnState =
  'unconfigured' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected';

// SW → popup
export type PopupResponse =
  | { type: 'config'; serverUrl: string; token: string; connected: boolean }
  | { type: 'config:ok' }
  | {
      type: 'state';
      state: PopupConnState;
      label: string;
      guidance: string;
      connected: boolean;
      serverUrl: string;
      lastError?: string;
      retryDelayMs: number;
    }
  | { type: 'state:ok' }
  | { type: 'error'; message: string };
