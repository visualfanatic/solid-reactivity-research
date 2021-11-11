// Original source taken from [Solid](https://github.com/solidjs/solid) by Ryan Carniato
// Inspired by [S.js](https://github.com/adamhaile/S) by Adam Haile
import type { JSX } from "dom-expressions/src/jsx";

export type Accessor<T> = () => T;
export type Setter<T> = undefined extends T
  ? <U extends T>(v?: (U extends Function ? never : U) | ((prev?: T) => U)) => U
  : <U extends T>(v: (U extends Function ? never : U) | ((prev: T) => U)) => U;
let ERROR: symbol | null = null;
let runEffects = runQueue;
export const NOTPENDING = {};
const STALE = 1;
const PENDING = 2;
const UNOWNED: Owner = {
  owned: null,
  cleanups: null,
  owner: null
};
export var Owner: Owner | null = null;
let Listener: Computation<any> | null = null;
let Pending: Signal<any>[] | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let ExecCount = 0;

declare global {
  var _$afterUpdate: () => void;
}

interface Signal<T> {
  value?: T;
  observers: Computation<any>[] | null;
  observerSlots: number[] | null;
  pending: T | {};
}

interface Owner {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  owner: Owner | null;
  sourceMap?: Record<string, { value: unknown }>;
  name?: string;
  componentName?: string;
}

interface Computation<T> extends Owner {
  fn: (v?: T) => T;
  state: number;
  sources: Signal<T>[] | null;
  sourceSlots: number[] | null;
  value?: T;
  updatedAt: number | null;
  pure: boolean;
  user?: boolean;
}

interface Memo<T> extends Signal<T>, Computation<T> {
}

/**
 * Creates a new non-tracked reactive context that doesn't auto-dispose
 *
 * @param fn a function in which the reactive state is scoped
 * @param detachedOwner optional reactive context to bind the root to
 * @returns the output of `fn`.
 *
 * @description https://www.solidjs.com/docs/latest/api#createroot
 */
export function createRoot<T>(fn: (dispose: () => void) => T, detachedOwner?: Owner): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: Owner =
      fn.length === 0 && !"_SOLID_DEV_"
        ? UNOWNED
        : { owned: null, cleanups: null, owner };

  Owner = root;
  Listener = null;
  let result: T;

  try {
    runUpdates(() => (result = fn(() => cleanNode(root))), true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  return result!;
}

/**
 * Creates a simple reactive state with a getter and setter
 * ```typescript
 * const [state: Accessor<T>, setState: Setter<T>] = createSignal<T>(
 *  value: T,
 *  options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * )
 * ```
 * @param value initial value of the state; if empty, the state's type will automatically extended with undefined; otherwise you need to extend the type manually if you want setting to undefined not be an error
 * @param options optional object with a name for debugging purposes and equals, a comparator function for the previous and next value to allow fine-grained control over the reactivity
 *
 * @returns ```typescript
 * [state: Accessor<T>, setState: Setter<T>]
 * ```
 * * the Accessor is merely a function that returns the current value and registers each call to the reactive root
 * * the Setter is a function that allows directly setting or mutating the value:
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * setCount(count => count + 1);
 * ```
 *
 * @description https://www.solidjs.com/docs/latest/api#createsignal
 */
export function createSignal<T>(): [get: Accessor<T | undefined>, set: Setter<T | undefined>];
export function createSignal<T>(
  value: T,
): [get: Accessor<T>, set: Setter<T>];
export function createSignal<T>(
  value?: T,
): [get: Accessor<T>, set: Setter<T>] {
  const s: Signal<T> = {
    value,
    observers: null,
    observerSlots: null,
    pending: NOTPENDING,
  };

  return [
    readSignal.bind(s),
    ((value: T extends Function ? never : T | ((p?: T) => T)) => {
      if (typeof value === "function") {
        value = value(s.pending !== NOTPENDING ? s.pending : s.value);
      }
      return writeSignal(s, value);
    }) as Setter<T>
  ];
}

/**
 * Creates a reactive computation that runs immediately before render, mainly used to write to other reactive primitives
 * ```typescript
 * export function createComputed<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createcomputed
 */
export function createComputed<T>(fn: (v?: T) => T | undefined): void;
export function createComputed<T>(fn: (v: T) => T, value: T): void;
export function createComputed<T>(fn: (v?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, true, STALE));
}

/**
 * Creates a reactive computation that runs during the render phase as DOM elements are created and updated but not necessarily connected
 * ```typescript
 * export function createRenderEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createrendereffect
 */
export function createRenderEffect<T>(fn: (v?: T) => T | undefined): void;
export function createRenderEffect<T>(fn: (v: T) => T, value: T): void;
export function createRenderEffect<T>(
  fn: (v?: T) => T,
  value?: T,
): void {
  updateComputation(
    createComputation(fn, value, false, STALE)
  );
}

/**
 * Creates a reactive computation that runs after the render phase
 * ```typescript
 * export function createEffect<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string }
 * ): void;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes
 *
 * @description https://www.solidjs.com/docs/latest/api#createeffect
 */
export function createEffect<T>(fn: (v?: T) => T | undefined): void;
export function createEffect<T>(fn: (v: T) => T, value: T): void;
export function createEffect<T>(fn: (v?: T) => T, value?: T): void {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  c.user = true;
  Effects && Effects.push(c);
}

/**
 * Creates a readonly derived reactive memoized signal
 * ```typescript
 * export function createMemo<T>(
 *   fn: (v: T) => T,
 *   value?: T,
 *   options?: { name?: string, equals?: false | ((prev: T, next: T) => boolean) }
 * ): T;
 * ```
 * @param fn a function that receives its previous or the initial value, if set, and returns a new value used to react on a computation
 * @param value an optional initial value for the computation; if set, fn will never receive undefined as first argument
 * @param options allows to set a name in dev mode for debugging purposes and use a custom comparison function in equals
 *
 * @description https://www.solidjs.com/docs/latest/api#creatememo
 */
export function createMemo<T>(
  fn: (v?: T) => T,
  value?: undefined,
): Accessor<T>;
export function createMemo<T>(
  fn: (v: T) => T,
  value: T,
): Accessor<T>;
export function createMemo<T>(
  fn: (v?: T) => T,
  value?: T,
): Accessor<T> {
  const c: Partial<Memo<T>> = createComputation<T>(
    fn,
    value,
    true,
    0,
  );
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  updateComputation(c as Memo<T>);
  return readSignal.bind(c as Memo<T>);
}

/**
 * Holds changes inside the block before the reactive context is updated
 * @param fn wraps the reactive updates that should be batched
 * @returns the return value from `fn`
 *
 * @description https://www.solidjs.com/docs/latest/api#batch
 */
export function batch<T>(fn: () => T): T {
  if (Pending) return fn();
  let result;
  const q: Signal<any>[] = (Pending = []);
  try {
    result = fn();
  } finally {
    Pending = null;
  }

  runUpdates(() => {
    for (let i = 0; i < q.length; i += 1) {
      const data = q[i];
      if (data.pending !== NOTPENDING) {
        const pending = data.pending;
        data.pending = NOTPENDING;
        writeSignal(data, pending);
      }
    }
  }, false);

  return result;
}

/**
 * Ignores tracking context inside its scope
 * @param fn the scope that is out of the tracking context
 * @returns the return value of `fn`
 *
 * @description https://www.solidjs.com/docs/latest/api#untrack
 */
export function untrack<T>(fn: Accessor<T>): T {
  let result: T,
    listener = Listener;

  Listener = null;
  result = fn();
  Listener = listener;

  return result;
}

export type ReturnTypes<T> = T extends (() => any)[]
  ? { [I in keyof T]: ReturnTypes<T[I]> }
  : T extends () => any
  ? ReturnType<T>
  : never;

/**
 * onMount - run an effect only after initial render on mount
 * @param fn an effect that should run only once on mount
 *
 * @description https://www.solidjs.com/docs/latest/api#onmount
 */
export function onMount(fn: () => void) {
  createEffect(() => untrack(fn));
}

/**
 * onCleanup - run an effect once before the reactive scope is disposed
 * @param fn an effect that should run only once on cleanup
 *
 * @description https://www.solidjs.com/docs/latest/api#oncleanup
 */
export function onCleanup(fn: () => void) {
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn("cleanups created outside a `createRoot` or `render` will never be run");
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}

// Dev
export function devComponent<T>(Comp: (props: T) => JSX.Element, props: T) {
  const c: Partial<Memo<JSX.Element>> = createComputation(
    () => untrack(() => Comp(props)),
    undefined,
    true
  );
  c.pending = NOTPENDING;
  c.observers = null;
  c.observerSlots = null;
  c.state = 0;
  updateComputation(c as Memo<JSX.Element>);
  return c.value;
}

/**
 * Resolves child elements to help interact with children
 *
 * @param fn an accessor for the children
 * @returns a accessor of the same children, but resolved
 *
 * @description https://www.solidjs.com/docs/latest/api#children
 */
export function children(fn: Accessor<JSX.Element>): Accessor<JSX.Element> {
  const children = createMemo(fn);
  return createMemo(() => resolveChildren(children()));
}

// Internal
export function readSignal(this: Signal<any> | Memo<any>) {
  if (
    (this as Memo<any>).sources &&
    (this as Memo<any>).state
  ) {
    const updates = Updates;
    Updates = null;
    (this as Memo<any>).state === STALE
      ? updateComputation(this as Memo<any>)
      : lookDownstream(this as Memo<any>);
    Updates = updates;
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots!.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots!.push(Listener.sources.length - 1);
    }
  }
  return this.value;
}

export function writeSignal(node: Signal<any> | Memo<any>, value: any) {
  if (Pending) {
    if (node.pending === NOTPENDING) Pending.push(node);
    node.pending = value;
    return value;
  }
  node.value = value;
  if (node.observers && node.observers.length) {
    runUpdates(() => {
      for (let i = 0; i < node.observers!.length; i += 1) {
        const o = node.observers![i];
        if (o.pure) Updates!.push(o);
        else Effects!.push(o);
        if (
          (o as Memo<any>).observers &&
          !o.state
        )
          markUpstream(o as Memo<any>);
        o.state = STALE;
      }
      if (Updates!.length > 10e5) {
        Updates = [];
        if ("_SOLID_DEV_") throw new Error("Potential Infinite Loop Detected.");
        throw new Error();
      }
    }, false);
  }
  return value;
}

function updateComputation(node: Computation<any>) {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  runComputation(
    node,
    node.value,
    time
  );
  Listener = listener;
  Owner = owner;
}

function runComputation(node: Computation<any>, value: any, time: number) {
  let nextValue;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    handleError(err);
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if ((node as Memo<any>).observers && (node as Memo<any>).observers!.length) {
      writeSignal(node as Memo<any>, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}

function createComputation<T>(
  fn: (v?: T) => T,
  init: T | undefined,
  pure: boolean,
  state: number = STALE,
) {
  const c: Computation<T> = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    pure
  };
  if (Owner === null)
    "_SOLID_DEV_" &&
      console.warn(
        "computations created outside a `createRoot` or `render` will never be disposed"
      );
  else if (Owner !== UNOWNED) {
    if (!Owner.owned) Owner.owned = [c];
    else Owner.owned.push(c);
  }
  return c;
}

function runTop(node: Computation<any>) {
  if (node.state !== STALE) return (node.state = 0);
  const ancestors = [node];
  while (
    (node = node.owner as Computation<any>) &&
    (!node.updatedAt || node.updatedAt < ExecCount)
  ) {
    if (node.state)
      ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (
      node.state === STALE
    ) {
      updateComputation(node);
    } else if (
      node.state === PENDING
    ) {
      const updates = Updates;
      Updates = null;
      lookDownstream(node);
      Updates = updates;
    }
  }
}

function runUpdates(fn: () => void, init: boolean) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    fn();
  } catch (err) {
    handleError(err);
  } finally {
    completeUpdates(wait);
  }
}

function completeUpdates(wait: boolean) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  let cbs;
  if (Effects!.length)
    batch(() => {
      runEffects(Effects!);
      Effects = null;
    });
  else {
    Effects = null;
    if ("_SOLID_DEV_") globalThis._$afterUpdate && globalThis._$afterUpdate();
  }
  if (cbs) cbs.forEach(cb => cb());
}

function runQueue(queue: Computation<any>[]) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}

function runUserEffects(queue: Computation<any>[]) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  const resume = queue.length;
  for (i = 0; i < userLength; i++) runTop(queue[i]);
  for (i = resume; i < queue.length; i++) runTop(queue[i]);
}

function lookDownstream(node: Computation<any>) {
  node.state = 0;
  for (let i = 0; i < node.sources!.length; i += 1) {
    const source = node.sources![i] as Memo<any>;
    if (source.sources) {
      if (
        source.state === STALE
      )
        runTop(source);
      else if (
        source.state === PENDING
      )
        lookDownstream(source);
    }
  }
}

function markUpstream(node: Memo<any>) {
  for (let i = 0; i < node.observers!.length; i += 1) {
    const o = node.observers![i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates!.push(o);
      else Effects!.push(o);
      (o as Memo<any>).observers && markUpstream(o as Memo<any>);
    }
  }
}

function cleanNode(node: Owner) {
  let i;
  if ((node as Computation<any>).sources) {
    while ((node as Computation<any>).sources!.length) {
      const source = (node as Computation<any>).sources!.pop()!,
        index = (node as Computation<any>).sourceSlots!.pop()!,
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop()!,
          s = source.observerSlots!.pop()!;
        if (index < obs.length) {
          n.sourceSlots![s] = index;
          obs[index] = n;
          source.observerSlots![index] = s;
        }
      }
    }
  }

  if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }

  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
  (node as Computation<any>).state = 0;
}

function handleError(err: any) {
  const fns = ERROR && lookup(Owner, ERROR);
  if (!fns) throw err;
  fns.forEach((f: (err: any) => void) => f(err));
}

function lookup(owner: Owner | null, key: symbol | string): any {
  return (
    owner && (owner.owner && lookup(owner.owner, key))
  );
}

function resolveChildren(children: JSX.Element): JSX.Element {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results: any[] = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}
