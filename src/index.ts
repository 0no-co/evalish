// These are marked with `Symbol.unscopables` for the Proxy
const unscopables = {
  __proto__: true,
  prototype: true,
  constructor: true,
};

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
  module: true,
  exports: true,
  __filename: true,
  __dirname: true,
  console: true,
};

const noop = function () {} as any;

type Object = Record<string | symbol, unknown>;

// Whether a key is safe to access by the Proxy
function safeKey(target: Object, key: string | symbol): string | undefined {
  return key !== 'constructor' &&
    key !== '__proto__' &&
    key !== 'constructor' &&
    typeof key !== 'symbol' &&
    key in target
    ? key
    : undefined;
}

// Wrap any given target with a Proxy preventing access to unscopables
function withProxy(target: any) {
  if (
    target == null ||
    (typeof target !== 'function' && typeof target !== 'object')
  ) {
    // If the target isn't a function or object then skip
    return target;
  } else if (
    typeof Proxy === 'function' &&
    typeof Symbol === 'function' &&
    Symbol.unscopables
  ) {
    // Mark hidden keys as unscopable
    target[Symbol.unscopables] = unscopables;
    // Wrap the target in a Proxy that disallows access to some keys
    return new Proxy(target, {
      // Return a value, if it's allowed to be returned, and wrap that value in a proxy recursively
      get(target, _key) {
        const key = safeKey(target, _key);
        return key !== undefined ? withProxy(target[key]) : undefined;
      },
      has(target, key) {
        return !!safeKey(target, key);
      },
      set: noop,
      deleteProperty: noop,
      defineProperty: noop,
      getOwnPropertyDescriptor: noop,
    });
  }

  // Create a stand-in object or function
  const standin =
    typeof target === 'function'
      ? function (this: any) {
          return target.apply(this, arguments);
        }
      : Object.create(null);
  // Copy all known keys over to the stand-in and recursively apply `withProxy`
  // Prevent unsafe keys from being accessed
  const keys = ['constructor', 'prototype', '__proto__'].concat(
    Object.getOwnPropertyNames(target)
  );
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    Object.defineProperty(standin, key, {
      enumerable: true,
      get: safeKey(target, key)
        ? () => {
            return typeof target[key] === 'function' ||
              typeof target[key] === 'object'
              ? withProxy(target[key])
              : target[key];
          }
        : noop,
    });
  }

  return standin;
}

let safeGlobal: Record<string | symbol, unknown> | void;

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
  const trueGlobalKeys = Object.getOwnPropertyNames(trueGlobal).filter(
    key => !ignore[key]
  );

  // When we're in the browser, we can go a step further and try to create a
  // new JS context and globals in a separate iframe
  let vmGlobals = trueGlobal;
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
      vmGlobals = Object.create(null);
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
  }

  safeGlobal = Object.create(null);

  // The safe global is initialised by copying all values from either `globalThis`
  // or the isolated global. They're wrapped using `withProxy` which further disallows
  // certain key accesses
  for (let i = 0, l = trueGlobalKeys.length; i < l; i++) {
    const key = trueGlobalKeys[i];
    safeGlobal[key] = withProxy(vmGlobals[key]);
  }

  // We then reset all globals that are present on `globalThis` directly
  for (const key in trueGlobal) safeGlobal[key] = undefined;
  // We also reset all ignored keys explicitly
  for (const key in ignore) safeGlobal[key] = undefined;
  // It _might_ be safe to expose the Function constructor like this... who knows
  safeGlobal!.Function = SafeFunction;
  // Lastly, we also disallow certain property accesses on the safe global
  return (safeGlobal = withProxy(safeGlobal!));
}

interface SafeFunction {
  new (...args: string[]): Function;
  (...args: string[]): Function;
}

function SafeFunction(...args: string[]): Function {
  const safeGlobal = makeSafeGlobal();
  const code = args.pop();

  // We pass in our safe global and use it using `with` (ikr...)
  // We then add a wrapper function for strict-mode and a few closing
  // statements to prevent the code from escaping the `with` block;
  const fn = new Function(
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
