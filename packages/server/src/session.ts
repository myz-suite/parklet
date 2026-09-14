import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParkinglotError, type ContextSnapshot } from '@parkinglot/protocol';

export interface Session {
  id: string;
  tabId?: number;
  createdAt: string;
  lastUsedAt: string;
  /** 易失字段：扩展重连后由扩展重新上报，不持久化 */
  context?: ContextSnapshot;
}

export interface ResolvedTarget {
  sessionId?: string;
  tabId?: number;
}

interface StateFile {
  defaultSessionId?: string;
  sessions: Session[];
}

/**
 * 会话注册表：逻辑层寻址单元。
 * - 提供命令的连续性（默认 session 持久化于 state file，容忍 server 重启）
 * - 寻址优先级：params.sessionId > params.tabId > 默认 session > 最近活跃 tab（由调用方传入）
 */
export class SessionRegistry {
  private sessions = new Map<string, Session>();
  private defaultSessionId: string | undefined;
  private stateFilePath: string;

  constructor(stateDir: string) {
    this.stateFilePath = join(stateDir, 'sessions.json');
    mkdirSync(stateDir, { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.stateFilePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.stateFilePath, 'utf8')) as StateFile;
      this.defaultSessionId = data.defaultSessionId;
      for (const s of data.sessions) {
        // 过滤掉结构损坏的条目
        if (typeof s?.id === 'string') this.sessions.set(s.id, s);
      }
    } catch {
      // state file 损坏则从空开始
    }
  }

  private save(): void {
    const data: StateFile = {
      defaultSessionId: this.defaultSessionId,
      sessions: [...this.sessions.values()],
    };
    writeFileSync(this.stateFilePath, JSON.stringify(data, null, 2));
  }

  create(opts?: { tabId?: number }): Session {
    const now = new Date().toISOString();
    const session: Session = {
      id: `pl-${randomUUID().slice(0, 8)}`,
      tabId: opts?.tabId,
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(session.id, session);
    if (!this.defaultSessionId) this.defaultSessionId = session.id;
    this.save();
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  /** 更新会话的最近使用时间与易失状态（tabId/context）。 */
  touch(id: string, patch: { tabId?: number; context?: ContextSnapshot }): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastUsedAt = new Date().toISOString();
    if (patch.tabId !== undefined) s.tabId = patch.tabId;
    if (patch.context !== undefined) s.context = patch.context;
    this.save();
  }

  setDefault(id: string): boolean {
    if (!this.sessions.has(id)) return false;
    this.defaultSessionId = id;
    this.save();
    return true;
  }

  getDefault(): Session | undefined {
    return this.defaultSessionId ? this.sessions.get(this.defaultSessionId) : undefined;
  }

  close(id: string): boolean {
    const removed = this.sessions.delete(id);
    if (removed && this.defaultSessionId === id) this.defaultSessionId = undefined;
    if (removed) this.save();
    return removed;
  }

  /** 解除所有绑定到该 tabId 的 session（tab 关闭/失效时调用）。 */
  unbindTab(tabId: number): void {
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.tabId === tabId) {
        s.tabId = undefined;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * 寻址解析。优先级：sessionId > tabId > 默认 session > 最近活跃 tab（latestTabId）。
   * 解析失败抛出带标准错误码的 ParkinglotError。
   */
  resolve(params: { sessionId?: string; tabId?: number }, latestTabId?: number): ResolvedTarget {
    if (params.sessionId !== undefined) {
      const s = this.sessions.get(params.sessionId);
      if (!s) {
        throw new ParkinglotError(
          'SESSION_NOT_FOUND',
          `session ${params.sessionId} not found or already closed`,
        );
      }
      if (s.tabId === undefined) {
        // session 的 tab 已失效：回退到全局最近激活 tab 并重绑；
        // 若连 latestTabId 也没有（尚无 tab-activated），则无可寻址目标。
        if (latestTabId !== undefined) {
          this.touch(s.id, { tabId: latestTabId });
          return { sessionId: s.id, tabId: latestTabId };
        }
        throw new ParkinglotError(
          'EXTENSION_NO_TAB',
          `session ${s.id} has no live tab and no active tab to fall back to`,
        );
      }
      return { sessionId: s.id, tabId: s.tabId };
    }

    if (params.tabId !== undefined) {
      return { tabId: params.tabId };
    }

    if (this.defaultSessionId) {
      const s = this.sessions.get(this.defaultSessionId);
      if (s?.tabId !== undefined) {
        return { sessionId: s.id, tabId: s.tabId };
      }
    }

    if (latestTabId !== undefined) {
      return { tabId: latestTabId };
    }

    throw new ParkinglotError(
      'EXTENSION_NO_TAB',
      'no tab targeted: run `plt goto <url>` to create a session, or pass --session/--tab',
    );
  }
}
