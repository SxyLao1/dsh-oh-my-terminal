/**
 * @file 终端种类自动探测
 * @description 启动时按 KIND_SPECS 在 $PATH 中探测可用终端，产出配置表的默认值。
 *              探测逻辑封装 Windows `where` 与 POSIX `which`，过滤 WindowsApps 占位符。
 *
 *              Git Bash 特殊处理：Windows 上从 git.exe 位置推导 bash.exe 路径，
 *              避免与 WSL bash / Cygwin bash 混淆。
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TerminalKind } from './kinds.js';
import { KIND_SPECS, getKindSpec } from './kinds.js';

/** 一个终端种类的配置项（配置表的行） */
export interface TerminalProfile {
  /** 稳定标识（UUID，生成后不变） */
  id: string;
  /** 终端类型 */
  type: TerminalKind;
  /** 显示名（用户可改） */
  name: string;
  /** 可执行文件路径（探测时填完整路径） */
  path: string;
  /** 来源：auto = 启动时探测，user = 用户手动新增 */
  origin: 'auto' | 'user';
}

/**
 * 用 `where`（Windows）或 `which`（POSIX）在 PATH 中解析命令。
 *
 * Windows 特殊过滤：跳过 WindowsApps 下的 App Execution Alias 占位符——
 * 那些是 0 字节重解析点，spawn 时会失败。
 *
 * 导出供 platform.ts 的默认 shell 探测复用，避免同一段 where/which 逻辑存在两份。
 *
 * @param command - 裸命令名（如 'pwsh'、'bash'）
 * @returns 可执行文件绝对路径；未找到或无有效候选时 null
 */
export function resolveCommand(command: string): string | null {
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
 * 探测 Git Bash 的 bash.exe 路径（Windows 专用）。
 *
 * 从 git.exe 的安装位置推断：git.exe 通常在 <GitRoot>/cmd/git.exe，
 * bash.exe 在 <GitRoot>/bin/bash.exe。找不到时返回 null。
 *
 * @returns bash.exe 绝对路径；未安装 Git 时 null
 */
export function detectGitBash(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const gitPath = execSync('where git', { encoding: 'utf8', timeout: 3000 })
      .trim()
      .split(/\r?\n/)[0];
    if (typeof gitPath !== 'string' || gitPath.length === 0) return null;
    // git.exe 在 <GitRoot>/cmd/git.exe → bash.exe 在 <GitRoot>/bin/bash.exe
    const gitDir = dirname(dirname(gitPath));
    const bashPath = join(gitDir, 'bin', 'bash.exe');
    return existsSync(bashPath) ? bashPath : null;
  } catch {
    return null;
  }
}

/**
 * 生成一个简短的终端配置 id（形如 `t-pwsh-a1b2`）。
 *
 * 格式：`t-<kind>-<4位随机十六进制>`。不用完整 UUID 以节省配置文件长度，
 * 4 位随机后缀足够区分同种类的多个配置（如两个不同路径的 bash）。
 *
 * @param kind - 终端种类
 * @returns 配置 id
 */
function generateProfileId(kind: TerminalKind): string {
  const suffix = Math.random().toString(16).slice(2, 6).padStart(4, '0');
  return `t-${kind}-${suffix}`;
}

/**
 * 探测当前平台的可用终端，产出配置表的默认值。
 *
 * 探测逻辑：
 * 1. 遍历 KIND_SPECS，跳过 custom（不探测）和当前平台不支持的种类（binary = null）
 * 2. gitbash 在 Windows 上特殊处理：从 git.exe 位置推导 bash.exe 路径
 * 3. 其他种类用 resolveCommand 在 PATH 中查找
 * 4. 找到的终端生成 TerminalProfile，origin = 'auto'，name = spec.label
 *
 * @returns 探测到的终端配置数组（按 KIND_SPECS 顺序）
 */
export function detectTerminalProfiles(): TerminalProfile[] {
  const profiles: TerminalProfile[] = [];

  for (const spec of KIND_SPECS) {
    // custom 不探测，用户手填
    if (spec.kind === 'custom') continue;

    const binary = process.platform === 'win32' ? spec.win32Binary : spec.posixBinary;
    // 当前平台不支持此种类
    if (binary === null) continue;

    let path: string | null = null;

    // Git Bash 特殊处理（Windows 专用）
    if (spec.kind === 'gitbash' && process.platform === 'win32') {
      path = detectGitBash();
    } else {
      path = resolveCommand(binary);
    }

    if (path !== null) {
      profiles.push({
        id: generateProfileId(spec.kind),
        type: spec.kind,
        name: spec.label,
        path,
        origin: 'auto',
      });
    }
  }

  return profiles;
}
