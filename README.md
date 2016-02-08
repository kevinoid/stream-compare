stream-compare
==============

Compare the output of two Readable streams using a caller-provided
comparison/assertion function.

[![Build status](https://img.shields.io/travis/kevinoid/stream-compare.svg?style=flat)](https://travis-ci.org/kevinoid/stream-compare)
[![Coverage](https://img.shields.io/codecov/c/github/kevinoid/stream-compare.svg?style=flat)](https://codecov.io/github/kevinoid/stream-compare?branch=master)
[![Dependency Status](https://img.shields.io/david/kevinoid/stream-compare.svg?style=flat)](https://david-dm.org/kevinoid/stream-compare)
[![Version on NPM](https://img.shields.io/npm/v/stream-compare.svg?style=flat)](https://www.npmjs.com/package/stream-compare)


## Introductory Example

```js
var assert = require('assert');
var fs = require('fs');
var streamCompare = require('stream-compare');

var stream1 = fs.createReadStream(file);
var stream2 = fs.createReadStream(file);
streamCompare(stream1, stream2, assert.deepStrictEqual, function(err) {
  console.log(err); // AssertionError if streams differ
});
```


## Features

This package is similar to the
[stream-equal](https://github.com/fent/node-stream-equal) package with several
additional features:

- Support for caller-defined comparisons, which can return errors or values
  and are not limited to equality.
- Support for both incremental and one-shot comparisons.
- Support for caller-defined data reduction to avoid storing the entire stream
  history in memory before comparison.
- Makes no assumptions about the type of values read beyond whether they
  should be treated as objects (`objectMode`) or a stream of Buffers or
  strings.
- Does not do any coercion of the values read.
- Support for comparing (caller-configurable) events emitted by the streams.
- Support reading in flowing or non-flowing mode.
- Support for optionally aborting comparison on stream errors.
- Support for catching multiple end/error events (within one tick by default,
  or an optional configurable delay).
- Utility function for creating an incremental comparison and data-reduction
  function from a standard data comparison function (e.g. `assert.deepEqual`).


## Installation

This package is available on [npm](https://www.npmjs.com/) as
[`stream-compare`](https://www.npmjs.com/package/stream-compare)

```sh
npm install stream-compare
```


## Recipes

### Compare Incrementally

In order to avoid unnecessary memory use for streams with large amounts of
data and avoid unnecessary delays for streams which produce data slowly, the
output can be compared incrementally and inconclusive output can be removed.
This is done by the incremental function.  To make this easier, the utility
function `makeIncremental` creates such a function from a data comparison
function and/or an events comparison function:

```js
var options = {
  incremental: streamCompare.makeIncremental(
    assert.deepStrictEqual,     // Compares data
    assert.deepStrictEqual      // Compares events
  )
};
streamCompare(stream1, stream2, options, function(err) {
  console.log(err); // AssertionError if stream data values differ
});
```

### Compare Data Values Separately

Sometimes it may be desirable to compare the values returned by `.read()` or
`'data'` events separately, rather than concatenated together.  This can be
done by setting `objectMode: true` (even if the values aren't `Object`s):

```js
var options = {
  compare: assert.deepStrictEqual,
  objectMode: true
};
streamCompare(stream1, stream2, options, function(err) {
  console.log(err); // AssertionError if stream data values differ
});
```

### Compare Data and Event Interleaving

In order to compare the ordering of `'data'` events with other events, add
`'data'` to the `events` option and set `readPolicy` to `'flowing'` or
`'none'`.  Any `'data'` events and their arguments will appear with any other
matching events in the `events` property of the state object.

```js
var options = {
  compare: assert.deepStrictEqual,
  events: ['close', 'data', 'end', 'error'],
  readPolicy: 'none'
};
streamCompare(stream1, stream2, options, function(err) {
  console.log(err); // AssertionError if stream events (including 'data') differ
});
```

Additional examples and behavior guarantees are available in the
[streamCompare tests](test/stream-compare.js).


## API


## License

`stream-compare` is available under the terms of the
[MIT License](https://opensource.org/licenses/MIT).
