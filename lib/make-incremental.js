/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

/** Incrementally compares and reduces an Array-like property of the states
 * using a given comparison function. */
function incrementalProp(state1, state2, propName, compare) {
  var values1 = state1[propName];
  var values2 = state2[propName];

  var result;
  // Note:  Values may be undefined if no data was read.
  if (((values1 && values1.length !== 0) || state1.ended) &&
      ((values2 && values2.length !== 0) || state2.ended)) {
    var minLen = Math.min(
        values1 ? values1.length : 0,
        values2 ? values2.length : 0
    );

    if ((values1 && values1.length > minLen) && !state2.ended) {
      result = compare(values1.slice(0, minLen), values2);
    } else if ((values2 && values2.length > minLen) && !state1.ended) {
      result = compare(values1, values2.slice(0, minLen));
    } else {
      result = compare(values1, values2);
    }

    if (minLen > 0 && (result === null || result === undefined)) {
      state1[propName] = values1.slice(minLen);
      state2[propName] = values2.slice(minLen);
    }
  }

  return result;
}

/** Makes an incremental comparison and reduction function from a comparison
 * function.
 *
 * Given a function which compares output data (e.g. assert.deepStrictEqual),
 * this function returns an incremental comparison function which compares
 * only the amount of data output by both streams (unless the stream has ended,
 * in which case all remaining data is compared) and removes the compared data
 * if no comparison result is returned/thrown.
 *
 * @param {function((string|Buffer|Array), (string|Buffer|Array))} compareData
 * Data comparison function which will be called with data output by each
 * stream.
 * @param {?function(!Array.<!{name:string,args:Array}>,
 * !Array.<!{name:string,args:Array}>)=} compareEvents Events comparison
 * function which will be called with be called with with events output by
 * each stream.
 * @returns {function(!StreamState, !StreamState)} Incremental comparison
 * function which compares the stream states using compareData and
 * compareEvents, and removes compared values if no result is reached.
 */
module.exports = function makeIncremental(compareData, compareEvents) {
  return function incremental(state1, state2) {
    var dataResult = compareData &&
            incrementalProp(state1, state2, 'data', compareData);
    var eventsResult = compareEvents &&
            incrementalProp(state1, state2, 'events', compareEvents);

    return dataResult !== null && dataResult !== undefined ?
        dataResult :
        eventsResult;
  };
};
