import { randomUUID } from 'node:crypto';
import type { Request } from '@parkinglot/protocol';

export type ApprovalOutcome = 'approved' | 'denied' | 'timeout';

export interface PendingApprovalView {
  requestId: string;
  method: string;
  summary: string;
  sessionId?: string;
  createdAt: string;
}

interface PendingApproval {
  requestId: string;
  request: Request;
  sessionId?: string;
  timer: NodeJS.Timeout;
  settle: (outcome: ApprovalOutcome) => void;
}

/**
 * HITL 审批管理器：ask 模式下的写操作在此挂起，等待 popup 或
 * `POST /api/approve/:id` 批准；超时自动拒绝（fail-closed）。
 */
export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();

  constructor(private readonly timeoutMs = 60_000) {}

  /** 挂起一个请求，返回审批结果（approved / denied / timeout）。 */
  request(
    request: Request,
    sessionId: string | undefined,
    onPending?: (view: PendingApprovalView) => void,
  ): Promise<ApprovalOutcome> {
    const requestId = `ap-${randomUUID().slice(0, 8)}`;
    const view: PendingApprovalView = {
      requestId,
      method: request.method,
      summary: summarize(request),
      sessionId,
      createdAt: new Date().toISOString(),
    };
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve('timeout');
      }, this.timeoutMs);
      // 不阻止进程退出
      timer.unref();
      this.pending.set(requestId, {
        requestId,
        request,
        sessionId,
        timer,
        settle: resolve,
      });
      onPending?.(view);
    });
  }

  /** 批准（allow=true）或拒绝（allow=false）。返回是否找到该请求。 */
  respond(requestId: string, allow: boolean): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.settle(allow ? 'approved' : 'denied');
    return true;
  }

  list(): PendingApprovalView[] {
    return [...this.pending.values()].map((p) => ({
      requestId: p.requestId,
      method: p.request.method,
      summary: summarize(p.request),
      sessionId: p.sessionId,
      createdAt: new Date().toISOString(),
    }));
  }
}

function summarize(request: Request): string {
  try {
    return JSON.stringify(request.params ?? {});
  } catch {
    return String(request.params);
  }
}
