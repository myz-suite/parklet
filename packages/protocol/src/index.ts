/**
 * @parkinglot/protocol — 共享协议层。
 *
 * 内容：消息信封（Request/Response/Error/Event）、命令全集与类型映射、
 * 公共类型（ContextSnapshot/PageSnapshot/ElementInfo/SessionInfo…）、
 * 错误码、Zod 校验 schema。
 *
 * 协议权威文档：docs/protocol.md
 */
export { PROTOCOL_NAME, PROTOCOL_VERSION, protocolName } from './constants.js';

export * from './errors.js';
export * from './types.js';
export * from './methods.js';
export * from './envelope.js';
export * from './schemas.js';
