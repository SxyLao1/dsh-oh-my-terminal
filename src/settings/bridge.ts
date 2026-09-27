/**
 * @file settings bridge 路由工厂
 * @description 提供工厂函数 {@link createSettingsBridgeRoutes}，接收 settings 服务
 *              实例与命名空间，返回两个路由配置对象（describe + mutate）供 webServer
 *              注册。独立插件无法直接 import 官方 settings 包，因此定义最小
 *              {@link SettingsLike} 接口——只包含 describe/mutate/writable 三个
 *              必需成员，与官方 settings 服务的公开 API 形状对齐。
 *
 * 路由设计：
 * - GET  /settings/describe → 返回插件配置的当前快照（namespace/revision/config/writable）
 * - POST /settings/mutate   → 接收 JSON Patch 操作数组，原子提交配置变更
 *
 * 安全约束：
 * - 所有请求经同源检查（{@link sameOrigin}），跨源请求直接 403
 * - mutate 操作经 settings 服务的乐观锁（expectedRevision）保护，冲突时返回
 *   `{ ok: false, code: 'settings-conflict' }`，由前端重新拉取配置后重试
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { ROUTE_PREFIX } from '../constants.js';
import { BRIDGE_PREFIX } from './namespace.js';
import type { JsonPatchOp } from './patch.js';

/**
 * settings 服务的最小接口形状
 *
 * 独立插件无法 import 官方 `@deepseek-ai/dsh-settings` 包（它不在插件的
 * dependencies 里，而是 dsh 宿主提供的 peer 依赖），因此手工定义 settings
 * 服务的最小接口——只包含 bridge 路由需要的三个成员。运行期 cordis 注入的
 * settings 服务实例兼容此接口（鸭子类型）。
 */
export interface SettingsLike {
  /**
   * 列出所有 settings 条目的当前快照
   *
   * @param opts - 可选的描述选项
   * @returns settings 条目描述符数组（每个条目包含 ns/revision/config 等字段）
   */
  describe(opts?: { redactSecrets?: boolean }): SettingsDescriptor[];

  /**
   * 原子提交一批 JSON Patch 操作到指定命名空间
   *
   * @param ns - 命名空间（profile 条目 id）
   * @param ops - JSON Patch 操作数组
   * @param expectedRevision - 可选的乐观锁版本号（冲突时抛 SettingsConflictError）
   * @throws SettingsConflictError 乐观锁冲突（expectedRevision 不匹配当前 revision）
   */
  mutate(ns: string, ops: JsonPatchOp[], expectedRevision?: number): Promise<void>;

  /** settings 服务是否可写（只读模式下 mutate 直接拒绝） */
  readonly writable: boolean;
}

/**
 * settings 条目描述符（与官方 dsh-settings 形状对齐）
 *
 * describe() 返回值的数组元素类型——每个条目对应 profile patch 中的一个插件配置。
 * 官方形状用 `value` 而非 `config`，且 `writable` 由 settings 服务本身提供而非
 * descriptor 字段。
 */
export interface SettingsDescriptor {
  /** 命名空间（profile 条目 id） */
  ns: string;
  /** 当前修订版本号（乐观锁）——每次 mutate 成功后自增 */
  revision: number;
  /** 配置对象快照（所有字段的当前值）——官方字段名是 value */
  value: unknown;
  /** schema 定义（用于表单生成，bridge 不消费） */
  schema: unknown;
  /** 是否自动生成配置页（UI 控制，bridge 不消费） */
  autoGenerate: boolean;
}

/**
 * HTTP 路由配置对象
 *
 * webServer.register() 接受的路由配置形状——包含 kind（路由匹配模式）、
 * path（路由路径）、handler（异步请求处理函数）。
 */
interface RouteConfig {
  /** 路由匹配模式：exact（精确匹配）或 prefix（前缀匹配） */
  kind: 'exact' | 'prefix';
  /** 路由路径（拼接在插件主路由之后） */
  path: string;
  /** 异步请求处理函数 */
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

/**
 * 同源检查：拒绝跨源请求
 *
 * DSH webserver 无鉴权设计，至少不让另一个 origin 挂到会话上。
 * 非浏览器客户端（curl）不发 Origin——放行。
 *
 * @param req - HTTP 请求
 * @returns 同源或非浏览器客户端时 true
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * JSON 响应快捷构造
 *
 * 统一 settings bridge 路由的响应格式——所有响应都是 JSON（application/json），
 * body 是可序列化对象。
 *
 * @param res - HTTP 响应对象
 * @param status - HTTP 状态码
 * @param body - 可序列化对象（统一为 `{ ok, value?, code?, message? }` 形状）
 */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * 读取 POST 请求体并解析为 JSON 对象
 *
 * body 过大（>1MB）或非 JSON 时返回空对象，避免内存耗尽或解析错误导致路由崩溃。
 *
 * @param req - HTTP 请求
 * @returns 解析后的字段字典（解析失败返回空对象）
 */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    // 防止超大 body 耗尽内存
    if (chunks.reduce((sum, c) => sum + c.length, 0) > 1_000_000) return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 创建 settings bridge 路由配置
 *
 * 工厂函数——接收 settings 服务实例与命名空间，返回两个路由配置对象数组：
 * 1. GET  ${ROUTE_PREFIX}${BRIDGE_PREFIX}/describe → 返回插件配置快照
 * 2. POST ${ROUTE_PREFIX}${BRIDGE_PREFIX}/mutate   → 原子提交配置变更
 *
 * 两个路由都经同源检查（{@link sameOrigin}），跨源请求直接 403。mutate 路由
 * 捕获 `SettingsConflictError`（乐观锁冲突），返回 `{ ok: false, code:
 * 'settings-conflict' }`，由前端重新拉取配置后重试。
 *
 * @param settings - settings 服务实例（兼容 {@link SettingsLike} 接口）
 * @param namespace - 命名空间（profile 条目 id，如 'terminal-panel'）
 * @returns 两个路由配置对象数组（供 webServer.register() 注册）
 */
export function createSettingsBridgeRoutes(
  settings: SettingsLike,
  namespace: string,
): RouteConfig[] {
  return [
    // GET ${ROUTE_PREFIX}${BRIDGE_PREFIX}/describe — 返回插件配置快照
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}${BRIDGE_PREFIX}/describe`,
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        // 同源检查——跨源请求直接拒绝
        if (!sameOrigin(req)) {
          json(res, 403, { ok: false, code: 'cross-origin', message: '跨源请求被拒绝' });
          return;
        }

        // 只允许 GET 方法
        if (req.method !== 'GET') {
          json(res, 405, { ok: false, code: 'method-not-allowed', message: '只允许 GET 方法' });
          return;
        }

        try {
          // 从 settings.describe() 中找到本插件的条目（按 namespace 匹配）
          const descriptors = settings.describe({ redactSecrets: false });
          const descriptor = descriptors.find((d) => d.ns === namespace);

          if (descriptor === undefined) {
            json(res, 404, {
              ok: false,
              code: 'namespace-not-found',
              message: `命名空间 ${namespace} 不存在`,
            });
            return;
          }

          // 返回插件配置快照：namespace/revision/value/writable
          // descriptor.value 是配置对象（Record<string, unknown>）
          json(res, 200, {
            ok: true,
            value: {
              namespace: descriptor.ns,
              revision: descriptor.revision,
              value: descriptor.value,
              writable: settings.writable,
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          json(res, 500, { ok: false, code: 'internal-error', message: msg });
        }
      },
    },

    // POST ${ROUTE_PREFIX}${BRIDGE_PREFIX}/mutate — 原子提交配置变更
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}${BRIDGE_PREFIX}/mutate`,
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        // 同源检查——跨源请求直接拒绝
        if (!sameOrigin(req)) {
          json(res, 403, { ok: false, code: 'cross-origin', message: '跨源请求被拒绝' });
          return;
        }

        // 只允许 POST 方法
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, code: 'method-not-allowed', message: '只允许 POST 方法' });
          return;
        }

        try {
          // 读取请求体（ns/ops/expectedRevision）
          const body = await readBody(req);
          const ns = body.ns;
          const ops = body.ops;
          const expectedRevision = body.expectedRevision;

          // 校验 ns——必须匹配本插件的命名空间
          if (typeof ns !== 'string' || ns !== namespace) {
            json(res, 400, {
              ok: false,
              code: 'invalid-namespace',
              message: `命名空间必须是 ${namespace}`,
            });
            return;
          }

          // 校验 ops——必须是 JSON Patch 操作数组（形状校验由 patch.ts 的 validateOps 负责）
          if (!Array.isArray(ops)) {
            json(res, 400, {
              ok: false,
              code: 'invalid-ops',
              message: 'ops 必须是数组',
            });
            return;
          }

          // 校验 expectedRevision——可选，但如果提供必须是非负整数
          if (
            expectedRevision !== undefined &&
            (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0)
          ) {
            json(res, 400, {
              ok: false,
              code: 'invalid-revision',
              message: 'expectedRevision 必须是非负整数',
            });
            return;
          }

          // 调用 settings.mutate() 原子提交——乐观锁冲突时抛 SettingsConflictError
          await settings.mutate(ns, ops as JsonPatchOp[], expectedRevision);

          // 回读提交后的最新快照并返回——客户端 SAVE_SUCCESS 需要完整的
          // descriptor 来刷新表单值与 revision（只回 { ok: true } 会让客户端
          // 拿不到新 revision，下次保存必然撞乐观锁）
          const fresh = settings.describe({ redactSecrets: false }).find((d) => d.ns === namespace);
          if (fresh === undefined) {
            json(res, 500, {
              ok: false,
              code: 'internal-error',
              message: `提交成功但命名空间 ${namespace} 已不存在`,
            });
            return;
          }

          // 提交成功——返回与 describe 端点同形状的描述符
          json(res, 200, {
            ok: true,
            value: {
              namespace: fresh.ns,
              revision: fresh.revision,
              value: fresh.value,
              writable: settings.writable,
            },
          });
        } catch (error) {
          // 捕获 SettingsConflictError——乐观锁冲突，返回 409 Conflict
          // error.name === 'SettingsConflictError' 是官方错误类的标识符
          if (
            error instanceof Error &&
            error.name === 'SettingsConflictError'
          ) {
            const conflictError = error as SettingsConflictError;
            json(res, 409, {
              ok: false,
              code: 'settings-conflict',
              message: conflictError.message,
            });
            return;
          }

          // 其他错误——返回 500 Internal Server Error
          const msg = error instanceof Error ? error.message : String(error);
          json(res, 500, { ok: false, code: 'internal-error', message: msg });
        }
      },
    },
  ];
}
