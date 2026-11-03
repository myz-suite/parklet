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
  'click-text': z.object({
    text: z.string().min(1),
    within: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    exact: z.boolean().optional(),
    nth: z.number().int().nonnegative().optional(),
  }),
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
      by: z
        .number()
        .finite()
        .refine((n) => n !== 0, { message: 'scroll --by 不能为 0' })
        .optional(),
      to: z.enum(['top', 'bottom']).optional(),
      selector: z.string().min(1).optional(),
      smooth: z.boolean().optional(),
      settle: z.boolean().optional(),
      focus: z.boolean().optional(),
      allowNoop: z.boolean().optional(),
    })
    .refine((p) => p.by !== undefined || p.to !== undefined, {
      message: 'scroll 需要提供 --by 或 --to',
    })
    .refine((p) => !(p.by !== undefined && p.to !== undefined), {
      message: 'scroll 的 --by 与 --to 互斥',
    }),
  screenshot: z.object({
    format: z.enum(['png', 'jpeg']).optional(),
    selector: z.string().min(1).optional(),
    restoreFocus: z.boolean().optional(),
    path: z.string().optional(),
  }),
  'scroll-to': z.object({
    selector: z.string().min(1),
    smooth: z.boolean().optional(),
    settle: z.boolean().optional(),
    focus: z.boolean().optional(),
  }),
  // 提取
  extract: z
    .object({
      mode: z.enum(['text', 'structured', 'html', 'links', 'forms']).optional(),
      fields: z
        .array(
          z.object({
            name: z.string().min(1),
            selector: z.string().min(1),
            alternatives: z.array(z.string().min(1)).optional(),
            attr: z.string().min(1).optional(),
          }),
        )
        .min(1)
        .optional(),
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
    })
    .refine((p) => p.fields === undefined || p.selector !== undefined, {
      message: 'extract --fields 需要配合 --selector（行选择器）',
    })
    .refine((p) => !(p.fields !== undefined && (p.mode !== undefined || p.article === true)), {
      message: 'extract 的 fields 与 mode/article 互斥',
    }),
  'get-page-info': z.object({ selector: z.string().min(1).optional() }),
  'dom-query': z
    .object({
      selector: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      limit: z.number().int().positive().optional(),
    })
    .refine((p) => p.selector !== undefined || p.text !== undefined, {
      message: 'dom-query 需要提供 selector 或 text（至少其一）',
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
      count: z.number().int().positive().optional(),
      stableMs: z.number().int().nonnegative().optional(),
      condition: z.enum(['networkidle', 'load', 'content']).optional(),
    })
    .refine((p) => p.ms !== undefined || p.selector !== undefined || p.condition !== undefined, {
      message: 'wait 需要提供 ms / selector / condition（至少其一）',
    })
    .refine((p) => !(p.selector !== undefined && p.condition !== undefined), {
      message: 'wait 的 selector 与 condition 互斥',
    })
    .refine((p) => p.count === undefined || p.selector !== undefined, {
      message: 'wait --count 需要配合 --selector',
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
