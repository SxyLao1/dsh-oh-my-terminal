/**
 * @file JSON Patch 操作类型与构造函数
 * @description 定义 DSH settings mutate API 所需的 JSON Patch 操作形状，
 *              提供纯函数用于构造单字段/批量 set 操作与校验 ops 数组格式。
 *
 *              DSH settings 系统接受简化版 JSON Patch 操作（只支持 `op: 'set'`），
 *              本模块不引入完整的 JSON Patch 库（如 fast-json-patch），而是
 *              手工构造最小形状——保持零额外依赖（type_script_style.md §七.3）。
 *
 * 操作形状：
 * ```typescript
 * { op: 'set', path: ['fieldName'], value: unknown }
 * ```
 *
 * path 是字符串数组——DSH settings 的 mutate API 接受数组形式路径（支持嵌套
 * 字段寻址），本插件配置是扁平对象，所有 path 都是单元素数组 `['fieldName']`。
 */

/**
 * JSON Patch 操作（DSH settings mutate API 的最小形状）
 *
 * 只定义 `set` 操作——DSH settings 系统目前只支持 set（替换字段值），
 * 不支持 add/remove/replace/move/copy/test 等完整 JSON Patch 操作。
 */
export interface JsonPatchOp {
  /** 操作类型（目前只支持 set） */
  op: 'set';
  /** 字段路径（字符串数组，支持嵌套寻址；本插件配置扁平，所有路径都是单元素数组） */
  path: string[];
  /** 新值（any JSON-serializable value） */
  value: unknown;
}

/**
 * 构造单字段 set 操作
 *
 * 将字段名与新值包装为 DSH settings mutate API 接受的 JSON Patch 操作对象。
 * path 固定为单元素数组——本插件配置是扁平对象，无嵌套字段。
 *
 * @param field - 字段名（如 'toggleShortcut'）
 * @param value - 新值（JSON-serializable）
 * @returns JSON Patch set 操作
 */
export function buildSetOp(field: string, value: unknown): JsonPatchOp {
  return { op: 'set', path: [field], value };
}

/**
 * 批量构造 set 操作
 *
 * 将字段字典（field -> value）转为 JSON Patch 操作数组。每个字段独立构造一个
 * set 操作——DSH settings mutate API 接受多个操作的原子提交（全成功或全失败），
 * 前端可以一次性提交多个字段的变更。
 *
 * @param changes - 字段字典（key = 字段名，value = 新值）
 * @returns JSON Patch set 操作数组
 */
export function buildSetOps(changes: Record<string, unknown>): JsonPatchOp[] {
  return Object.entries(changes).map(([field, value]) => buildSetOp(field, value));
}

/**
 * 校验 ops 数组格式
 *
 * 检查输入是否是合法的 JSON Patch 操作数组（TypeScript 类型守卫）。校验规则：
 * 1. 输入必须是数组
 * 2. 数组的每个元素必须是对象
 * 3. 每个对象必须有 `op`、`path`、`value` 三个字段
 * 4. `op` 必须是字符串 'set'
 * 5. `path` 必须是非空字符串数组
 *
 * 本函数只做形状校验（运行时类型检查），不做语义校验（如字段是否在白名单内、
 * 值类型是否匹配 schema）——语义校验由调用方（bridge 路由层）负责。
 *
 * @param ops - 待校验的输入
 * @returns 类型守卫——true 时 TypeScript 将 ops 窄化为 JsonPatchOp[]
 */
export function validateOps(ops: unknown): ops is JsonPatchOp[] {
  // 1. 必须是数组
  if (!Array.isArray(ops)) return false;

  // 2. 数组的每个元素必须是合法 JSON Patch 操作
  for (const item of ops) {
    // 2.1 必须是对象（非 null）
    if (typeof item !== 'object' || item === null) return false;

    const obj = item as Record<string, unknown>;

    // 2.2 必须有 op 字段且值为 'set'
    if (obj.op !== 'set') return false;

    // 2.3 必须有 path 字段且值为非空字符串数组
    if (!Array.isArray(obj.path) || obj.path.length === 0) return false;
    if (!obj.path.every((seg) => typeof seg === 'string')) return false;

    // 2.4 必须有 value 字段（值可以是任意 JSON-serializable，不做类型检查）
    if (!('value' in obj)) return false;
  }

  return true;
}
