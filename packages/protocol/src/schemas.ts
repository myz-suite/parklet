import { z } from 'zod';
import { ERROR_CODES } from './errors.js';
import { EVENT_NAMES } from './envelope.js';
import type { Method } from './methods.js';
import { METHODS } from './methods.js';
import type { ParamsMap } from './methods.js';

/**
 * Zod 校验层。原则（Postel's Law）：
 * - 发送保守：schema 精确到每个命令的参数形状
 * - 接收宽容：未知字段默认 strip，缺省字段用 optional/默认值
 */

// ---------------------------------------------------------------------------
// 公共形状
// ---------------------------------------------------------------------------

export const contextSchema = z.object({
  url: z.string(),
  title: z.string(),
  navId: z.number().int().nonnegative(),
  tabId: z.number().int().nonnegative(),
});

export const viewportSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const elementInfoSchema = z.object({
  tag: z.string(),
  text: z.string().optional(),
  attrs: z.record(z.string(), z.string()),
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});

const httpUrlSchema = z.string().url();

// ---------------------------------------------------------------------------
// 每个命令的参数 schema
// ---------------------------------------------------------------------------

const noopSchema = z.object({});

export const paramsSchemas = {
  // 导航
  goto: z.object({
    url: httpUrlSchema,
    waitUntil: z.enum(['load', 'domcontentloaded']).optional(),
  }),
  back: noopSchema,
  forward: noopSchema,
  reload: noopSchema,
  // 交互
  click: z.object({ selector: z.string().min(1) }),
  'click-text': z.object({ text: z.string().min(1) }),
  fill: z.object({ selector: z.string().min(1), value: z.string() }),
  type: z.object({ selector: z.string().min(1), text: z.string() }),
  press: z.object({ selector: z.string().min(1).optional(), key: z.string().min(1) }),
  hover: z.object({ selector: z.string().min(1) }),
  select: z
    .object({
      selector: z.string().min(1),
      value: z.string().optional(),
      label: z.string().optional(),
    })
    .refine((p) => p.value !== undefined || p.label !== undefined, {
      message: 'select 需要提供 value 或 label（至少其一）',
    }),
  selection: z
    .object({
      selector: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
    })
    .refine((p) => p.selector !== undefined || p.text !== undefined, {
      message: 'selection 需要提供 selector 或 text（至少其一）',
    }),
  // 滚动 / 视图
  scroll: z
    .object({
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
      amount: z.number().optional(),
      selector: z.string().min(1).optional(),
    })
    .refine(
      (p) => p.direction !== undefined || p.amount !== undefined || p.selector !== undefined,
      {
        message: 'scroll 需要提供 direction / amount / selector（至少其一）',
      },
    ),
  screenshot: z.object({
    format: z.enum(['png', 'jpeg']).optional(),
    fullPage: z.boolean().optional(),
    selector: z.string().min(1).optional(),
    path: z.string().optional(),
  }),
  'scroll-to': z.object({ selector: z.string().min(1) }),
  // 提取
  extract: z
    .object({
      mode: z.enum(['text', 'structured', 'html']).optional(),
      article: z.boolean().optional(),
      selector: z.string().min(1).optional(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
      depth: z.number().int().nonnegative().optional(),
      visibleOnly: z.boolean().optional(),
      maxChars: z.number().int().positive().optional(),
      exclude: z.string().min(1).optional(),
    })
    .refine((p) => !(p.article === true && p.mode !== undefined), {
      message: 'extract 的 article 与 mode 互斥（article=true 时不可同时提供 mode）',
    }),
  'get-page-info': noopSchema,
  'dom-query': z
    .object({
      selector: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      limit: z.number().int().positive().optional(),
    })
    .refine((p) => p.selector !== undefined || p.text !== undefined, {
      message: 'dom-query 需要提供 selector 或 text（至少其一）',
    }),
  links: z.object({
    selector: z.string().min(1).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    visibleOnly: z.boolean().optional(),
  }),
  forms: z.object({
    selector: z.string().min(1).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    visibleOnly: z.boolean().optional(),
  }),
  // 页面内网络
  fetch: z.object({
    url: httpUrlSchema,
    method: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    returnType: z.enum(['text', 'json', 'binary']).optional(),
  }),
  search: z.object({
    query: z.string().min(1),
    engine: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  // 标签页
  'list-tabs': noopSchema,
  'create-tab': z.object({ url: httpUrlSchema }),
  'close-tab': z.object({ tabId: z.number().int().nonnegative().optional() }),
  'activate-tab': z.object({ tabId: z.number().int().nonnegative() }),
  // 等待
  wait: z
    .object({
      ms: z.number().nonnegative().optional(),
      selector: z.string().min(1).optional(),
      condition: z.enum(['networkidle', 'load']).optional(),
    })
    .refine((p) => p.ms !== undefined || p.selector !== undefined || p.condition !== undefined, {
      message: 'wait 需要提供 ms / selector / condition（至少其一）',
    }),
  // 会话
  ping: noopSchema,
  'get-status': noopSchema,
  // 高级
  eval: z.object({ script: z.string().min(1) }),
} satisfies { [M in Method]: z.ZodType<ParamsMap[M]> };

export type ParamsSchemaOf<M extends Method> = (typeof paramsSchemas)[M];

/** 按 method 校验命令参数。未知字段被 strip，返回规范化后的参数。 */
export function validateParams<M extends Method>(
  method: M,
  params: unknown,
): { success: true; data: ParamsMap[M] } | { success: false; error: z.ZodError } {
  const result = paramsSchemas[method].safeParse(params ?? {});
  return result.success
    ? { success: true, data: result.data as ParamsMap[M] }
    : { success: false, error: result.error };
}

// ---------------------------------------------------------------------------
// 信封 schema
// ---------------------------------------------------------------------------

export const requestSchema = z.object({
  id: z.string().min(1),
  method: z.enum(METHODS),
  params: z.unknown().optional(),
  tabId: z.number().int().nonnegative().optional(),
});

export const commandResultSchema = z.object({
  tabId: z.number().int().nonnegative().optional(),
  context: contextSchema.optional(),
  data: z.unknown(),
});

export const responseSchema = z.object({
  id: z.string().min(1),
  result: commandResultSchema,
});

export const errorSchema = z.object({
  id: z.string().min(1),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const eventSchema = z.object({
  event: z.enum(EVENT_NAMES),
  params: z.record(z.string(), z.unknown()),
});
