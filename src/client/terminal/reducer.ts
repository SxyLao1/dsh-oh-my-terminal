/**
 * @file 终端状态 reducer
 * @description 终端面板状态管理的纯函数 reducer，处理所有 TerminalAction。
 *              从 hooks.ts 抽取，包含 terminalReducer 函数、初始状态构造、reducer 辅助纯函数。
 *
 * 设计要点：
 * - REMOVE_INSTANCE：同时从 instances 和 groups 移除，空组整体移除，维护活跃位
 * - SPLIT_INSTANCE：插入到 afterInstanceId 之后（不是末尾），保持拆分位置直觉
 * - RESTART_INSTANCE：更新 instances 和 groups 中的引用，保留 title
 * - MARK_EXITED：同步更新 instances 和 groups 中的 exited 标记
 */

import type { TerminalState, TerminalAction } from '../types.js';

/** 终端状态初始值 */
const INITIAL_STATE: TerminalState = {
  instances: [],
  groups: [],
  activeInstanceId: null,
  busy: false,
  bootReady: false,
};

/**
 * 创建初始状态（导出供测试使用）
 *
 * @returns 初始终端状态
 */
export function createInitialState(): TerminalState {
  return INITIAL_STATE;
}

/**
 * 终端面板状态 reducer：纯函数处理所有 TerminalAction。
 *
 * 设计要点：
 * - REMOVE_INSTANCE：同时从 instances 和 groups 移除，空组整体移除，维护活跃位
 * - SPLIT_INSTANCE：插入到 afterInstanceId 之后（不是末尾），保持拆分位置直觉
 * - RESTART_INSTANCE：更新 instances 和 groups 中的引用，保留 title
 * - MARK_EXITED：同步更新 instances 和 groups 中的 exited 标记
 *
 * @param state - 当前状态
 * @param action - 要处理的 action
 * @returns 新状态（不可变更新）
 */
export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'RESTORE': {
      return {
        ...state,
        instances: action.instances,
        groups: action.groups,
        activeInstanceId: action.activeInstanceId,
      };
    }

    case 'SET_BUSY': {
      return { ...state, busy: action.busy };
    }

    case 'SET_BOOT_READY': {
      return { ...state, bootReady: true, busy: false };
    }

    case 'ADD_INSTANCE': {
      return {
        ...state,
        instances: [...state.instances, action.instance],
        groups: [...state.groups, action.group],
        activeInstanceId: action.instance.id,
      };
    }

    case 'SPLIT_INSTANCE': {
      // 1. 追加到全局实例列表
      const nextInstances = [...state.instances, action.instance];
      // 2. 在目标组内插入到 afterInstanceId 之后
      const nextGroups = state.groups.map(g => {
        if (g.id !== action.groupId) return g;
        const idx = g.instances.findIndex(i => i.id === action.afterInstanceId);
        const newGroupInstances = [...g.instances];
        newGroupInstances.splice(idx + 1, 0, action.instance);
        return {
          ...g,
          instances: newGroupInstances,
          activeInstanceId: action.instance.id,
        };
      });
      return {
        ...state,
        instances: nextInstances,
        groups: nextGroups,
        activeInstanceId: action.instance.id,
      };
    }

    case 'REMOVE_INSTANCE': {
      const id = action.id;
      // 1. 从全局实例列表中移除，计算新的全局活跃位
      const curIdx = state.instances.findIndex(t => t.id === id);
      const nextInstances = state.instances.filter(t => t.id !== id);
      let nextActiveId = state.activeInstanceId;
      if (nextActiveId === id) {
        if (nextInstances.length === 0) {
          nextActiveId = null;
        } else {
          nextActiveId = (nextInstances[Math.min(curIdx, nextInstances.length - 1)] ?? nextInstances[0]).id;
        }
      }
      // 2. 从 groups 中移除实例，空组整体移除，维护组内活跃位
      const nextGroups: typeof state.groups = [];
      for (const g of state.groups) {
        const filtered = g.instances.filter(t => t.id !== id);
        if (filtered.length === 0) continue; // 空组移除
        if (filtered.length === g.instances.length) {
          // 该组不含目标实例，保持不变
          nextGroups.push(g);
        } else {
          // 组内含目标实例，更新组内活跃位
          let groupActiveId = g.activeInstanceId;
          if (groupActiveId === id) {
            const removedIdx = g.instances.findIndex(t => t.id === id);
            groupActiveId = (filtered[Math.min(removedIdx, filtered.length - 1)] ?? filtered[0]).id;
          }
          nextGroups.push({ ...g, instances: filtered, activeInstanceId: groupActiveId });
        }
      }
      return {
        ...state,
        instances: nextInstances,
        groups: nextGroups,
        activeInstanceId: nextActiveId,
      };
    }

    case 'RESTART_INSTANCE': {
      const { oldId, newInstance } = action;
      // 1. 更新全局实例列表中的引用
      const nextInstances = state.instances.map(t => (t.id === oldId ? newInstance : t));
      // 2. 更新 groups 中该实例的引用及组内活跃位
      const nextGroups = state.groups.map(g => ({
        ...g,
        instances: g.instances.map(t => (t.id === oldId ? newInstance : t)),
        activeInstanceId: g.activeInstanceId === oldId ? newInstance.id : g.activeInstanceId,
      }));
      return {
        ...state,
        instances: nextInstances,
        groups: nextGroups,
        activeInstanceId: state.activeInstanceId === oldId ? newInstance.id : state.activeInstanceId,
      };
    }

    case 'MARK_EXITED': {
      const id = action.id;
      return {
        ...state,
        instances: state.instances.map(t => (t.id === id ? { ...t, exited: true } : t)),
        groups: state.groups.map(g => ({
          ...g,
          instances: g.instances.map(t => (t.id === id ? { ...t, exited: true } : t)),
        })),
      };
    }

    case 'SET_ACTIVE': {
      const id = action.id;
      // 同时更新全局活跃位和所在组的组内活跃位
      const nextGroups = state.groups.map(g => {
        if (g.instances.some(i => i.id === id)) {
          return { ...g, activeInstanceId: id };
        }
        return g;
      });
      return {
        ...state,
        activeInstanceId: id,
        groups: nextGroups,
      };
    }

    case 'RENAME_INSTANCE': {
      const { id, title } = action;
      return {
        ...state,
        instances: state.instances.map(t => (t.id === id ? { ...t, title } : t)),
        groups: state.groups.map(g => ({
          ...g,
          instances: g.instances.map(t => (t.id === id ? { ...t, title } : t)),
        })),
      };
    }

    default: {
      // 穷尽检查：确保所有 action 类型都已处理
      const _exhaustive: never = action;
      return state;
    }
  }
}
