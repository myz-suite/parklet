/** 扩展连接状态与 badge/popup 展示（纯逻辑，可单测）。 */

export type ConnState =
  'unconfigured' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected';

export interface Badge {
  text: string;
  color: string;
}

export const GREEN = '#2ecc40';
export const RED = '#ff3b30';
export const ORANGE = '#ff9500';

/**
 * 状态 → action badge。
 * - connected：绿色圆点
 * - disconnected（曾连接/服务端不可达）：红色圆点
 * - unconfigured / auth_failed（配置无效）：橙色圆点
 * - connecting：返回 null（保持上一个 badge，避免闪烁）
 */
export function badgeFor(state: ConnState): Badge | null {
  switch (state) {
    case 'connected':
      return { text: '●', color: GREEN };
    case 'disconnected':
      return { text: '●', color: RED };
    case 'unconfigured':
    case 'auth_failed':
      return { text: '●', color: ORANGE };
    case 'connecting':
      return null;
  }
}

export function statusLabel(state: ConnState): string {
  switch (state) {
    case 'unconfigured':
      return 'not configured';
    case 'connecting':
      return 'connecting…';
    case 'connected':
      return 'connected';
    case 'auth_failed':
      return 'token rejected';
    case 'disconnected':
      return 'disconnected';
  }
}

export interface StatusInfo {
  serverUrl: string;
  lastError?: string;
}

/** popup 中的引导文案。 */
export function guidanceFor(state: ConnState, info: StatusInfo): string {
  switch (state) {
    case 'unconfigured':
      return '未配置：填写 Server URL 与 token（token 来自 `plt serve` 的输出），然后 Save & Connect。';
    case 'connecting':
      return `正在连接 ${info.serverUrl}…`;
    case 'connected':
      return '已连接，可以开始发送命令。';
    case 'auth_failed':
      return 'Server 可达但 token 被拒绝：请重新复制 `plt serve` 输出的 pair token 后再次连接。';
    case 'disconnected':
      return info.lastError?.includes('server shutting down')
        ? '服务端已停止；重新运行 `plt serve` 后点 Retry。'
        : '连接失败：确认 parklet-server 已启动（`plt serve`）且地址可访问，然后点 Retry。';
  }
}
