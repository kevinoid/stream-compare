/**
 * @copyright Copyright 2013 When.js bindCallback authors
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

/** Calls a node-style callback when a Promise is resolved or rejected.
 *
 * This function provides the behavior of when.bindCallback from when.js or
 * bluebird's Promise.prototype.{asCallback,nodeify} (without options).
 *
 * @param {!Promise} promise Promise to monitor.
 * @param {?function(Error, *)} callback Node-style callback to be called when
 * promise is resolved or rejected.
 * @return {!Promise} Returns the promise argument.
 */
function nodeify(promise, callback) {
  /** Invokes callback with an empty stack (so exceptions are unhandled, as
   * they are in non-Promise callback use). */
  function wrapped(err, value) {
    process.nextTick(function() {
      callback(err, value);
    });
  }

  function success(value) {
    wrapped(null, value);
  }

  if (callback) {
    // Note:  unthenify converts falsey rejections to a TypeError
    // Otherwise callback can't recognize null rejections.
    // https://github.com/blakeembrey/unthenify/blob/v1.0.0/src/index.ts#L32
    promise.then(success, wrapped);
  }

  return promise;
}

module.exports = nodeify;
