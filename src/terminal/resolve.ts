/**
 * @file 终端配置解析为 spawn 参数
 * @description 将 TerminalProfile（type/name/path）解析为 node-pty spawn 的
 *              { file, args }。path 留空时按 type 在 $PATH 中解析（Windows 用 where）。
 *
 *              Windows 特殊处理：node-pty 不做 PATH 查找，必须给完整路径；同时
 *              过滤 WindowsApps 占位符（0 字节重解析点）。
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { TerminalProfile } from './detect.js';
import { getBinaryName, getInteractiveArgs } from './kinds.js';

/** spawn 参数：node-pty spawn(file, args, opts) 的 file 和 args */
export interface SpawnArgs {
  /** 可执行文件路径 */
  file: string;
  /** 命令行参数（不含 file 本身） */
  args: string[];
}

/**
 * 用 `where`（Windows）或 `which`（POSIX）在 PATH 中解析命令。
 *
 * Windows 特殊过滤：跳过 WindowsApps 下的 App Execution Alias 占位符——
 * 那些是 0 字节重解析点，spawn 时会失败。
 *
 * @param command - 裸命令名（如 'pwsh.exe'、'bash'）
 * @returns 可执行文件绝对路径；未找到或无有效候选时 null
 */
function resolveCommand(command: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 3000 });
    const candidates = out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Windows：跳过 WindowsApps 占位符
    const filtered = process.platform === 'win32'
      ? candidates.filter(line => !/[\\/]WindowsApps[\\/]/i.test(line))
      : candidates;

    for (const candidate of filtered) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  } catch {
    /* 命令不存在或 where/which 失败 */
    return null;
  }
}

/**
 * 将 TerminalProfile 解析为 spawn 参数。
 *
 * 解析逻辑：
 * 1. path 非空 → 直接用 path 作为 file（用户填的完整路径或已探测的路径）
 * 2. path 空 + type = custom → 报错（custom 必须填 path）
 * 3. path 空 + 其他 type → 按 type 查 kinds 表的 binary，在 PATH 中解析
 * 4. args 从 kinds 表按 type + 平台取交互参数
 *
 * @param profile - 终端配置项
 * @returns spawn 参数；path 空且无法解析时 null
 * @throws 当 type = custom 且 path 空时抛错
 */
export function resolveProfile(profile: TerminalProfile): SpawnArgs | null {
  let file: string;

  if (profile.path.length > 0) {
    // path 已填，直接用（探测时已填完整路径，或用户手填）
    file = profile.path;
  } else {
    // path 空，按 type 自动补全
    if (profile.type === 'custom') {
      throw new Error(`Profile "${profile.name}" (type=custom) 必须填写 path 字段`);
    }
    const binary = getBinaryName(profile.type);
    if (binary === null) {
      // 当前平台不支持此 type（如 Linux 上的 cmd）
      return null;
    }
    const resolved = resolveCommand(binary);
    if (resolved === null) {
      // PATH 中找不到（如用户配了 pwsh 但没装）
      return null;
    }
    file = resolved;
  }

  // 从 kinds 表取交互参数
  const args = getInteractiveArgs(profile.type);

  return { file, args };
}
