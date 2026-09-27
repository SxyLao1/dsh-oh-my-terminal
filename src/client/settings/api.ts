/**
 * @file Settings Bridge HTTP 客户端模块
 * @description 封装与宿主半 Settings Bridge 的所有 HTTP 交互。浏览器半的配置表单
 *              通过本模块读写终端配置，不直接调用 fetch。
 *
 *              架构位置：浏览器半配置模块的最底层，被 store.ts 与 card.tsx 间接依赖。
 *              本模块只做 I/O，不含任何状态管理或 UI 逻辑——保持纯粹的数据边界。
 *
 * 协议契约：
 * - GET  ${BRIDGE_BASE}/describe          → SettingsDescriptor
 * - POST ${BRIDGE_BASE}/mutate            → SaveResult
 *
 * 安全与兼容约束：
 * - 所有请求带 `credentials: 'same-origin'`——桥接端点只在同源已鉴权通道下暴露，
 *   跨源请求不应携带凭据，交由同源策略拦截
 * - 网络失败不抛出异常，统一归一化为 `{ ok: false, code: 'network' }`，
 *   让调用方（reducer）用同一条错误路径处理所有失败形态
 * - 宿主半返回的错误体若可解析（含 code/message 字段）则透传，
 *   否则用状态码兜底，保证 message 始终是中文可读文案
 */

import type { SettingsDescriptor, JsonPatchOp, SaveResult } from './types.js';

// —— 常量 ——

/** Settings Bridge 端点基础路径（与宿主半路由注册同源） */
export const BRIDGE_BASE = '/api/dsh-oh-my-terminal/settings';

// —— 内部辅助 ——

/** 允许解析 JSON 的响应类型守卫——非 JSON 响应体（如网关 HTML 错误页）直接跳过 */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    /* 响应体不是合法 JSON（常见于反向代理返回的 HTML 错误页）——
       交由调用方用状态码兜底，此处静默降级不抛出 */
    return null;
  }
}

/**
 * 从宿主半的错误响应体中提取错误码与消息。
 *
 * 桥接端点正常返回 `{ code, message }` 形状；若响应体不符合预期形状
 * （代理拦截、路由未注册等），退化为状态码文案。
 *
 * @param body - 已解析的响应体（可能为 null）
 * @param status - HTTP 状态码
 * @returns 归一化后的错误码与中文消息
 */
function normalizeError(body: unknown, status: number): { code: string; message: string } {
  if (body !== null && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    const code = typeof rec.code === 'string' ? rec.code : 'http-' + status;
    const message = typeof rec.message === 'string' ? rec.message : '配置请求失败（HTTP ' + status + '）';
    return { code, message };
  }
  return { code: 'http-' + status, message: '配置请求失败（HTTP ' + status + '）' };
}

/**
 * 归一化网络异常为 SaveResult 失败形态。
 *
 * fetch 在网络中断、DNS 失败、CORS 拦截时 reject。此处把任意异常
 * 收敛成同一种错误码，避免调用方分别处理 'network' 与宿主半业务错误。
 *
 * @param error - 捕获到的异常（未知类型）
 * @returns 失败形态的 SaveResult
 */
function networkFailure(error: unknown): SaveResult {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, code: 'network', message: '无法连接配置服务：' + detail };
}

// —— 公开 API ——

/**
 * 拉取当前终端配置描述符。
 *
 * 对应 GET `${BRIDGE_BASE}/describe`。该端点返回配置值、当前 revision
 * （乐观锁版本号）与 writable 标志，表单据此渲染与决定是否允许保存。
 *
 * @returns 配置描述符
 * @throws Error 网络失败或宿主半返回非 2xx 状态时抛出，消息为中文可读文案
 */
export async function fetchSettings(): Promise<SettingsDescriptor> {
  const res = await fetch(BRIDGE_BASE + '/describe', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await readJson(res);
    const { message } = normalizeError(body, res.status);
    throw new Error(message);
  }

  const body = await res.json();
  // 宿主返回 { ok: true, value: SettingsDescriptor }，取出内层 value
  if (body && typeof body === 'object' && 'ok' in body && body.ok === true && 'value' in body) {
    return body.value as SettingsDescriptor;
  }
  throw new Error('配置服务返回了无法识别的响应格式');

}

/**
 * 提交配置变更（JSON Patch 操作序列）。
 *
 * 对应 POST `${BRIDGE_BASE}/mutate`。请求体携带命名空间、revision 与操作数组，
 * 宿主半以 revision 做乐观锁校验——revision 不匹配时返回
 * `{ ok: false, code: 'settings-conflict' }`，表单据此提示用户刷新。
 *
 * @param ns - 配置命名空间
 * @param ops - JSON Patch 操作数组（RFC 6902）
 * @param revision - 期望的当前版本号（乐观锁，必须与加载时的 revision 一致）
 * @returns 保存结果；网络异常也会归一化为失败形态，不抛出
 */
export async function saveSettings(
  ns: string,
  ops: JsonPatchOp[],
  revision: number,
): Promise<SaveResult> {
  try {
    const res = await fetch(BRIDGE_BASE + '/mutate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ ns, ops, expectedRevision: revision }),
    });

    const body = await readJson(res);

    /* 宿主半在业务失败（如版本冲突）时也可能返回 200 + ok:false，
       故先看响应体形状，再看状态码 */
    if (body !== null && typeof body === 'object' && 'ok' in body) {
      return body as SaveResult;
    }

    if (!res.ok) {
      const { code, message } = normalizeError(body, res.status);
      return { ok: false, code, message };
    }

    /* 2xx 但响应体形状不符——视为协议错误，属可恢复异常 */
    return { ok: false, code: 'protocol', message: '配置服务返回了无法识别的响应' };
  } catch (error: unknown) {
    return networkFailure(error);
  }
}
