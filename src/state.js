/**
 * Simple reactive state management.
 */

let state = {};
const subscribers = new Set();

/** Get the entire state or a specific key. */
export function getState(key) {
  if (key === undefined) return state;
  return state[key];
}

/** Set state (shallow merge) and notify subscribers. */
export function setState(partial) {
  const prev = { ...state };
  state = { ...state, ...partial };
  for (const fn of subscribers) {
    try {
      fn(state, prev);
    } catch (error) {
      console.error('State subscriber error:', error);
    }
  }
}

/** Subscribe to state changes. Returns unsubscribe function. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Reset state to initial values. */
export function resetState(initial = {}) {
  state = { ...initial };
  for (const fn of subscribers) {
    try {
      fn(state, {});
    } catch (error) {
      console.error('State subscriber error:', error);
    }
  }
}