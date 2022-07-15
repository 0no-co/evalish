<div align="center">
  <h2 align="center" aria-label="evalish">eval<i>ish</i></h2>
  <p align="center"><strong>A maybe slightly safer-ish wrapper around eval Function constructors</strong></p>
  <p align="center"><i>Please maybe try something else first.. Please.</i></p>
  <br />
  <a href="https://npmjs.com/package/evalish">
    <img alt="NPM Version" src="https://img.shields.io/npm/v/evalish.svg" />
  </a>
  <a href="https://npmjs.com/package/evalish">
    <img alt="License" src="https://img.shields.io/npm/l/evalish.svg" />
  </a>
  <a href="https://bundlephobia.com/result?p=evalish">
    <img alt="Minified gzip size" src="https://img.shields.io/bundlephobia/minzip/evalish.svg?label=gzip%20size" />
  </a>
  <br />
  <br />
</div>

`evalish` is a small helper library that only exports a wrapper for the Function constructor: `SafeFunction`.

The `SafeFunction` constructor allows you to evaluate code and dynamically create a new function. In most environments,
which at least don't have their CSP configured to disallow this, this will give you a fully executable function based
on a string. As `Function` by default is a little safer than `eval` and runs everything in the global context,
`SafeFunction` goes a step further and attempts to isolate the environment as much as possible.

It only does three simple things:
- Isolate the [global object](https://developer.mozilla.org/en-US/docs/Glossary/Global_object) and uses a separate object using a `with` statement
- Wraps all passed through globals, like `Array`, in a recursive proxy that disallows access to prototype-polluting propeties, such as `constructor`
- In the browser: Creates an `iframe` element and uses that frame's globals instead

If you haven't run away screaming yet, maybe that's what you're looking for. Just a bit more safety.
But really, I wrote this just for fun and I haven't written any tests yet and neither have I tested all edge cases.
The export being named `SafeFunction` is really just ambitious.

However, if you found a way to break out of `SafeFunction` and did something to the outside JS environment, let me
know and file an issue. I'm curious to see how far `evalish` would have to go to fully faux-isolate eval'ed code!

## Usage

First install `evalish` alongside `react`:

```sh
yarn add use-editable
# or
npm install --save use-editable
```

You'll then be able to import `SafeFunction` and pass it argument names and code,
[just like the regular `Function` constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function).

```js
import { SafeFunction } from 'evalish';

new SafeFunction('a', 'b', 'return a + b')(1, 2); // returns `3`
new SafeFunction('return window')(); // returns `undefined`
new SafeFunction('return Array.isArray.constructor')(); // returns `undefined`
```
