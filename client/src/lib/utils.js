import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatElapsed(t) {
  const sec = Math.floor((Date.now() - new Date(t)) / 1000)
  if (sec < 60)   return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

export function formatRelative(t) {
  const sec = Math.floor((Date.now() - new Date(t)) / 1000)
  if (sec < 5)    return '剛剛'
  if (sec < 60)   return `${sec}秒前`
  if (sec < 3600) return `${Math.floor(sec / 60)}分前`
  return `${Math.floor(sec / 3600)}小時前`
}

export const STATUS_LABEL = {
  running: '執行中', waiting: '等待中', error: '錯誤',
  complete: '完成',  idle: '閒置',    warning: '警告', unknown: '未知',
}

export const DEFAULT_STEP = {
  running: '處理中...', waiting: '等待輸入', error: '發生錯誤',
  warning: '可恢復錯誤', complete: '已完成',  idle: '閒置',
}

export const SORT_ORDER = {
  error: 0, waiting: 1, running: 2, warning: 3, idle: 4, complete: 5, unknown: 6,
}
