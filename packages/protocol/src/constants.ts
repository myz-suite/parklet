/** 线协议版本：仍是设计中的 draft，尚未 stable。与各 package 的 npm 版本无关。 */
export const PROTOCOL_VERSION = '0.2.0-draft' as const;

/** 协议标识名，用于握手（extension.hello / ping）确认两端协议一致。 */
export const PROTOCOL_NAME = 'parklet' as const;

export function protocolName(): string {
  return PROTOCOL_NAME;
}
