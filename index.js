/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('stream-compare');
var extend = require('extend');
var inherits = require('util').inherits;

/** Comparison type.
 * @enum {string}
 * @private
 */
var CompareType = {
  /** A full (non-incremental) comparison. */
  checkpoint: 'checkpoint',
  /** An incremental comparison. */
  incremental: 'incremental',
  /** A full comparison followed by <code>'end'</code>. */
  last: 'last'
};

/** Defines the available read policies.
 * @enum {string}
 */
var ReadPolicy = {
  /** Reads are done concurrently using <code>'data'</code> events. */
  flowing: 'flowing',
  /** Reads from the stream which has output the least data, measured in
   * bytes/chars for non-<code>objectMode</code> or values for
   * <code>objectMode</code>. */
  least: 'least',
  /** No reads are done.  When using this readPolicy, be sure to either add
   * <code>'data'</code> to events, add other <code>'data'</code> listeners,
   * <code>.read()</code> the data elsewhere, or call <code>.resume()</code> on
   * the streams so that the data will be read and <code>'end'</code> can be
   * reached. */
  none: 'none'
};

/** Default option values.
 * @const
 * @private
 */
var DEFAULT_OPTIONS = {
  abortOnError: false,
  delay: 0,
  // Observe Readable events other than 'data' by default
  events: ['close', 'end', 'error'],
  objectMode: false,
  /** @type {!ReadPolicy} */
  readPolicy: 'least'
};

/** Caller-visible stream state for comparison.
 *
 * Guarantees/Invariants:
 *
 * <ul>
 * <li>Equivalent states are {@link assert.deepStrictEqual}.</li>
 * <li>States can be round-tripped to JSON at any point.</li>
 * <li>States are owned by the caller, so any additional properties (which are
 *   permitted to violate the above guarantees) are preserved and the same
 *   state object is always returned.</li>
 * </ul>
 *
 * <p>As a result, objects of this class have no methods and do not contain any
 * non-state information (e.g. the stream itself or the comparison options)
 * and their prototype is never used.</p>
 *
 * @constructor
 */
function StreamState() {
  /** Has the stream emitted <code>'end'</code> or <code>'error'</code>. */
  this.ended = false;
  /** Events emitted by the stream.
   * @type !Array.<!{name: string, args: !Array}> */
  this.events = [];
  /** Data returned/emitted by the stream (as an <code>Array</code> if in
   * <code>objectMode</code>).
   * @type Array|Buffer|string */
  this.data = undefined;
  /** Count of total objects read in <code>objectMode</code>, bytes/chars read
   * otherwise. */
  this.totalDataLen = 0;
}

/** Compares two streams.
 *
 * This class presents a Readable-like interface to simplify consumption of the
 * comparison result.  It emits at most one <code>'data'</code> or
 * <code>'error'</code> event and exactly one <code>'end'</code> event.
 *
 * Events:
 * <dl>
 * <dt><code>'data'</code></dt>
 * <dd>The comparison produced a result.</dd>
 * <dt><code>'end'</code></dt>
 * <dd>The comparison is complete, no further events will be emitted.</dd>
 * <dt><code>'error'</code></dt>
 * <dd>The comparison produced an error.  Error may be from the
 * <code>options.compare</code> or <code>options.incremental</code> function,
 * from the stream (for <code>options.abortOnError</code>), or from an error
 * in <code>StreamComparison</code> (such as data type mismatch in
 * non-objectMode).</dd>
 * </dl>
 *
 * @constructor
 * @extends EventEmitter
 * @ template CompareResult
 * @param {!stream.Readable} stream1 First stream to compare.
 * @param {!stream.Readable} stream2 Second stream to compare.
 * @param {!StreamCompareOptions<CompareResult>|
 * function(!StreamState,!StreamState): CompareResult}
 * optionsOrCompare Options, or a comparison function (as described in
 * {@link options.compare}).
 */
function StreamComparison(stream1, stream2, optionsOrCompare) {
  if (!(this instanceof StreamComparison)) {
    return new StreamComparison(stream1, stream2, optionsOrCompare);
  }

  EventEmitter.call(this);

  var options;
  if (optionsOrCompare) {
    if (typeof optionsOrCompare === 'function') {
      options = {compare: optionsOrCompare};
    } else if (typeof optionsOrCompare === 'object') {
      options = optionsOrCompare;
    } else {
      throw new TypeError('optionsOrCompare must be an object or function');
    }
  }

  options = extend({}, DEFAULT_OPTIONS, options);
  if (!options.compare) {
    options.compare = options.incremental;
  }

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
  if (!options.events ||
      typeof options.events !== 'object' ||
      options.events.length !== options.events.length | 0) {
    throw new TypeError('options.events must be Array-like');
  }
  if (options.incremental && typeof options.incremental !== 'function') {
    throw new TypeError('options.incremental must be a function');
  }
  if (typeof options.readPolicy !== 'string') {
    throw new TypeError('options.readPolicy must be a string');
  }
  if (!ReadPolicy.hasOwnProperty(options.readPolicy)) {
    throw new RangeError('Invalid options.readPolicy \'' +
        options.readPolicy + '\'');
  }

  var self = this;
  var state1 = new StreamState();
  var state2 = new StreamState();
  var ended = 0;
  var isDone = false;
  var listeners1 = {};
  var listeners2 = {};
  var postEndImmediate;
  var postEndTimeout;

  /** Gets the name of a stream for logging purposes.
   * @private
   */
  function streamName(stream) {
    return stream === stream1 ? 'stream1' :
      stream === stream2 ? 'stream2' :
      'unknown stream';
  }

  function done(err, result) {
    isDone = true;

    debug('Unregistering stream event listeners...');

    Object.keys(listeners1).forEach(function(eventName) {
      stream1.removeListener(eventName, listeners1[eventName]);
    });
    stream1.removeListener('readable', readNext);
    stream1.removeListener('error', endListener1);
    stream1.removeListener('error', onStreamError);
    stream1.removeListener('end', readNextOnEnd);
    stream1.removeListener('end', endListener1);

    Object.keys(listeners2).forEach(function(eventName) {
      stream2.removeListener(eventName, listeners2[eventName]);
    });
    stream2.removeListener('readable', readNext);
    stream2.removeListener('error', endListener2);
    stream2.removeListener('error', onStreamError);
    stream2.removeListener('end', readNextOnEnd);
    stream2.removeListener('end', endListener2);

    clearImmediate(postEndImmediate);
    clearTimeout(postEndTimeout);

    debug('Comparison finished.');
    self.emit('end');
  }

  function onStreamError(err) {
    debug(streamName(this) + ' emitted error', err);
    self.emit('error', err);
    done();
  }

  function doCompare(compareFn, type) {
    debug('Performing %s compare.', type);

    var hasResultOrError = false;
    try {
      var result = compareFn(state1, state2);
      if (result !== undefined && result !== null) {
        debug('Comparison produced a result:', result);
        hasResultOrError = true;
        self.emit('data', result);
      }
    } catch (err) {
      debug('Comparison produced an error:', err);
      hasResultOrError = true;
      self.emit('error', err);
    }

    if (hasResultOrError || type === CompareType.last) {
      done();
      return true;
    }

    return false;
  }

  /** Compares the states of the two streams non-incrementally.
   */
  this.checkpoint = function checkpoint() {
    if (isDone) {
      debug('Ignoring checkpoint() after \'end\'.');
      return;
    }

    doCompare(options.compare, CompareType.checkpoint);
  };

  /** Compares the states of the two streams non-incrementally then ends the
   * comparison whether or not compare produced a result or error.
   */
  this.end = function end() {
    if (isDone) {
      debug('Ignoring end() after \'end\'.');
      return;
    }

    doCompare(options.compare, CompareType.last);
  };

  // Note:  Add event listeners before endListeners so end/error is recorded
  Array.prototype.forEach.call(options.events, function(eventName) {
    if (listeners1[eventName]) {
      return;
    }

    if (options.abortOnError && eventName === 'error') {
      // Error event is always immediately fatal.
      return;
    }

    function listener(/* event args */) {
      this.events.push({
        name: eventName,
        args: Array.prototype.slice.call(arguments)
      });

      if (options.incremental) {
        doCompare(options.incremental, CompareType.incremental);
      }
    }

    listeners1[eventName] = function listener1() {
      debug('\'' + eventName + '\' event from stream1.');
      listener.apply(state1, arguments);
    };
    stream1.on(eventName, listeners1[eventName]);

    listeners2[eventName] = function listener2() {
      debug('\'' + eventName + '\' event from stream2.');
      listener.apply(state2, arguments);
    };
    stream2.on(eventName, listeners2[eventName]);
  });

  /** Handles stream end events.
   * @this {!Readable}
   * @private
   */
  function endListener(state) {
    // Note:  If incremental is conclusive for 'end' event, this will be called
    // with isDone === true, since removeListener doesn't affect listeners for
    // an event which is already in-progress.
    if (state.ended || isDone) {
      return;
    }

    state.ended = true;
    ++ended;

    debug(streamName(this) + ' has ended.');

    if (options.incremental) {
      if (doCompare(options.incremental, CompareType.incremental)) {
        return;
      }
    }

    if (ended === 2) {
      var postEndCompare = function() {
        doCompare(options.compare, CompareType.last);
      };
      if (options.delay) {
        debug('All streams have ended.  Delaying for ' + options.delay +
            'ms before final compare.');
        postEndTimeout = setTimeout(postEndCompare, options.delay);
      } else {
        // Let pending I/O and callbacks complete to catch some errant events
        debug('All streams have ended.  Delaying before final compare.');
        postEndImmediate = setImmediate(postEndCompare);
      }
    }
  }

  function endListener1() {
    endListener.call(this, state1);
  }
  stream1.on('end', endListener1);

  function endListener2() {
    endListener.call(this, state2);
  }
  stream2.on('end', endListener2);

  if (options.abortOnError) {
    stream1.once('error', onStreamError);
    stream2.once('error', onStreamError);
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
   * @private
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

  /** Handles data read from the stream for a given state.
   * @private
   */
  function handleData(state, data) {
    debug('Read data from ', streamName(this));

    try {
      addData.call(state, data);
    } catch (err) {
      debug('Error adding data from ' + streamName(this), err);
      self.emit('error', err);
      done();
      return;
    }

    if (options.incremental) {
      doCompare(options.incremental, CompareType.incremental);
    }
  }

  /** Reads from the non-ended stream which has the smallest totalDataLen.
   * @private
   */
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

      handleData.call(stream, state, data);
    }
  }

  /** Reads data when an 'end' event occurs.
   *
   * If 'end' occurs on the stream for which readNext is waiting for
   * 'readable', that event will never occur and it needs to start reading
   * from the other stream.
   *
   * @private
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
      stream1.on('data', handleData.bind(stream1, state1));
      stream2.on('data', handleData.bind(stream2, state2));
      break;

    case 'least':
      debug('Will read from stream with least output.');
      stream1.once('end', readNextOnEnd);
      stream2.once('end', readNextOnEnd);
      process.nextTick(readNext);
      break;

    default:
      debug('Not reading from streams.');
      break;
  }
}
inherits(StreamComparison, EventEmitter);

/** Options for {@link streamCompare} and {@link StreamComparison}.
 *
 * @ template CompareResult
 * @typedef {{
 *   abortOnError: boolean|undefined,
 *   compare: ((function(!StreamState,!StreamState): CompareResult)|undefined),
 *   delay: number|undefined,
 *   events: Array<string>|undefined,
 *   incremental:
 *     ((function(!StreamState,!StreamState): CompareResult)|undefined),
 *   objectMode: boolean|undefined,
 *   readPolicy: ReadPolicy|undefined
 * }} StreamCompareOptions
 * @property {boolean=} abortOnError Abort comparison and return error emitted
 * by either stream.  (default: <code>false</code>)
 * @property {function(!StreamState,!StreamState)=} compare Comparison function
 * which will be called with a StreamState object for each stream, after both
 * streams have ended.  The value returned by this function will resolve the
 * returned promise and be passed to the callback as its second argument.  A
 * value thrown by this function will reject the promise and be passed to the
 * callback as its first argument.  This function is required if incremental is
 * not specified.
 * @property {number=} delay Additional delay (in ms) after streams end before
 * comparing.  (default: <code>0</code>)
 * @property {Array<string>=} events: Names of events to compare.
 * (default: <code>['close', 'end', 'error']</code>)
 * @property {function(!StreamState,!StreamState)=} incremental Incremental
 * comparison function which will be called periodically with a StreamState
 * object for each stream.  This function may modify the StreamState objects to
 * remove data not required for later comparisons (e.g. common output) and may
 * perform the comparison before the streams have ended (e.g. due to early
 * differences).  Any non-null, non-undefined value returned by this function
 * will finish the comparison, resolve the returned promise, and be passed to
 * the callback as its second argument. A value thrown by this function will
 * finish the comparison, reject the promise and be passed to the callback as
 * its first argument.  If compare is not specified, this function will also be
 * called for the final comparison.
 * @property {boolean=} objectMode Collect values read into an Array.  This
 * allows comparison of read values without concatenation and comparison of
 * non-string/Buffer types.
 * @property {ReadPolicy=} readPolicy Scheduling discipline for reads from th
 * streams.  (default: <code>'least'</code>)
 */
// var StreamCompareOptions;

/** Compares the output of two Readable streams.
 *
 * @ template CompareResult
 * @param {!stream.Readable} stream1 First stream to compare.
 * @param {!stream.Readable} stream2 Second stream to compare.
 * @param {!StreamCompareOptions<CompareResult>|
 * function(!StreamState,!StreamState): CompareResult}
 * optionsOrCompare Options, or a comparison function (as described in
 * {@link options.compare}).
 * @param {?function(Error, CompareResult=)=} callback Callback with comparison
 * result or error.  If error is falsey, an Error instance with a
 * <code>.cause</code> property set to the falsey value will be passed instead,
 * to prevent common logic errors.
 * @return {Promise<CompareResult>|undefined} If <code>callback</code> is not
 * given and <code>global.Promise</code> is defined, a <code>Promise</code>
 * with the comparison result or error.
 */
function streamCompare(stream1, stream2, optionsOrCompare, callback) {
  if (!callback && typeof Promise === 'function') {
    // eslint-disable-next-line no-undef
    return new Promise(function(resolve, reject) {
      streamCompare(stream1, stream2, optionsOrCompare, function(err, result) {
        if (err) { reject(err); } else { resolve(result); }
      });
    });
  }

  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }

  // From this point on errors are returned using callback.  As long as callers
  // pass a callback or have global.Promise, this function will never throw and
  // callers don't need to wrap in a try/catch.

  var comparison;
  try {
    comparison = new StreamComparison(stream1, stream2, optionsOrCompare);
  } catch (err) {
    process.nextTick(function() {
      callback(err);
    });
    return undefined;
  }

  var didCallback = false;
  comparison.on('data', function(result) {
    didCallback = true;
    callback(null, result);
  });
  comparison.on('error', function(err) {
    didCallback = true;

    // Note:  Same convention as promise-nodeify to prevent falsey error
    var truthyErr = err;
    if (!err) {
      truthyErr = new Error(err + '');
      truthyErr.cause = err;
    }

    callback(truthyErr);
  });
  comparison.on('end', function() {
    if (!didCallback) {
      callback();
    }
  });

  return undefined;
}

streamCompare.StreamComparison = StreamComparison;
streamCompare.makeIncremental = require('./lib/make-incremental');

module.exports = streamCompare;
