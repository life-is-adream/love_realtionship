/**
 * CustomEvent 轻量事件系统
 *
 * 使用原生 EventTarget / CustomEvent，无 DOM 节点依赖。
 *
 * 用法：
 * ```js
 * import { on, emit, off } from "./modules/core/events.js";
 *
 * // 监听事件
 * const unsub = on("memory:updated", (detail) => { console.log(detail); });
 *
 * // 触发事件
 * emit("memory:updated", { personaId: "lin", changes: ["topics"] });
 *
 * // 取消监听
 * unsub();
 * ```
 *
 * @module events
 */

/** @type {EventTarget} */
let bus = null;

/** 每个回调按事件名分别保存独立订阅，解绑不会影响其他事件。 */
const handlerMap = new WeakMap();

/**
 * 获取事件总线实例
 * @returns {EventTarget}
 */
function getBus() {
  if (!bus) {
    bus = new EventTarget();
  }
  return bus;
}

/**
 * 事件名称常量
 */
export const Events = {
  /** 记忆更新完成 */
  MEMORY_UPDATED: "heartflow:memory:updated",
  /** 分析完成 */
  ANALYSIS_COMMITTED: "heartflow:analysis:committed",
  /** 角色切换 */
  PERSONA_SWITCHED: "heartflow:persona:switched",
  /** 消息发送 */
  MESSAGE_SENT: "heartflow:message:sent",
  /** 状态重置 */
  STATE_RESET: "heartflow:state:reset",
  /** 情感分析更新 */
  EMOTION_ANALYZED: "heartflow:emotion:analyzed",
  /** 长期模式更新 */
  PATTERNS_UPDATED: "heartflow:patterns:updated"
};

/**
 * 监听事件
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 处理函数，接收 { detail } 参数
 * @returns {Function} 取消监听的函数
 */
export function on(eventName, handler) {
  if (typeof handler !== "function") throw new TypeError("Event handler must be a function");
  const wrapped = (e) => handler(e.detail);
  let events = handlerMap.get(handler);
  if (!events) handlerMap.set(handler, events = new Map());
  let subscriptions = events.get(eventName);
  if (!subscriptions) events.set(eventName, subscriptions = new Set());
  subscriptions.add(wrapped);
  getBus().addEventListener(eventName, wrapped);
  return () => {
    if (!subscriptions.delete(wrapped)) return;
    getBus().removeEventListener(eventName, wrapped);
    if (!subscriptions.size) events.delete(eventName);
    if (!events.size) handlerMap.delete(handler);
  };
}

/**
 * 触发事件
 * @param {string} eventName - 事件名称
 * @param {*} [detail] - 事件数据
 */
export function emit(eventName, detail) {
  getBus().dispatchEvent(new CustomEvent(eventName, { detail }));
}

/**
 * 取消监听
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 处理函数
 */
export function off(eventName, handler) {
  const events = handlerMap.get(handler);
  const subscriptions = events?.get(eventName);
  if (!subscriptions) return;
  for (const wrapped of subscriptions) getBus().removeEventListener(eventName, wrapped);
  subscriptions.clear();
  events.delete(eventName);
  if (!events.size) handlerMap.delete(handler);
}

/**
 * 一次性监听
 * @param {string} eventName - 事件名称
 * @returns {Promise<any>} 事件数据
 */
export function once(eventName) {
  return new Promise((resolve) => {
    const wrapped = (e) => {
      getBus().removeEventListener(eventName, wrapped);
      resolve(e.detail);
    };
    getBus().addEventListener(eventName, wrapped);
  });
}
