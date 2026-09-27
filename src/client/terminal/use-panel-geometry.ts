/**
 * @file 面板几何与高度管理
 * @description 面板几何与高度管理 Hooks：拖拽调高 + localStorage 持久化 + 对话列几何测量。
 *              从 hooks.ts 抽取 usePanelGeometry 和 usePanelHeight。
 *
 * usePanelHeight：面板高度拖拽调节 + localStorage 持久化。初值从 localStorage 恢复，
 * 拖拽在 MIN_HEIGHT～MAX_HEIGHT_RATIO 视口高之间夹取，松手时写回 localStorage。
 *
 * usePanelGeometry：对话列几何测量，面板宽度对齐对话列，并向滚动容器注入 paddingBottom。
 * 终端 bar/panel 固定在视口底部；对话滚动容器获得等于面板高度的 paddingBottom，
 * 使 composer 座位与上方 dock 条目整体上移，不被 fixed 终端面板遮挡。
 */

import * as React from 'react';
import type { ConversationGeo } from '../types.js';

/** 面板高度在 localStorage 里的键名 */
const HEIGHT_KEY = 'dsh-oh-my-terminal.height';

/** 面板最小高度（像素） */
const MIN_HEIGHT = 120;

/** 面板最大高度占视口的百分比（拖拽上限） */
const MAX_HEIGHT_RATIO = 0.78;

/** 默认面板高度占视口的百分比（首次无 localStorage 时） */
const DEFAULT_HEIGHT_RATIO = 0.36;

/** usePanelHeight 返回值 */
export interface PanelHeight {
  /** 当前面板高度（像素） */
  height: number;
  /** 高度 ref（拖拽回调内读最新值，避免闭包陈旧） */
  heightRef: React.MutableRefObject<number>;
  /** 拖拽 grip 的 pointerdown 处理 */
  startResize: (e: React.PointerEvent) => void;
}

/**
 * 面板高度管理：拖拽调高 + localStorage 持久化。
 *
 * 初值从 localStorage 恢复（不小于 MIN_HEIGHT），拖拽在 MIN_HEIGHT～MAX_HEIGHT_RATIO
 * 视口高之间夹取，松手时写回 localStorage。
 *
 * @returns 高度 state、ref、拖拽回调
 */
export function usePanelHeight(): PanelHeight {
  const { useState, useRef, useCallback } = React;

  const [height, setHeight] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(HEIGHT_KEY));
      if (Number.isFinite(saved) && saved >= MIN_HEIGHT) return saved;
    } catch { /* storage 不可用（隐私模式 / SSR 探测） */ }
    return Math.round(window.innerHeight * DEFAULT_HEIGHT_RATIO);
  });
  const heightRef = useRef(height);
  heightRef.current = height;

  /* 拖拽 resize grip：向上生长面板 */
  const startResize = useCallback((e: React.PointerEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = heightRef.current;
    const maxH = Math.round(window.innerHeight * MAX_HEIGHT_RATIO);
    const move = (ev: PointerEvent): void => {
      const h = Math.min(maxH, Math.max(MIN_HEIGHT, startH + (startY - ev.clientY)));
      setHeight(Math.round(h));
    };
    const up = (): void => {
      document.body.classList.remove('dshTermResizing');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
      } catch { /* storage 不可用 */ }
    };
    document.body.classList.add('dshTermResizing');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, []);

  return { height, heightRef, startResize };
}

/** usePanelGeometry 返回值 */
export interface PanelGeometry {
  /** 对话列几何（面板不覆盖侧栏） */
  geo: ConversationGeo;
}

/**
 * 对话列几何测量：面板宽度对齐对话列，并向滚动容器注入 paddingBottom。
 *
 * 终端 bar/panel 固定在视口底部；对话滚动容器获得等于面板高度的 paddingBottom，
 * 使 composer 座位与上方 dock 条目整体上移，不被 fixed 终端面板遮挡。
 *
 * 用 scrollBody 的 paddingBottom 而非 composerSeat 的 marginBottom：composer
 * overlay 模式下 composerSeat 是 absolute，marginBottom 不改锚点；paddingBottom
 * 对 sticky/absolute 子元素都生效。
 *
 * @param rootRef - 面板根元素 ref（测量起点）
 * @returns 对话列几何 state
 */
export function usePanelGeometry(rootRef: React.RefObject<HTMLDivElement | null>): PanelGeometry {
  const { useLayoutEffect, useState } = React;
  const [geo, setGeo] = useState<ConversationGeo>({ left: 0, width: window.innerWidth });

  useLayoutEffect(() => {
    const rootEl = rootRef.current;
    if (rootEl === null) return;
    const findScrollBody = (): HTMLElement | null => {
      return rootEl.closest('[data-conversation-scroll]');
    };
    let scrollBody: HTMLElement | null = null;
    const measure = (): void => {
      if (scrollBody !== null) {
        const r = scrollBody.getBoundingClientRect();
        setGeo({ left: r.left, width: r.width });
      }
      const h = Math.round(rootEl.getBoundingClientRect().height);
      if (scrollBody !== null) scrollBody.style.paddingBottom = h > 0 ? h + 'px' : '';
    };
    scrollBody = findScrollBody();
    const ro = new ResizeObserver(measure);
    if (scrollBody !== null) ro.observe(scrollBody);
    ro.observe(rootEl);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      if (scrollBody !== null) scrollBody.style.paddingBottom = '';
    };
  }, [rootRef]);

  return { geo };
}
