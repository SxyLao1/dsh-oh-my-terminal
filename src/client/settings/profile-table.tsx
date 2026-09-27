/**
 * @file 终端配置表格组件
 * @description 终端配置表（TerminalProfile[]）的 CRUD UI，支持 inline 编辑、新增行、
 *              删除、origin 约束（auto 项不可删除/path 不可改，name 始终可改）。
 *
 *              表格设计：
 *              - 类型列：显示 kind 对应的 label（如 "PowerShell 7+"）
 *              - 名称列：inline 编辑（点击进入输入框）
 *              - 路径列：origin=auto 只读灰显，origin=user 可编辑
 *              - 来源列：徽章显示"自动"/"手动"
 *              - 操作列：编辑/删除按钮（auto 项删除按钮禁用）
 *              - 新增行：表格底部"+ 新增终端"按钮展开表单
 *
 *              数据流：
 *              - props.profiles 是解析后的 TerminalProfile[]
 *              - 编辑/新增/删除触发 props.onChange(newProfiles)
 *              - 父组件（card.tsx）负责序列化为 JSON 字符串并提交 settings
 *
 *              架构位置：浏览器半配置模块的表格子组件，被 card.tsx 引用。
 */

import * as React from 'react';
import type { ReactElement } from 'react';
import type { TerminalProfile, TerminalKind, TerminalKindOption } from './types.js';
import { fetchTerminalKinds } from './api.js';
import { createLogger } from '../../logger.js';

const log = createLogger('settings-table');

// —— 表格列宽定义 ——

/**
 * 表格列模板（grid-template-columns 值）。
 *
 * 路径列用固定宽度（300px）而非 1fr——长路径不会撑开布局把旁边列挤歪，
 * 超出部分在列内水平滚动。类型/名称/来源/操作列也固定宽度，保证各列
 * 比例稳定不受内容长度影响。
 */
const GRID_COLS = '140px 1fr 300px 80px 100px';

/** 路径列固定宽度（像素），与 GRID_COLS 中路径列一致 */
const PATH_COL_WIDTH = 300;

// —— Props 类型 ——

/** ProfileTable 组件的 props */
export interface ProfileTableProps {
  /** 终端配置数组（已从 JSON 字符串解析） */
  profiles: TerminalProfile[];
  /** 是否禁用（只读模式或保存中） */
  disabled: boolean;
  /** 配置变更回调（接收新的 profiles 数组） */
  onChange: (profiles: TerminalProfile[]) => void;
}

// —— 工具函数 ——

/**
 * 生成简短的终端配置 id（形如 `t-pwsh-a3f9`）。
 *
 * @param kind - 终端种类
 * @returns 配置 id
 */
function generateProfileId(kind: TerminalKind): string {
  const suffix = Math.random().toString(16).slice(2, 6).padStart(4, '0');
  return `t-${kind}-${suffix}`;
}

// —— 主组件 ——

/**
 * 终端配置表格组件。
 *
 * 显示所有终端配置项，支持 inline 编辑、新增、删除。auto 项不可删除、path 不可改，
 * 但 name 始终可编辑。新增行在表格底部，点击"+ 新增终端"展开表单。
 *
 * @param props - 组件 props
 * @returns 表格根元素
 */
export function ProfileTable(props: ProfileTableProps): ReactElement {
  const { profiles, disabled, onChange } = props;
  const { useState, useEffect } = React;

  /** 终端类型选项列表（从 API 拉取） */
  const [kindOptions, setKindOptions] = useState<TerminalKindOption[]>([]);
  /** 是否正在加载类型列表 */
  const [loadingKinds, setLoadingKinds] = useState(true);
  /** 是否显示新增表单 */
  const [showAddForm, setShowAddForm] = useState(false);

  /** 挂载时拉取类型列表 */
  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const kinds = await fetchTerminalKinds();
        setKindOptions(kinds);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error('拉取终端类型列表失败', msg);
        // 失败时保持空数组，新增按钮因 kindOptions.length === 0 而禁用
      } finally {
        setLoadingKinds(false);
      }
    })();
  }, []);

  /** 查找类型对应的显示标签 */
  const getKindLabel = (kind: TerminalKind): string => {
    const option = kindOptions.find(o => o.kind === kind);
    return option?.label ?? kind;
  };

  /** 改名回调 */
  const handleRename = (id: string, newName: string): void => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) return; // 空名称不提交
    const updated = profiles.map(p => (p.id === id ? { ...p, name: trimmed } : p));
    onChange(updated);
  };

  /** 修改路径回调 */
  const handleUpdatePath = (id: string, newPath: string): void => {
    const updated = profiles.map(p => (p.id === id ? { ...p, path: newPath.trim() } : p));
    onChange(updated);
  };

  /** 删除回调 */
  const handleDelete = (id: string): void => {
    const target = profiles.find(p => p.id === id);
    if (target === undefined) return;
    if (target.origin === 'auto') return; // auto 项不可删除，按钮应该禁用

    if (!confirm(`确定删除终端配置 "${target.name}"？`)) return;
    const updated = profiles.filter(p => p.id !== id);
    onChange(updated);
  };

  /** 新增回调 */
  const handleAdd = (type: TerminalKind, name: string, path: string): void => {
    const trimmedName = name.trim();
    const trimmedPath = path.trim();

    // 校验：name 非空
    if (trimmedName.length === 0) {
      alert('显示名不能为空');
      return;
    }

    // 校验：name 不重名
    if (profiles.some(p => p.name === trimmedName)) {
      alert(`显示名 "${trimmedName}" 已存在`);
      return;
    }

    // 校验：custom 必须填 path
    if (type === 'custom' && trimmedPath.length === 0) {
      alert('自定义类型必须填写可执行文件路径');
      return;
    }

    const newProfile: TerminalProfile = {
      id: generateProfileId(type),
      type,
      name: trimmedName,
      path: trimmedPath,
      origin: 'user',
    };

    onChange([...profiles, newProfile]);
    setShowAddForm(false); // 关闭新增表单
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 表格容器 */}
      <div
        style={{
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: '6px',
          overflow: 'hidden',
        }}
      >
        {/* 表头 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            gap: '12px',
            padding: '10px 12px',
            background: 'var(--dsw-alias-interactive-bg-hover)',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--dsw-alias-label-secondary)',
          }}
        >
          <div>类型</div>
          <div>名称</div>
          <div>路径</div>
          <div>来源</div>
          <div>操作</div>
        </div>

        {/* 表格主体 */}
        {profiles.length === 0 ? (
          <div
            style={{
              padding: '32px 12px',
              textAlign: 'center',
              fontSize: '13px',
              color: 'var(--dsw-alias-label-tertiary)',
            }}
          >
            暂无终端配置
          </div>
        ) : (
          profiles.map(profile => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              kindLabel={getKindLabel(profile.type)}
              disabled={disabled}
              onRename={handleRename}
              onUpdatePath={handleUpdatePath}
              onDelete={handleDelete}
            />
          ))
        )}

        {/* 新增表单（在表格内最后一行） */}
        {showAddForm && (
          <AddProfileForm
            kindOptions={kindOptions}
            disabled={disabled}
            onAdd={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>

      {/* 新增按钮（表格下方） */}
      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          disabled={disabled || loadingKinds || kindOptions.length === 0}
          style={{
            padding: '8px 12px',
            fontSize: '13px',
            fontWeight: 500,
            borderRadius: '6px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            cursor: disabled || loadingKinds ? 'not-allowed' : 'pointer',
            opacity: disabled || loadingKinds ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            alignSelf: 'flex-start',
          }}
        >
          <span>+</span>
          <span>{loadingKinds ? '加载中...' : '新增终端'}</span>
        </button>
      )}
    </div>
  );
}

// —— 子组件：表格行 ——

/** ProfileRow 的 props */
interface ProfileRowProps {
  /** 配置项 */
  profile: TerminalProfile;
  /** 类型显示标签 */
  kindLabel: string;
  /** 是否禁用 */
  disabled: boolean;
  /** 改名回调 */
  onRename: (id: string, newName: string) => void;
  /** 修改路径回调 */
  onUpdatePath: (id: string, newPath: string) => void;
  /** 删除回调 */
  onDelete: (id: string) => void;
}

/**
 * 配置表格行组件。
 *
 * 支持 inline 编辑：点击 name/path 字段进入输入框，失焦或回车提交。
 * origin=auto 的 path 字段只读灰显。
 *
 * @param props - 行 props
 * @returns 表格行元素
 */
function ProfileRow(props: ProfileRowProps): ReactElement {
  const { profile, kindLabel, disabled, onRename, onUpdatePath, onDelete } = props;
  const { useState } = React;

  /** name 编辑态 */
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(profile.name);

  /** path 编辑态 */
  const [editingPath, setEditingPath] = useState(false);
  const [pathValue, setPathValue] = useState(profile.path);

  /** 提交 name 修改 */
  const submitName = (): void => {
    setEditingName(false);
    if (nameValue.trim() !== profile.name) {
      onRename(profile.id, nameValue);
    } else {
      setNameValue(profile.name); // 恢复原值
    }
  };

  /** 提交 path 修改 */
  const submitPath = (): void => {
    setEditingPath(false);
    if (pathValue.trim() !== profile.path) {
      onUpdatePath(profile.id, pathValue);
    } else {
      setPathValue(profile.path); // 恢复原值
    }
  };

  const canEditPath = profile.origin === 'user';
  const canDelete = profile.origin === 'user';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_COLS,
        gap: '12px',
        padding: '10px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontSize: '13px',
        alignItems: 'center',
      }}
    >
      {/* 类型列 */}
      <div style={{ color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }}>
        {kindLabel}
      </div>

      {/* 名称列（inline 编辑） */}
      <div>
        {editingName ? (
          <input
            type="text"
            value={nameValue}
            disabled={disabled}
            autoFocus
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={submitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitName();
              if (e.key === 'Escape') {
                setNameValue(profile.name);
                setEditingName(false);
              }
            }}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-specific-tip)',
              color: 'var(--dsw-alias-label-primary)',
              outline: 'none',
            }}
          />
        ) : (
          <div
            onClick={() => !disabled && setEditingName(true)}
            style={{
              padding: '4px 8px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              borderRadius: '4px',
              color: 'var(--dsw-alias-label-primary)',
            }}
            title="点击编辑"
          >
            {profile.name}
          </div>
        )}
      </div>

      {/* 路径列（origin=auto 只读，origin=user 可编辑）
          固定宽度 + overflow:hidden 防止长路径撑开布局；显示态用
          overflow-x:auto 让长路径可水平滚动而不挤歪旁边的列 */}
      <div style={{ maxWidth: PATH_COL_WIDTH + 'px', overflow: 'hidden' }}>
        {canEditPath && editingPath ? (
          <input
            type="text"
            value={pathValue}
            disabled={disabled}
            autoFocus
            onChange={(e) => setPathValue(e.target.value)}
            onBlur={submitPath}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitPath();
              if (e.key === 'Escape') {
                setPathValue(profile.path);
                setEditingPath(false);
              }
            }}
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-specific-tip)',
              color: 'var(--dsw-alias-label-primary)',
              outline: 'none',
            }}
          />
        ) : (
          <div
            onClick={() => canEditPath && !disabled && setEditingPath(true)}
            style={{
              padding: '4px 8px',
              cursor: canEditPath && !disabled ? 'pointer' : 'default',
              borderRadius: '4px',
              color: canEditPath
                ? 'var(--dsw-alias-label-primary)'
                : 'var(--dsw-alias-label-tertiary)',
              fontFamily: 'monospace',
              fontSize: '12px',
              /* 水平滚动：长路径不换行，超出部分可拖动滚动条查看 */
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
            title={canEditPath ? '点击编辑' : '自动探测的路径不可修改'}
          >
            {profile.path || '（自动解析）'}
          </div>
        )}
      </div>

      {/* 来源列（徽章） */}
      <div>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '3px',
            background:
              profile.origin === 'auto'
                ? 'var(--dsw-semantic-primary-bg)'
                : 'var(--dsw-alias-interactive-bg-hover)',
            color:
              profile.origin === 'auto'
                ? 'var(--dsw-semantic-primary-text)'
                : 'var(--dsw-alias-label-secondary)',
          }}
        >
          {profile.origin === 'auto' ? '自动' : '手动'}
        </span>
      </div>

      {/* 操作列（删除按钮） */}
      <div>
        <button
          onClick={() => onDelete(profile.id)}
          disabled={disabled || !canDelete}
          style={{
            padding: '4px 12px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'transparent',
            color: canDelete
              ? 'var(--dsw-semantic-error-text)'
              : 'var(--dsw-alias-label-disabled)',
            cursor: disabled || !canDelete ? 'not-allowed' : 'pointer',
            opacity: disabled || !canDelete ? 0.6 : 1,
          }}
          title={canDelete ? '删除' : '自动探测的配置不可删除'}
        >
          删除
        </button>
      </div>
    </div>
  );
}

// —— 子组件：新增表单 ——

/** AddProfileForm 的 props */
interface AddProfileFormProps {
  /** 类型选项列表 */
  kindOptions: TerminalKindOption[];
  /** 是否禁用 */
  disabled: boolean;
  /** 新增回调 */
  onAdd: (type: TerminalKind, name: string, path: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 新增终端配置表单（在表格内最后一行）。
 *
 * @param props - 表单 props
 * @returns 表单行元素
 */
function AddProfileForm(props: AddProfileFormProps): ReactElement {
  const { kindOptions, disabled, onAdd, onCancel } = props;
  const { useState } = React;

  const [selectedType, setSelectedType] = useState<TerminalKind>(
    kindOptions[0]?.kind ?? 'pwsh',
  );
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  const handleSubmit = (): void => {
    onAdd(selectedType, name, path);
    // 重置表单
    setName('');
    setPath('');
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: GRID_COLS,
        gap: '12px',
        padding: '10px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        fontSize: '13px',
        alignItems: 'center',
      }}
    >
      {/* 类型下拉 */}
      <select
        value={selectedType}
        disabled={disabled}
        onChange={(e) => setSelectedType(e.target.value as TerminalKind)}
        style={{
          padding: '4px 8px',
          fontSize: '13px',
          borderRadius: '4px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-specific-tip)',
          color: 'var(--dsw-alias-label-primary)',
          outline: 'none',
        }}
      >
        {kindOptions.map(opt => (
          <option key={opt.kind} value={opt.kind}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* 名称输入 */}
      <input
        type="text"
        value={name}
        disabled={disabled}
        placeholder="显示名"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          padding: '4px 8px',
          fontSize: '13px',
          borderRadius: '4px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-specific-tip)',
          color: 'var(--dsw-alias-label-primary)',
          outline: 'none',
        }}
      />

      {/* 路径输入 */}
      <input
        type="text"
        value={path}
        disabled={disabled}
        placeholder="可执行文件路径（可选）"
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          padding: '4px 8px',
          fontSize: '13px',
          borderRadius: '4px',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-specific-tip)',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'monospace',
          outline: 'none',
        }}
      />

      {/* 来源占位（新增项始终是 user） */}
      <div />

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={handleSubmit}
          disabled={disabled}
          style={{
            padding: '4px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--dsw-semantic-primary-bg)',
            color: 'var(--dsw-semantic-primary-text)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          添加
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          style={{
            padding: '4px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}
