/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

var EventEmitter = require('events').EventEmitter;
var assert = require('assert');
var stream = require('stream');
var streamCompare = require('..');

var deepEqual = assert.deepStrictEqual || assert.deepEqual;

function assertInstanceOf(obj, ctor) {
  if (!(obj instanceof ctor)) {
    assert.fail(
      obj,
      ctor,
      null,
      'instanceof'
    );
  }
}

function neverCalled(arg) {
  var err = new Error('Should not be called');
  err.actual = arg;
  throw err;
}

describe('streamCompare', function() {
  it('propagates the value returned by compare', function() {
    var compareValue = false;
    function compare(state1, state2) {
      return compareValue;
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, compare)
      .then(function(value) {
        assert.strictEqual(value, compareValue);
      });
    stream1.end();
    stream2.end();

    return promise;
  });

  it('propagates the value thrown by compare', function() {
    var compareErr = new Error('compare error');
    function compare(state1, state2) {
      throw compareErr;
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, compare).then(
      neverCalled,
      function(err) { assert.strictEqual(err, compareErr); }
    );
    stream1.end();
    stream2.end();

    return promise;
  });

  it('propagates falsey value thrown by compare', function() {
    var compareErr = false;
    function compare(state1, state2) {
      throw compareErr;
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, compare).then(
      neverCalled,
      function(err) { assert.strictEqual(err, compareErr); }
    );
    stream1.end();
    stream2.end();

    return promise;
  });

  it('passes stream state information to compare', function() {
    var data1 = Buffer.from('hello');
    var data2 = Buffer.from('there');

    function compare(state1, state2) {
      deepEqual(state1.data, data1);
      deepEqual(state1.ended, true);
      deepEqual(state1.events, [
        {name: 'close', args: []},
        {name: 'end', args: []}
      ]);
      deepEqual(state1.totalDataLen, data1.length);

      deepEqual(state2.data, data2);
      deepEqual(state2.ended, true);
      deepEqual(state2.events, [
        {name: 'end', args: []}
      ]);
      deepEqual(state2.totalDataLen, data2.length);
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, compare);

    var writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.emit('close');
    stream1.end(data1.slice(writeSize));

    stream2.write(data2.slice(0, 0));
    stream2.end(data2);

    return promise;
  });

  it('treats string stream data as strings', function() {
    var data1 = 'hello';
    var data2 = 'there';

    function compare(state1, state2) {
      assert.strictEqual(state1.data, data1);
      assert.strictEqual(state2.data, data2);
    }

    var stream1 = new stream.PassThrough({encoding: 'utf8'});
    var stream2 = new stream.PassThrough({encoding: 'utf8'});
    var promise = streamCompare(stream1, stream2, compare);

    var writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.end(data1.slice(writeSize));
    stream2.write(data2.slice(0, 0));
    stream2.end(data2);

    return promise;
  });

  it('compares empty streams as equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual);
    stream1.end();
    stream2.end();
    return promise;
  });

  it('compares empty and non-empty streams as not equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual).then(
      neverCalled,
      function(err) { assertInstanceOf(err, assert.AssertionError); }
    );
    stream1.end();
    stream2.end('hello');

    return promise;
  });

  it('compares non-empty and empty streams as not equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual).then(
      neverCalled,
      function(err) { assertInstanceOf(err, assert.AssertionError); }
    );
    stream1.end('hello');
    stream2.end();
    return promise;
  });

  it('compares same-data streams as equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual);
    stream1.end('hello');
    stream2.end('hello');
    return promise;
  });

  it('compares different-data streams as not equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual).then(
      neverCalled,
      function(err) { assertInstanceOf(err, assert.AssertionError); }
    );
    stream1.end('hello');
    stream2.end('world');
    return promise;
  });

  it('compares buffered different-data streams as not equal', function() {
    var compareVal = false;
    function compare(state1, state2) {
      return compareVal;
    }
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    stream1.end('hello');
    stream2.end('world');

    return new Promise(function(resolve, reject) {
      process.nextTick(resolve);
    }).then(function() {
      return streamCompare(stream1, stream2, compare);
    }).then(function(result) {
      assert.strictEqual(result, compareVal);
    });
  });

  it('compares same-data same-writes as equal', function() {
    // Note:  objectMode to prevent write-combining
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
    var promise = streamCompare(stream1, stream2, deepEqual);
    stream1.write('hello');
    stream1.end(' world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares same-data different-writes as equal', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var promise = streamCompare(stream1, stream2, deepEqual);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares different-writes to objectMode streams equal', function() {
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
    var promise = streamCompare(stream1, stream2, deepEqual);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares different-writes as non-equal in objectMode', function() {
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
    var options = {
      compare: deepEqual,
      objectMode: true
    };
    var promise = streamCompare(stream1, stream2, options).then(
      neverCalled,
      function(err) { assertInstanceOf(err, assert.AssertionError); }
    );
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  describe('argument checking', function() {
    // Since these are by streamCompare, reuse them
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();

    it('throws for invalid stream1', function() {
      assert.throws(
        function() {
          streamCompare(true, stream2, deepEqual);
        },
        function(err) {
          return err instanceof TypeError &&
            /\bstream1\b/.test(err.message);
        }
      );
    });

    it('throws for invalid stream2', function() {
      assert.throws(
        function() {
          streamCompare(stream1, true, deepEqual);
        },
        function(err) {
          return err instanceof TypeError &&
            /\bstream2\b/.test(err.message);
        }
      );
    });

    it('throws for no .read() method and readPolicy \'least\'', function() {
      assert.throws(
        function() { streamCompare(stream1, new EventEmitter(), deepEqual); },
        function(err) {
          return err instanceof TypeError &&
            /\bread\b/.test(err.message) &&
            /\bleast\b/.test(err.message);
        }
      );
    });

    it('throws for missing optionsOrCompare', function() {
      assert.throws(
        function() { streamCompare(stream1, stream2, null); },
        function(err) {
          return err instanceof TypeError &&
            /\boptions\.compare\b/.test(err.message);
        }
      );
    });

    it('throws for invalid optionsOrCompare', function() {
      assert.throws(
        function() { streamCompare(stream1, stream2, true); },
        function(err) {
          return err instanceof TypeError &&
            /\boptions\.compare\b|\boptionsOrCompare\b/.test(err.message);
        }
      );
    });

    it('throws for invalid options.readPolicy', function() {
      assert.throws(
        function() {
          var options = {
            compare: deepEqual,
            readPolicy: 'invalid'
          };
          streamCompare(stream1, stream2, options);
        },
        function(err) {
          return err instanceof RangeError &&
            /\boptions\.readPolicy\b/.test(err.message);
        }
      );
    });

    var optionNames = ['endEvents', 'events', 'incremental', 'readPolicy'];
    optionNames.forEach(function(optionName) {
      it('for invalid options.' + optionName, function() {
        assert.throws(
          function() {
            var options = {
              compare: deepEqual
            };
            options[optionName] = true; // None accepts true as valid
            streamCompare(stream1, stream2, options);
          },
          function(err) {
            var optionRE = new RegExp('\\boptions\\.' + optionName + '\\b');
            return err instanceof TypeError &&
              optionRE.test(err.message);
          }
        );
      });
    });
  });

  describe('abortOnError', function() {
    it('compares error events by default', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual);
      stream1.emit('error', new Error('Test'));
      stream2.emit('error', new Error('Test'));
      return promise;
    });

    it('can abort on error events', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        abortOnError: true,
        compare: deepEqual
      };
      var errTest = new Error('Test');
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) {
          assert.strictEqual(err, errTest);
        }
      );
      stream1.emit('error', errTest);
      return promise;
    });

    it('doesn\'t call incremental or compare on abort', function() {
      function compare(state1, state2) {
        process.nextTick(function() {
          throw new Error('compare shouldn\'t be called');
        });
      }
      function incremental(state1, state2) {
        process.nextTick(function() {
          throw new Error('incremental shouldn\'t be called');
        });
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        abortOnError: true,
        compare: compare,
        incremental: incremental
      };
      var errTest = new Error('Test');
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) {
          assert.strictEqual(err, errTest);
        }
      );
      stream1.emit('error', errTest);
      return promise;
    });
  });

  describe('delay', function() {
    it('compares delayed end events if delayed more', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      // Since 0 is treated as 1, min is 1
      var eventDelay = 1;
      var options = {
        compare: deepEqual,
        delay: eventDelay + 1
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.end();
      stream2.end();
      setTimeout(function() {
        stream1.emit('end');
      }, eventDelay);
      return promise;
    });
  });

  describe('endEvents', function() {
    it('can end on custom event', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        endEvents: ['test']
      };
      var promise = streamCompare(stream1, stream2, options);

      var ended = false;
      promise.then(function() {
        ended = true;
      });

      stream1.emit('test');

      return new Promise(function(resolve, reject) {
        setImmediate(function() {
          assert.strictEqual(ended, false);
          stream2.emit('test');
          resolve(promise);
        });
      });
    });

    it('can avoid ending on stream \'end\'', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual);

      var ended = false;
      promise.then(function() {
        ended = true;
      });

      stream1.end();
      stream2.end();

      return new Promise(function(resolve, reject) {
        setImmediate(function() {
          assert.strictEqual(ended, false);

          resolve();
        });
      });
    });

    it('abortOnError takes precedence for \'error\' event', function() {
      function compare(state1, state2) {
        process.nextTick(function() {
          throw new Error('compare shouldn\'t be called');
        });
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        abortOnError: true,
        compare: compare,
        endEvents: ['end', 'error']
      };
      var errTest = new Error('Test');
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) {
          assert.strictEqual(err, errTest);
        }
      );
      // Note:  .emit() rather than .end() to avoid delay
      stream1.emit('end');
      stream2.emit('error', errTest);
      return promise;
    });
  });

  describe('events', function() {
    it('compares Readable events by default', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    it('can ignore all events', function() {
      function compare(state1, state2) {
        deepEqual(state1.events, []);
        deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: []
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.emit('error');
      stream1.end();
      stream2.emit('close');
      stream2.emit('error');
      stream2.end();
      return promise;
    });

    it('ignores non-Readable events by default', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual);
      stream1.end();
      stream1.emit('finish');
      stream2.end();
      return promise;
    });

    it('can compare custom events', function() {
      var eventValue = {};
      function compare(state1, state2) {
        deepEqual(state1.events, [
          {name: 'test', args: [eventValue]}
        ]);
        deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['test']
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
      return promise;
    });

    it('ignores multiple occurrances of event name', function() {
      var eventValue = {};
      function compare(state1, state2) {
        deepEqual(state1.events, [
          {name: 'test', args: [eventValue]}
        ]);
        deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['test', 'test']
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
      return promise;
    });

    it('compares different Readable events as different', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.emit('close');
      stream1.end();
      stream2.end();
      return promise;
    });

    it('compares different event counts as different', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.emit('close');
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    // If the end events overlap the function returns early
    it('compares multiple non-overlapping end events', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      // streamCompare may read from either stream first and the 'end' event
      // does not fire until read() is called after EOF, so we emit directly
      // for first stream.  Then streamCompare must read from the second.
      stream1.emit('end');
      process.nextTick(function() {
        stream1.emit('end');
        stream2.end();
      });
      return promise;
    });

    it('compares immediate overlapping end events', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.end();
      stream2.end();
      stream2.once('end', function() {
        process.nextTick(function() {
          stream1.emit('end');
        });
      });
      return promise;
    });
  });

  describe('incremental', function() {
    it('has no effect if null is returned', function() {
      function incremental(state1, state2) {
        return null;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.end('hello');
      stream2.end('world');
      return promise;
    });

    it('avoids compare if a non-null value is returned', function() {
      var incrementalValue = false;
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        return incrementalValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options)
        .then(function(value) {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end('hello');
      stream2.end('hello');
      return promise;
    });

    it('avoids compare if a value is thrown', function() {
      var incrementalErr = new Error('incremental error');
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        throw incrementalErr;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assert.strictEqual(err, incrementalErr); }
      );
      stream1.end('hello');
      stream2.end('hello');
      return promise;
    });

    it('causes early return if a value is thrown', function() {
      var incrementalErr = new Error('incremental error');
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        throw incrementalErr;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assert.strictEqual(err, incrementalErr); }
      );
      stream1.end('hello');
      // stream2 writes more than stream1 but does not end.
      stream2.write('hello2');
      return promise;
    });

    it('is used in place of compare, if not specified', function() {
      var incrementalValue = false;
      function incremental(state1, state2) {
        return state1.ended && state2.ended ? incrementalValue : null;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options)
        .then(function(value) {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end('hello');
      stream2.end('world');
      return promise;
    });

    // This is a subtle implementation detail that we need to be careful about
    it('calls done once when conclusive on end', function() {
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      var incrementalValue = {};
      function incremental(state1, state2) {
        return incrementalValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream2, options)
        .then(function(value) {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end();
      stream2.end();
      return promise;
    });
  });

  describe('objectMode', function() {
    it('errors on differing-type reads not in objectMode', function() {
      // Streams are in objectMode, streamCompare is not
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, TypeError); }
      );
      stream1.write('hello');
      stream1.end(Buffer.from(' world'));
      stream2.end();
      return promise;
    });

    it('errors on object reads not in objectMode', function() {
      // Streams are in objectMode, streamCompare is not
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var promise = streamCompare(stream1, stream2, deepEqual).then(
        neverCalled,
        function(err) { assertInstanceOf(err, TypeError); }
      );
      stream1.end({test: true});
      stream2.end();
      return promise;
    });

    it('supports object reads in objectMode', function() {
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var options = {
        compare: deepEqual,
        objectMode: true
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.end({test: true});
      stream2.end({test: true});
      return promise;
    });
  });

  describe('readPolicy', function() {
    it('doesn\'t call read() when \'flowing\'', function() {
      var isDone = false;
      var isPaused = true;

      function incremental(state1, state2) {
        assert.strictEqual(isPaused, false);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        readPolicy: 'flowing',
        incremental: incremental
      };
      var promise = streamCompare(stream1, stream1, options).then(function() {
        isDone = true;
      });
      stream1.pause();
      stream1.write('hello');
      stream2.pause();
      stream2.write('hello');

      // Delay to ensure we don't read/finish
      setImmediate(function() {
        assert.strictEqual(isDone, false);
        isPaused = false;
        stream1.resume();
        stream2.resume();
        stream1.end();
        stream2.end();
      });

      return promise;
    });

    it('compares the same stream as equal when \'flowing\'', function() {
      var stream1 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        readPolicy: 'flowing'
      };
      var promise = streamCompare(stream1, stream1, options);
      stream1.end('hello');
      return promise;
    });

    it('handles empty-Buffer \'read\' events', function() {
      var data1 = Buffer.from('hello world');
      var data2 = [
        Buffer.from('hello'),
        Buffer.alloc(0),
        Buffer.from(' world')
      ];
      function compare(state1, state2) {
        deepEqual(state1.data, data1);
        deepEqual(state1.events, [
          {name: 'data', args: [data1]}
        ]);

        // Data properly recombined by flowing reads
        deepEqual(state2.data, Buffer.concat(data2));
        // Events record each 'data' event, even empty ones
        deepEqual(state2.events, [
          {name: 'data', args: [data2[0]]},
          {name: 'data', args: [data2[1]]},
          {name: 'data', args: [data2[2]]}
        ]);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['data'],
        readPolicy: 'flowing'
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);

      return promise;
    });

    it('handles empty-string \'read\' events', function() {
      var data1 = 'hello world';
      var data2 = ['hello', '', ' world'];
      function compare(state1, state2) {
        deepEqual(state1.data, data1);
        deepEqual(state1.events, [
          {name: 'data', args: [data1]}
        ]);

        // Data properly recombined by flowing reads
        deepEqual(state2.data, data2.join(''));
        // Events record each 'data' event, even empty ones
        deepEqual(state2.events, [
          {name: 'data', args: [data2[0]]},
          {name: 'data', args: [data2[1]]},
          {name: 'data', args: [data2[2]]}
        ]);
      }

      var stream1 = new stream.PassThrough({encoding: 'utf8'});
      var stream2 = new stream.PassThrough({encoding: 'utf8'});
      var options = {
        compare: compare,
        events: ['data'],
        readPolicy: 'flowing'
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);

      return promise;
    });

    it('doesn\'t read any data when \'none\'', function() {
      function compare(state1, state2) {
        assert.strictEqual(state1.data, undefined);
        assert.strictEqual(state2.data, undefined);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        readPolicy: 'none'
      };
      var promise = streamCompare(stream1, stream2, options);
      // Since there are no 'data' listeners, must .resume() to get 'end'
      stream1.resume();
      stream2.resume();
      stream1.end('hello');
      stream2.end('world');

      return promise;
    });

    it('can treat data as events only', function() {
      var data1 = Buffer.from('hello');
      var data2 = Buffer.from('world');
      function compare(state1, state2) {
        assert.strictEqual(state1.data, undefined);
        assert.strictEqual(state2.data, undefined);
        deepEqual(state1.events, [
          {name: 'close', args: []},
          {name: 'data', args: [data1]},
          {name: 'end', args: []}
        ]);
        deepEqual(state2.events, [
          {name: 'data', args: [data2]},
          {name: 'close', args: []},
          {name: 'end', args: []}
        ]);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['close', 'data', 'end', 'error'],
        readPolicy: 'none'
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.end(data1);
      stream2.write(data2);
      stream2.emit('close');
      stream2.end();
      return promise;
    });
  });

  describe('.makeIncremental()', function() {
    it('makes incremental from a Buffer comparison function', function() {
      var data1 = [Buffer.from('hello'), Buffer.from('world')];
      var data2 = [Buffer.from('hello'), Buffer.from('there')];
      // Use of compareCount in this way is illustrative, but over-specified.
      // Callers shouldn't depend on this exact behavior.
      // If this test breaks, it may be rewritten in a less-strict way
      var compareCount = 0;
      var compareValue = false;
      function compareData(incData1, incData2) {
        deepEqual(incData1, data1[compareCount]);
        deepEqual(incData2, data2[compareCount]);
        compareCount += 1;
        // null/undefined means "continue comparing future data"
        return incData1.equals(incData2) ? null : compareValue;
      }
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }

      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(compareData)
      };
      var promise = streamCompare(stream1, stream2, options)
        .then(function(value) {
          assert.strictEqual(value, compareValue);
        });

      stream1.write(data1[0]);
      stream2.write(data2[0]);
      stream1.end(data1[1]);
      stream2.end(data2[1]);

      return promise;
    });

    it('makes incremental from an event comparison function', function() {
      var compareValue = false;
      function compareEvents(incEvents1, incEvents2) {
        assertInstanceOf(incEvents1, Array);
        assertInstanceOf(incEvents2, Array);

        try {
          assert.deepEqual(incEvents1, incEvents2);
          // null/undefined means "continue comparing future data"
          return null;
        } catch (err) {
          return compareValue;
        }
      }
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(null, compareEvents)
      };
      var promise = streamCompare(stream1, stream2, options)
        .then(function(value) {
          assert.strictEqual(value, compareValue);
        });

      stream1.emit('close');
      stream1.end();
      stream2.end();

      return promise;
    });

    it('removes inconclusive data before compare', function() {
      function compare(state1, state2) {
        assert.strictEqual(state1.data.length, 0);
        assert.strictEqual(state2.data.length, 0);
      }

      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
      return promise;
    });

    // This test is primarily for testing empty string state handling internals
    it('removes inconclusive string data before compare', function() {
      function compare(state1, state2) {
        assert.strictEqual(state1.data.length, 0);
        assert.strictEqual(state2.data.length, 0);
      }

      var streamOptions = {
        encoding: 'utf8',
        // Note:  objectMode to prevent write-combining
        objectMode: true
      };
      var stream1 = new stream.PassThrough(streamOptions);
      var stream2 = new stream.PassThrough(streamOptions);
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
      return promise;
    });

    it('removes inconclusive events before compare', function() {
      function compare(state1, state2) {
        assert.strictEqual(state1.events.length, 0);
        assert.strictEqual(state2.events.length, 0);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual, deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    it('doesn\'t return early due to incompleteness', function() {
      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var isDone = false;
      var promise = streamCompare(stream1, stream2, options).then(function() {
        isDone = true;
      });
      stream1.write('he');
      stream2.write('hel');
      stream1.end('llo');
      stream2.write('l');

      setImmediate(function() {
        assert.strictEqual(isDone, false);
        stream2.end('o');
      });

      return promise;
    });

    it('returns early if streams differ before ending', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      stream1.write('hello');
      stream2.write('hella');
      return promise;
    });

    it('returns early if stream ends early', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end('hell');
      return promise;
    });

    it('returns early if stream ends empty', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        function(err) { assertInstanceOf(err, assert.AssertionError); }
      );
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end();
      return promise;
    });

    // Note:  Avoids throwing from compare since 'error' gets thrown and caught
    // outside of the constructor.
    it('compares buffered different-data streams as not equal', function() {
      var incrementalVal = false;
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      stream1.end('hello');
      stream2.end('world');
      return new Promise(function(resolve, reject) {
        process.nextTick(resolve);
      }).then(function() {
        var options = {
          compare: function compare(state1, state2) {
            throw new Error('compare shouldn\'t be called');
          },
          incremental: function incremental(state1, state2) {
            return incrementalVal;
          }
        };
        return streamCompare(stream1, stream2, options);
      }).then(function(result) {
        assert.strictEqual(result, incrementalVal);
      });
    });
  });
});

describe('Promise', function() {
  describe('#checkpoint()', function() {
    it('does a non-incremental comparison and resolves on result', function() {
      var compareCalled = false;
      var compareValue = false;
      function compare(state1, state2) {
        if (compareCalled) {
          process.nextTick(function() {
            throw new Error('compare called multiple times');
          });
        }
        compareCalled = true;
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      setImmediate(function() {
        assert.strictEqual(compareCalled, false);
        promise.checkpoint();
        assert.strictEqual(compareCalled, true);
      });

      return promise.then(function(value) {
        assert.strictEqual(value, compareValue);

        stream1.end();
        stream2.end();

        // Delay to ensure compare is not called
        return new Promise(function(resolve, reject) {
          setImmediate(resolve);
        });
      });
    });

    it('does not resolve for compare non-result', function() {
      var compareValue;
      function compare(state1, state2) {
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      var ended = false;
      promise.then(function() {
        ended = true;
      });

      return new Promise(function(resolve, reject) {
        setImmediate(function() {
          assert.strictEqual(ended, false);
          promise.checkpoint();

          setImmediate(function() {
            assert.strictEqual(ended, false);

            stream1.end();
            stream2.end();

            resolve(promise);
          });
        });
      });
    });

    it('can compare before reading', function() {
      var compareCount = 0;
      var compareValue = false;
      function compare(state1, state2) {
        compareCount += 1;
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      var testData = Buffer.from('test');

      promise.checkpoint();

      // Test that data written after end is not read by StreamComparison
      stream1.write(testData);
      stream2.write(testData);

      return promise.then(function(value) {
        assert.strictEqual(value, compareValue);

        return new Promise(function(resolve, reject) {
          setImmediate(function() {
            assert.strictEqual(compareCount, 1);

            deepEqual(stream1.read(), testData);
            deepEqual(stream2.read(), testData);

            resolve();
          });
        });
      });
    });

    it('does not compare after resolving', function() {
      var ended = false;
      function compare(state1, state2) {
        assert.strictEqual(ended, false);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      stream1.end();
      stream2.end();

      return promise.then(function(value) {
        ended = true;
        promise.checkpoint();
      });
    });

    it('can take the place of the final compare', function() {
      var ended = false;
      var compareValue = false;
      function compare(state1, state2) {
        if (ended) {
          process.nextTick(function() {
            throw new Error('compare called after end');
          });
        }
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      var endCount = 0;
      function onEnd() {
        endCount += 1;
        if (endCount === 2) {
          promise.checkpoint();
        }
      }
      stream1.on('end', onEnd);
      stream2.on('end', onEnd);

      stream1.end();
      stream2.end();

      return promise.then(function(value) {
        assert.strictEqual(value, compareValue);
        ended = true;

        // Delay to ensure compare is not called
        return new Promise(function(resolve, reject) {
          setImmediate(resolve);
        });
      });
    });
  });

  // Note:  Testing is lighter since most code paths shared with #checkpoint()
  describe('#end()', function() {
    it('does a non-incremental compare and ends on non-result', function() {
      var compareValue;
      function compare(state1, state2) {
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);
      promise.end();
      return promise;
    });

    it('does not compare after resolving', function() {
      var ended = false;
      function compare(state1, state2) {
        assert.strictEqual(ended, false);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare);

      stream1.end();
      stream2.end();

      return promise.then(function(value) {
        ended = true;
        promise.end();
      });
    });
  });
});
