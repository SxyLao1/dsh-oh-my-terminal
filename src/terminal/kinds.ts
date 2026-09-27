/**
 * @file 终端种类定义与平台映射表
 * @description 定义支持的终端类型（pwsh/cmd/bash/zsh 等）及其在不同平台上的
 *              二进制名称、交互参数、可用性。业务代码查表得到平台语义，新增
 *              终端种类只需在此文件加条目。
 *
 *              模块纯数据 + 查表函数，不含 IO、不碰 child_process。
 */

/** 支持的终端种类（下拉菜单选项） */
export type TerminalKind =
  | 'pwsh'
  | 'powershell'
  | 'cmd'
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'gitbash'
  | 'nushell'
  | 'custom';

/** 一个终端种类在特定平台上的规格 */
interface KindSpec {
  /** 种类 id */
  kind: TerminalKind;
  /** 显示标签 */
  label: string;
  /** Windows 上的二进制名（供 `where` 解析；null = 此种类在 Windows 不可用） */
  win32Binary: string | null;
  /** POSIX 上的二进制名（供 `which` 解析；null = 此种类在 POSIX 不可用） */
  posixBinary: string | null;
  /** Windows 上的交互参数（spawn args；空数组 = 无需额外参数） */
  win32Args: string[];
  /** POSIX 上的交互参数（spawn args；空数组 = 无需额外参数） */
  posixArgs: string[];
}

/**
 * 终端种类映射表——每个 TerminalKind 在 Windows/POSIX 上的二进制名与交互参数。
 *
 * 新增终端种类只需在此数组加条目。binary 为 null 表示该种类在对应平台不可用
 * （如 cmd 只在 Windows、zsh 只在 POSIX）。
 */
export const KIND_SPECS: readonly KindSpec[] = [
  {
    kind: 'pwsh',
    label: 'PowerShell 7+',
    win32Binary: 'pwsh.exe',
    posixBinary: 'pwsh',
    win32Args: [],
    posixArgs: ['-l'],
  },
  {
    kind: 'powershell',
    label: 'Windows PowerShell',
    win32Binary: 'powershell.exe',
    posixBinary: null, // Windows PowerShell 不在 POSIX 上发行
    win32Args: [],
    posixArgs: [],
  },
  {
    kind: 'cmd',
    label: 'Command Prompt',
    win32Binary: 'cmd.exe',
    posixBinary: null,
    win32Args: [],
    posixArgs: [],
  },
  {
    kind: 'bash',
    label: 'Bash',
    win32Binary: 'bash.exe', // WSL/Git Bash/Cygwin
    posixBinary: 'bash',
    win32Args: [],
    posixArgs: ['-l'],
  },
  {
    kind: 'zsh',
    label: 'Zsh',
    win32Binary: null, // Windows 上几乎不装 Zsh
    posixBinary: 'zsh',
    win32Args: [],
    posixArgs: ['-l'],
  },
  {
    kind: 'fish',
    label: 'Fish',
    win32Binary: null,
    posixBinary: 'fish',
    win32Args: [],
    posixArgs: ['-l'],
  },
  {
    kind: 'gitbash',
    label: 'Git Bash',
    win32Binary: 'bash.exe', // Git for Windows 的 bash
    posixBinary: null, // Git Bash 是 Windows 专属
    win32Args: ['-l'],
    posixArgs: [],
  },
  {
    kind: 'nushell',
    label: 'Nushell',
    win32Binary: 'nu.exe',
    posixBinary: 'nu',
    win32Args: [],
    posixArgs: [],
  },
  {
    kind: 'custom',
    label: '自定义',
    win32Binary: null, // custom 不探测，用户手填 path
    posixBinary: null,
    win32Args: [],
    posixArgs: [],
  },
];

/**
 * 供配置表单下拉菜单使用的终端类型选项（kind + 显示标签）。
 *
 * 只含 kind 与 label——平台相关的二进制名与参数留在本模块内部，不跨进程下发。
 * custom 排在最后（它是兜底选项，不是常用项）。
 *
 * @returns 类型选项数组（顺序与 KIND_SPECS 一致，custom 除外）
 */
export function getKindOptions(): { kind: TerminalKind; label: string }[] {
  return KIND_SPECS
    .filter(spec => spec.kind !== 'custom')
    .map(spec => ({ kind: spec.kind, label: spec.label }))
    .concat([{ kind: 'custom' as TerminalKind, label: '自定义' }]);
}

/**
 * 按 kind 查规格。
 *
 * @param kind - 终端种类
 * @returns 规格对象；kind 无效时 undefined
 */
export function getKindSpec(kind: TerminalKind): KindSpec | undefined {
  return KIND_SPECS.find(s => s.kind === kind);
}

/**
 * 判断某 kind 在当前平台是否可探测（binary 非 null）。
 *
 * @param kind - 终端种类
 * @returns true = 可探测；false = 当前平台不支持或 kind 无效
 */
export function isDetectableOnPlatform(kind: TerminalKind): boolean {
  const spec = getKindSpec(kind);
  if (spec === undefined) return false;
  const binary = process.platform === 'win32' ? spec.win32Binary : spec.posixBinary;
  return binary !== null;
}

/**
 * 取当前平台的二进制名（用于 path 留空时自动补全）。
 *
 * @param kind - 终端种类
 * @returns 二进制名；kind 无效或当前平台不支持时 null
 */
export function getBinaryName(kind: TerminalKind): string | null {
  const spec = getKindSpec(kind);
  if (spec === undefined) return null;
  return process.platform === 'win32' ? spec.win32Binary : spec.posixBinary;
}

/**
 * 取当前平台的交互参数（spawn 的 args）。
 *
 * @param kind - 终端种类
 * @returns 参数数组；kind 无效或当前平台不支持时空数组
 */
export function getInteractiveArgs(kind: TerminalKind): string[] {
  const spec = getKindSpec(kind);
  if (spec === undefined) return [];
  return process.platform === 'win32' ? spec.win32Args : spec.posixArgs;
}
