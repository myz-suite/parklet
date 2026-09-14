/**
 * 当前目标 tab（软指针）：命令未显式带 tabId 时使用。
 * 仅存内存、不持久化；tab 关闭/失效时清除并回退到最近激活 tab。
 * 取代旧的多 session 注册表，避免 session 泄漏。
 */
export class TargetState {
  private currentTabId: number | undefined;

  get(): number | undefined {
    return this.currentTabId;
  }

  set(tabId: number | undefined): void {
    this.currentTabId = tabId;
  }

  clearIf(tabId: number): void {
    if (this.currentTabId === tabId) this.currentTabId = undefined;
  }
}
