/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var EventEmitter = require('events').EventEmitter;
var assign = require('object-assign');
var debug = require('debug')('stream-compare');
var nodeify = require('./lib/nodeify');

/** Defines the available read policies.
 * @enum {string}
 */
var ReadPolicy = {
  flowing: 'flowing',
  least: 'least',
  none: 'none'
};

/** Default option values.
 * @const
 */
var DEFAULT_OPTIONS = {
  abortOnError: false,
  delay: 0,
  // Observe Readable events other than 'data' by default
  events: ['close', 'end', 'error'],
  objectMode: false,
  // Can be ''flowing', least', or 'none'
  // @type {!ReadPolicy}
  readPolicy: 'least'
};

/** Caller-visible stream state for comparison.
 *
 * Guarantees/Invariants:
 *  - Equivalent states are assert.deepStrictEqual.
 *  - States can be round-tripped to JSON at any point.
 *  - States are owned by the caller, so any additional properties (which are
 *    permitted to violate the above guarantees) are preserved and the same
 *    state object is always returned.
 *
 * As a result, objects of this class have no methods and do not contain any
 * non-state information (e.g. the stream itself or the comparison options)
 * and their prototype is never used.
 *
 * @constructor
 */
function StreamState() {
  /** Has the stream emitted 'end' or 'error'. */
  this.ended = false;
  /** Events emitted by the stream.
   * @type !Array.<!{name: string, args: !Array}> */
  this.events = [];
  /** Data returned/emitted by the stream (as an Array if in objectMode).
   * @type Array|Buffer|string */
  this.data = undefined;
  /** Count of total objects read in objectMode, bytes/chars read otherwise. */
  this.totalDataLen = 0;
}

/** Same as streamCompare, but assumes its arguments are valid.
 * @private
 */
function streamCompareInternal(stream1, stream2, options, callback) {
  var state1 = new StreamState();
  var state2 = new StreamState();
  var ended = 0;
  var isDone = false;
  var listeners1 = {};
  var listeners2 = {};
  var endListener1;
  var endListener2;

  /** Gets the name of a stream for logging purposes. */
  function streamName(stream) {
    return stream === stream1 ? 'stream1' : 'stream2';
  }

  function done() {
    isDone = true;

    debug('Unregistering stream event listeners...');

    Object.keys(listeners1).forEach(function(eventName) {
      stream1.removeListener(eventName, listeners1[eventName]);
    });
    stream1.removeListener('readable', readNext);
    stream1.removeListener('error', endListener1);
    stream1.removeListener('error', done);
    stream1.removeListener('end', readNextOnEnd);
    stream1.removeListener('end', endListener1);

    Object.keys(listeners2).forEach(function(eventName) {
      stream2.removeListener(eventName, listeners2[eventName]);
    });
    stream2.removeListener('readable', readNext);
    stream2.removeListener('error', endListener2);
    stream2.removeListener('error', done);
    stream2.removeListener('end', readNextOnEnd);
    stream2.removeListener('end', endListener2);

    debug('All done.  Calling callback...');
    return callback.apply(this, arguments);
  }

  function doCompare() {
    debug('Performing final compare.');

    var result, resultErr;
    try {
      result = options.compare(state1, state2);
    } catch (err) {
      resultErr = err;
    }
    done(resultErr, result);
  }

  function doneIfIncremental() {
    var result, resultErr, threw;
    try {
      result = options.incremental(state1, state2);
    } catch (err) {
      threw = true;
      resultErr = err;
    }

    if ((result !== undefined && result !== null) || threw) {
      debug('Incremental comparison was conclusive.  Finishing...');
      done(resultErr, result);
      return true;
    }

    return false;
  }

  // Note:  Add event listeners before endListeners so end/error is recorded
  options.events.forEach(function(eventName) {
    if (listeners1[eventName]) {
      return;
    }

    if (options.abortOnError && eventName === 'error') {
      // Error event is always immediately fatal.
      return;
    }

    function listener() {
      debug('\'' + eventName + '\' event from ' + streamName(this) + '.');

      this.events.push({
        name: eventName,
        args: Array.prototype.slice.call(arguments)
      });

      if (options.incremental) {
        doneIfIncremental();
      }
    }

    listeners1[eventName] = listener.bind(state1);
    stream1.on(eventName, listeners1[eventName]);

    listeners2[eventName] = listener.bind(state2);
    stream2.on(eventName, listeners2[eventName]);
  });

  /** @this {!StreamState} */
  function endListener() {
    // Note:  If incremental is conclusive for 'end' event, this will be called
    // with isDone === true, since removeListener doesn't affect listeners for
    // an event which is already in-progress.
    if (this.ended || isDone) {
      return;
    }

    this.ended = true;
    ++ended;

    debug(streamName(this) + ' has ended.');

    if (options.incremental) {
      if (doneIfIncremental()) {
        return;
      }
    }

    if (ended === 2) {
      if (options.delay) {
        debug('All streams have ended.  Delaying for ' + options.delay +
            'ms before final compare.');
        setTimeout(doCompare, options.delay);
      } else {
        // Let pending I/O and callbacks complete to catch some errant events
        debug('All streams have ended.  Delaying before final compare.');
        setImmediate(doCompare);
      }
    }
  }

  endListener1 = endListener.bind(state1);
  stream1.on('end', endListener1);

  endListener2 = endListener.bind(state2);
  stream2.on('end', endListener2);

  if (options.abortOnError) {
    stream1.once('error', done);
    stream2.once('error', done);
  } else {
    stream1.on('error', endListener1);
    stream2.on('error', endListener2);
  }

  /** Adds data to a stream state.
   *
   * This function should be a method of StreamState, but that would violate
   * our guarantees.  We call it as if it were to convey this behavior and to
   * avoid ESLint no-param-reassign.
   *
   * @this {!StreamState}
   * @param {*} data Data read from the stream for this StreamState.
   */
  function addData(data) {
    if (options.objectMode) {
      if (!this.data) {
        this.data = [data];
      } else {
        this.data.push(data);
      }
      ++this.totalDataLen;
    } else if (typeof data !== 'string' && !(data instanceof Buffer)) {
      throw new TypeError('expected string or Buffer, got ' +
          Object.prototype.toString.call(data) + '.  Need objectMode?');
    } else if (this.data === null || this.data === undefined) {
      this.data = data;
      this.totalDataLen += data.length;
    } else if (typeof this.data === 'string' && typeof data === 'string') {
      // perf:  Avoid unnecessary string concatenation
      if (this.data.length === 0) {
        this.data = data;
      } else if (data.length > 0) {
        this.data += data;
      }
      this.totalDataLen += data.length;
    } else if (this.data instanceof Buffer && data instanceof Buffer) {
      // perf:  Avoid unnecessary Buffer concatenation
      if (this.data.length === 0) {
        this.data = data;
      } else if (data.length > 0) {
        // FIXME:  Potential performance issue if data or this.data are large.
        // Should append to a Buffer we control and store a slice in .data
        this.data = Buffer.concat(
            [this.data, data],
            this.data.length + data.length
        );
      }
      this.totalDataLen += data.length;
    } else {
      throw new TypeError('read returned ' +
          Object.prototype.toString.call(data) + ', previously ' +
          Object.prototype.toString.call(this.data) +
          '.  Need objectMode?');
    }
  }

  /** Handles data read from the stream for a given state. */
  function handleData(state, data) {
    try {
      addData.call(state, data);
    } catch (err) {
      done(err);
      return;
    }

    if (options.incremental) {
      doneIfIncremental();
    }
  }

  /** Reads from the non-ended stream which has the smallest totalDataLen. */
  function readNext() {
    var stream, state;

    while (!isDone) {
      if (!state1.ended &&
          (state2.ended || state1.totalDataLen <= state2.totalDataLen)) {
        stream = stream1;
        state = state1;
      } else if (!state2.ended) {
        stream = stream2;
        state = state2;
      } else {
        debug('All streams have ended.  No further reads.');
        return;
      }

      var data = stream.read();
      if (data === null) {
        debug('Waiting for ' + streamName(stream) + ' to be readable...');
        stream.once('readable', readNext);
        return;
      }

      handleData(state, data);
    }
  }

  /** Reads data when an 'end' event occurs.
   *
   * If 'end' occurs on the stream for which readNext is waiting for
   * 'readable', that event will never occur and it needs to start reading
   * from the other stream.
   */
  function readNextOnEnd() {
    // Remove pending 'readable' listener.
    // This is primarily for the case where readNext was listening for
    // 'readable' from the stream which _did_not_ emit 'end', which would
    // cause readNext to be listening twice when .read() returns null.
    // It also handles the case where a broken stream implementation emits
    // 'readable' after 'end'.
    stream1.removeListener('readable', readNext);
    stream2.removeListener('readable', readNext);
    return readNext.call(this);
  }

  switch (options.readPolicy) {
    case 'flowing':
      debug('Will read from streams in flowing mode.');
      stream1.on('data', handleData.bind(null, state1));
      stream2.on('data', handleData.bind(null, state2));
      break;

    case 'least':
      debug('Will read from stream with least output.');
      stream1.once('end', readNextOnEnd);
      stream2.once('end', readNextOnEnd);
      readNext();
      break;

    default:
      debug('Not reading from streams.');
      break;
  }
}

/** Same as streamCompare, but assumes callback is valid and doesn't return a
 * Promise.
 * @private
 */
function streamCompareCallback(stream1, stream2, options, callback) {
  // Can change this to duck typing if there are non-EventEmitter streams
  if (!(stream1 instanceof EventEmitter)) {
    throw new TypeError('stream1 must be an EventEmitter');
  }
  // Can change this to duck typing if there are non-EventEmitter streams
  if (!(stream2 instanceof EventEmitter)) {
    throw new TypeError('stream2 must be an EventEmitter');
  }
  if (options.readPolicy === 'least' &&
      (typeof stream1.read !== 'function' ||
       typeof stream2.read !== 'function')) {
    throw new TypeError('streams must have .read() for readPolicy \'least\'');
  }
  if (typeof options.compare !== 'function') {
    throw new TypeError('options.compare must be a function');
  }
  if (!(options.events instanceof Array)) {
    throw new TypeError('options.events must be an Array');
  }
  if (options.incremental && typeof options.incremental !== 'function') {
    throw new TypeError('options.incremental must be a function');
  }
  if (!ReadPolicy.hasOwnProperty(options.readPolicy)) {
    throw new RangeError('Invalid options.readPolicy \'' +
        options.readPolicy + '\'');
  }

  streamCompareInternal(stream1, stream2, options, callback);
}

/** Compares the output of two Readable streams.
 *
 * Options:
 * - Promise: Constructor for the promise type to return.  (default: Promise)
 * - abortOnError: Abort comparison and return error emitted by either stream.
 *   (default: false)
 * - compare: Comparison function which will be called with a StreamState
 *   object for each stream, after both streams have ended.  The value
 *   returned by this function will resolve the returned promise and be passed
 *   to the callback as its second argument.  A value thrown by this function
 *   will reject the promise and be passed to the callback as its first
 *   argument.
 *   This function is required if incremental is not specified.
 * - delay: Additional delay (in ms) after streams end before comparing.
 *   (default: 0)
 * - events: Names of events to compare.  (default: ['close', 'end', 'error'])
 * - incremental: Incremental comparison function which will be called
 *   periodically with a StreamState object for each stream.  This function
 *   may modify the StreamState objects to remove data not required for later
 *   comparisons (e.g. common output) and may perform the comparison before
 *   the streams have ended (e.g. due to early differences).  Any non-null,
 *   non-undefined value returned by this function will finish the comparison,
 *   resolve the returned promise, and be passed to the callback as its second
 *   argument. A value thrown by this function will finish the comparison,
 *   reject the promise and be passed to the callback as its first argument.
 *   If compare is not specified, this function will also be called for the
 *   final comparison.
 * - objectMode: Collect values read into an Array.  This allows comparison
 *   of read values without concatenation and comparison of non-string/Buffer
 *   types.
 * - readPolicy: Scheduling discipline for reads from the streams.
 *   - 'flowing': Reads are done concurrently using 'data' events.
 *   - 'least': Reads from the stream which has output the least data, measured
 *     in bytes/chars for non-objectMode or values for objectMode.
 *   - 'none': No reads are done.  When using this readPolicy, be sure to
 *     either add 'data' to events, add other 'data' listeners, .read() the
 *     data elsewhere, or call .resume() on the streams so that the data will
 *     be read and 'end' can be reached.
 *   (default: 'least')
 *
 * @param {!stream.Readable} stream1 First stream to compare.
 * @param {!stream.Readable} stream2 Second stream to compare.
 * @param {Object|function(!StreamState,!StreamState)=} optionsOrCompare
 * Options, or a comparison function (as described in options.compare).
 * @param {?function(Error, Object=)=} callback Callback with comparison result
 * or error.
 * @return {Promise} A Promise with the result of the comparison function.
 */
function streamCompare(stream1, stream2, optionsOrCompare, callback) {
  var options = assign(
      // Default Promise to global Promise at time of call, if defined
      {Promise: typeof Promise === 'function' && Promise},
      DEFAULT_OPTIONS,
      typeof optionsOrCompare === 'function' ? {compare: optionsOrCompare} :
          optionsOrCompare
  );
  if (!options.compare) {
    options.compare = options.incremental;
  }

  // Check for argument errors which must be thrown
  if (callback && typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }
  if (options.Promise &&
      (typeof options.Promise !== 'function' ||
       typeof options.Promise.reject !== 'function')) {
    throw new Error('options.Promise must be a function' +
        ' and have a .reject property');
  }
  if (!callback && !options.Promise) {
    throw new Error('Must provide callback or Promise type');
  }

  // From this point on we can return any errors using callback/Promise
  // As long as callers pass a callback or Promise, we never throw and callers
  // don't need to wrap in a try/catch.

  if (!options.Promise) {
    try {
      streamCompareCallback(stream1, stream2, options, callback);
    } catch (err) {
      process.nextTick(function() {
        callback(err);
      });
    }
    return undefined;
  }

  var result = new options.Promise(function(resolve, reject) {
    streamCompareCallback(stream1, stream2, options, function(err, val) {
      if (err) {
        reject(err);
      } else {
        resolve(val);
      }
    });
  });
  return nodeify(result, callback);
}

streamCompare.makeIncremental = require('./lib/make-incremental');

module.exports = streamCompare;
