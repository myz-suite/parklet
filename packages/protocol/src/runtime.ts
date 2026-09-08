/**
 * 运行时子路径导出：不引入 zod/schemas，供浏览器端（extension）使用。
 * 类型可从主包或此处导入（type-only，编译期消除）。
 */
export { PROTOCOL_NAME, PROTOCOL_VERSION, protocolName } from './constants.js';
export {
  ERROR_CODES,
  ParkinglotError,
  isErrorCode,
  type ErrorCode,
  type ProtocolErrorData,
} from './errors.js';
export {
  EVENT_NAMES,
  isError,
  isEvent,
  isRequest,
  isResponse,
  type CommandResult,
  type ErrorBody,
  type EventMessage,
  type EventName,
  type Message,
  type ProtocolError,
  type Request,
  type Response,
} from './envelope.js';
export { METHOD_META, METHODS, type Method, type MethodMeta, type WriteAccess } from './methods.js';
export type {
  ActivateTabParams,
  ClickParams,
  ClickTextParams,
  CloseTabParams,
  CreateTabParams,
  EvalParams,
  FetchParams,
  FillParams,
  GotoParams,
  HoverParams,
  NoopParams,
  ParamsMap,
  ParamsOf,
  PressParams,
  ResultMap,
  ResultOf,
  ScrollParams,
  ScreenshotParams,
  SearchParams,
  SelectParams,
  TypeParams,
  WaitParams,
} from './methods.js';
export type {
  ContextSnapshot,
  ElementBox,
  ElementInfo,
  Locator,
  PageSnapshot,
  SearchResult,
  SessionInfo,
  SessionMode,
  TabInfo,
  Viewport,
} from './types.js';
