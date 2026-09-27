/**
 * @file 配置模块类型定义
 * @description 定义终端配置项的数据结构、Settings Bridge 的配置描述符、保存结果类型、
 *              冲突状态以及 JSON Patch 操作类型（RFC 6902）。所有跨模块共享的配置
 *              相关类型从此文件导出，其他模块经 `import type` 引用。
 *
 *              本文件只包含纯类型定义，不含任何运行时逻辑、常量或函数。
 */

// —— 终端配置项值 ——

/**
 * 终端配置项值——与宿主半 Config 接口对齐。
 *
 * terminalProfiles 在宿主半的 schema 里是 JSON 字符串（schemastery 对对象数组
 * 的 round-trip 不保证），此处仍按字符串承载，由表格组件负责序列化/反序列化。
 */
export interface TerminalSettingsValues {
  /** 切换快捷键（如 "ctrl+`"） */
  toggleShortcut: string;
  /** 终端字体族（CSS font-family 串） */
  fontFamily: string;
  /** 终端字号（像素） */
  fontSize: number;
  /** 终端行高倍数 */
  lineHeight: number;
  /** 终端配置表（JSON 字符串，序列化的 TerminalProfile[]） */
  terminalProfiles: string;
}

// —— Settings Bridge 配置描述符 ——

/** Settings Bridge 的配置描述符（GET /describe 响应体） */
export interface SettingsDescriptor {
  /** 配置命名空间（如 "terminal-panel"） */
  namespace: string;
  /** 当前配置版本号（乐观锁，保存时必须匹配） */
  revision: number;
  /** 配置值对象 */
  value: TerminalSettingsValues;
  /** 是否可写（只读模式下禁用保存按钮） */
  writable: boolean;
}

// —— JSON Patch 操作类型 ——

/**
 * settings mutate 的操作形状（与宿主半 `src/settings/patch.ts` 的 JsonPatchOp 对齐）。
 *
 * DSH settings 系统只接受 `set` 操作，path 用字符串数组寻址；本插件配置是扁平
 * 对象，路径恒为单元素数组（如 `['fontSize']`）。
 */
export interface JsonPatchOp {
  /** 操作类型（DSH settings 只支持 set） */
  op: 'set';
  /** 字段路径（字符串数组；扁平配置恒为单元素） */
  path: string[];
  /** 新值（JSON-serializable） */
  value: unknown;
}

// —— 保存结果 ——

/** 保存配置的结果（POST /mutate 响应体） */
export type SaveResult =
  | { ok: true; value: SettingsDescriptor }
  | { ok: false; code: string; message: string };

// —— 冲突状态 ——

/** 版本冲突状态——当配置被其他页面修改时触发 */
export interface ConflictState {
  /** 是否存在冲突 */
  isConflict: boolean;
  /** 冲突提示消息（仅在 isConflict 为 true 时存在） */
  message?: string;
}
