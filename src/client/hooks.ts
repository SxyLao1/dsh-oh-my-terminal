/**
 * @file 终端面板自定义 Hooks（兼容壳）
 * @description 本文件为兼容壳，实际实现已拆分到 terminal/ 子目录。
 *              所有导出从 terminal/ 子模块 re-export，保持对外接口不变。
 *
 * 拆分后的模块结构：
 * - terminal/reducer.ts：terminalReducer + createInitialState
 * - terminal/use-terminal-state.ts：useTerminalState（状态管理 + 启动恢复）
 * - terminal/use-panel-geometry.ts：usePanelGeometry + usePanelHeight（几何测量 + 拖拽调高）
 * - terminal/use-tabs.ts：useTerminalTabs + useConfig（终端 CRUD + 配置拉取）
 */

export { terminalReducer, createInitialState } from './terminal/reducer.js';
export { useTerminalState } from './terminal/use-terminal-state.js';
export { usePanelGeometry, usePanelHeight } from './terminal/use-panel-geometry.js';
export { useTerminalTabs, useConfig } from './terminal/use-tabs.js';

export type { TerminalStateResult } from './terminal/use-terminal-state.js';
export type { PanelGeometry, PanelHeight } from './terminal/use-panel-geometry.js';
export type { ConfigResult, TerminalTabsParams, TerminalTabs } from './terminal/use-tabs.js';
