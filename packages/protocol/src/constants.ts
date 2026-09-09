export const PROTOCOL_VERSION = '0.2.0' as const;

/** 协议标识名，用于握手（extension.hello / ping）确认两端协议一致。 */
export const PROTOCOL_NAME = 'parkinglot' as const;

export function protocolName(): string {
  return PROTOCOL_NAME;
}
