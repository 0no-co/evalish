// Keys that'll always not be included (for Node.js)
const ignore = {
  sys: true,
  wasi: true,
  crypto: true,
  global: true,
  undefined: true,
  require: true,
  Function: true,
  eval: true,
  process: true,
  module: true,
  exports: true,
  makeSafeGlobal: true,
  __filename: true,
  __dirname: true,
  console: true,
};

const noop = function () {} as any;
const _freeze = Object.freeze;
const _seal = Object.seal;
const _keys = Object.keys;
const _getOwnPropertyNames = Object.getOwnPropertyNames;
const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const _defineProperty = Object.defineProperty;
const _create = Object.create;
const _slice = Array.prototype.slice;

type Object = Record<string | symbol, unknown>;

// Whether a key is safe to access by the Proxy
function safeKey(target: Object, key: string | symbol): string | undefined {
  return key !== 'constructor' &&
    key !== '__proto__' &&
    key !== 'prototype' &&
    typeof key !== 'symbol' &&
    key in target
    ? key
    : undefined;
}

function freeze(target: Object): Object {
  try { _freeze(target); } catch (_error) {}
  try { _seal(target); } catch (_error) {}
  return target;
}

const masked = new Set();

// Wrap any given target with a masking object preventing access to prototype properties
function mask(target: any, toplevel: boolean) {
  if (
    target == null ||
    (typeof target !== 'function' && typeof target !== 'object')
  ) {
    // If the target isn't a function or object then skip
    return target;
  }

  if (!('constructor' in target)) {
    toplevel = false;
  }

  if (toplevel && masked.has(target)) {
    return target;
  } else if (toplevel) {
    masked.add(target);
  }

  // Create a stand-in object or function
  let standin = target;
  if (!toplevel) {
    standin = typeof target === 'function'
      ? (function (this: any) {
          if (new.target === undefined) {
            return target.apply(this, arguments);
          } else {
            const args = _slice.call(arguments);
            args.unshift(null);
            return new (target.bind.apply(target, args));
          }
        })
      : _create(null);
  }

  // Copy all known keys over to the stand-in and recursively apply `withProxy`
  // Prevent unsafe keys from being accessed
  const keys = ["__proto__", "constructor"];
  try {
    // Chromium already restricts access to certain globals in an
    // iframe, this try catch block is to avoid
    // "Failed to enumerate the properties of 'Storage': access is denied for this document"
    keys.push(..._getOwnPropertyNames(target));
  } catch (_error) {
    keys.push(..._keys(target));
  }

  const seen = new Set();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (seen.has(key)) {
      continue;
    } else if (
      key !== 'prototype' &&
      (typeof standin !== 'function' || (key !== 'arguments' && key !== 'caller'))
    ) {
      seen.add(key);
      const descriptor = _getOwnPropertyDescriptor(standin, key) || {};
      if (descriptor.configurable) {
        _defineProperty(standin, key, {
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable,
          get: (() => {
            if (!safeKey(target, key)) {
              return noop;
            } if (toplevel) {
              try {
                const value = mask(target[key], false);
                return () => value;
              } catch (_error) {
                return noop;
              }
            } else {
              return () => mask(target[key], false);
            }
          })(),
        });
      }
    }
  }

  if (standin.prototype != null) {
    standin.prototype = _create(null);
  }

  return toplevel ? standin : freeze(standin);
}

let safeGlobal: Record<string | symbol, unknown> | void;
let vmGlobals: Record<string | symbol, unknown> = {};

function makeSafeGlobal() {
  if (safeGlobal) {
    return safeGlobal;
  }

  // globalThis fallback if it's not available
  const trueGlobal =
    typeof globalThis === 'undefined'
      ? new Function('return this')()
      : globalThis;

  // Get all available global names on `globalThis` and remove keys that are
  // explicitly ignored
  const trueGlobalKeys = _getOwnPropertyNames(trueGlobal).filter(
    key => !ignore[key]
  );

  // When we're in the browser, we can go a step further and try to create a
  // new JS context and globals in a separate iframe
  vmGlobals = trueGlobal;
  let iframe: HTMLIFrameElement | void;
  if (typeof document !== 'undefined') {
    try {
      iframe = document.createElement('iframe');
      iframe.src = document.location.protocol;
      // We can isolate the iframe as much as possible, but we must allow an
      // extent of cross-site scripts
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.referrerPolicy = 'no-referrer';
      document.head.appendChild(iframe);
      // We copy over all known globals (as seen on the original `globalThis`)
      // from the new global we receive from the iframe
      vmGlobals = _create(null);
      for (let i = 0, l = trueGlobalKeys.length; i < l; i++) {
        const key = trueGlobalKeys[i];
        vmGlobals[key] = iframe.contentWindow![key];
      }
    } catch (_error) {
      // When we're unsuccessful we revert to the original `globalThis`
      vmGlobals = trueGlobal;
    } finally {
      if (iframe) iframe.remove();
    }
  } else if (typeof require === 'function') {
    vmGlobals = _create(null);
    const scriptGlobal = new (require('vm').Script)('exports = globalThis').runInNewContext({}).exports;
    for (let i = 0, l = trueGlobalKeys.length; i < l; i++) {
      const key = trueGlobalKeys[i];
      vmGlobals[key] = scriptGlobal[key];
    }
  }

  safeGlobal = _create(null);

  // The safe global is initialised by copying all values from either `globalThis`
  // or the isolated global. They're wrapped using `withProxy` which further disallows
  // certain key accesses
  for (let i = 0, l = trueGlobalKeys.length; i < l; i++) {
    const key = trueGlobalKeys[i];
    safeGlobal[key] = mask(vmGlobals[key], true);
  }

  // We then reset all globals that are present on `globalThis` directly
  for (const key in trueGlobal) safeGlobal[key] = undefined;
  // We also reset all ignored keys explicitly
  for (const key in ignore) safeGlobal[key] = undefined;
  // It _might_ be safe to expose the Function constructor like this... who knows
  safeGlobal!.Function = SafeFunction;

  // Lastly, we also disallow certain property accesses on the safe global
  // Wrap any given target with a Proxy preventing access to unscopables
  if (typeof Proxy === 'function') {
    // Wrap the target in a Proxy that disallows access to some keys
    return (safeGlobal = new Proxy(safeGlobal!, {
      // Return a value, if it's allowed to be returned and mask this value
      get(target, _key) {
        const key = safeKey(target, _key);
        return !ignore[_key] && key !== undefined ? target[key] : undefined;
      },
      has(_target, _key) {
        return true;
      },
      set: noop,
      deleteProperty: noop,
      defineProperty: noop,
      getOwnPropertyDescriptor: noop,
    }));
  } else {
    // NOTE: Some property accesses may leak through here without the Proxy
    return freeze(safeGlobal!);
  }
}

interface SafeFunction {
  new (...args: string[]): Function;
  (...args: string[]): Function;
}

function SafeFunction(...args: string[]): Function {
  const safeGlobal = makeSafeGlobal();
  const code = args.pop();

  // Retrieve Function constructor from vm globals
  const Function = vmGlobals.Function as FunctionConstructor | void;
  const Object = vmGlobals.Object as ObjectConstructor;
  const createFunction = (Function || Object.constructor.constructor) as FunctionConstructor;

  // We pass in our safe global and use it using `with` (ikr...)
  // We then add a wrapper function for strict-mode and a few closing
  // statements to prevent the code from escaping the `with` block;
  const fn = createFunction(
    'globalThis',
    ...args,
    'with (globalThis) {\n"use strict";\nreturn (function () {\n' +
      code +
      '\n/**/;return;}).apply(this, arguments)\n}'
  ) as Function;

  // We lastly return a wrapper function which explicitly passes our safe global
  return function () {
    return fn.apply(safeGlobal, [safeGlobal].concat(arguments as any));
  };
}

export { SafeFunction };
