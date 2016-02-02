/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var BBPromise = require('bluebird');
var EventEmitter = require('events').EventEmitter;
// Run the tests with the global/platform Promise type, if available
var PPromise = typeof Promise === 'undefined' ? BBPromise : Promise;
var assert = require('assert');
var bufferEqual = require('buffer-equal');
var should = require('should');
var stream = require('stream');
var streamCompare = require('..');

var deepEqual = assert.deepStrictEqual || assert.deepEqual;

describe('streamCompare', function() {
  it('propagates the value returned by compare', function(done) {
    var compareValue = false;
    function compare(state1, state2) {
      return compareValue;
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, compare, function(err, value) {
      should.ifError(err);
      should.strictEqual(value, compareValue);
      done();
    });
    stream1.end();
    stream2.end();
  });

  it('propagates the value thrown by compare', function(done) {
    var compareErr = new Error('compare error');
    function compare(state1, state2) {
      throw compareErr;
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, compare, function(err) {
      should.strictEqual(err, compareErr);
      done();
    });
    stream1.end();
    stream2.end();
  });

  it('passes stream state information to compare', function(done) {
    var data1 = new Buffer('hello');
    var data2 = new Buffer('there');

    function compare(state1, state2) {
      should(state1.data).deepEqual(data1);
      should(state1.ended).deepEqual(true);
      should(state1.events).deepEqual([
        {name: 'close', args: []},
        {name: 'end', args: []}
      ]);
      should(state1.totalDataLen).deepEqual(data1.length);

      should(state2.data).deepEqual(data2);
      should(state2.ended).deepEqual(true);
      should(state2.events).deepEqual([
        {name: 'end', args: []}
      ]);
      should(state2.totalDataLen).deepEqual(data2.length);
    }

    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, compare, done);

    var writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.emit('close');
    stream1.end(data1.slice(writeSize));

    stream2.write(data2.slice(0, 0));
    stream2.end(data2);
  });

  it('treats string stream data as strings', function(done) {
    var data1 = 'hello';
    var data2 = 'there';

    function compare(state1, state2) {
      should.strictEqual(state1.data, data1);
      should.strictEqual(state2.data, data2);
    }

    var stream1 = new stream.PassThrough({encoding: 'utf8'});
    var stream2 = new stream.PassThrough({encoding: 'utf8'});
    streamCompare(stream1, stream2, compare, done);

    var writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.end(data1.slice(writeSize));
    stream2.write(data2.slice(0, 0));
    stream2.end(data2);
  });

  it('compares empty streams as equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, done);
    stream1.end();
    stream2.end();
  });

  it('compares empty and non-empty streams as not equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, function(err) {
      should(err).be.an.instanceof(assert.AssertionError);
      done();
    });
    stream1.end();
    stream2.end('hello');
  });

  it('compares non-empty and empty streams as not equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, function(err) {
      should(err).be.an.instanceof(assert.AssertionError);
      done();
    });
    stream1.end('hello');
    stream2.end();
  });

  it('compares same-data streams as equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, done);
    stream1.end('hello');
    stream2.end('hello');
  });

  it('compares different-data streams as not equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, function(err) {
      should(err).be.an.instanceof(assert.AssertionError);
      done();
    });
    stream1.end('hello');
    stream2.end('world');
  });

  it('compares same-data same-writes as equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, done);
    stream1.write('hello');
    stream1.end(' world');
    stream2.write('hello');
    stream2.end(' world');
  });

  it('compares same-data different-writes as equal', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    streamCompare(stream1, stream2, deepEqual, done);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
  });

  it('compares different-writes as non-equal in objectMode', function(done) {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    var options = {
      compare: deepEqual,
      objectMode: true
    };
    streamCompare(stream1, stream2, options, function(err) {
      should(err).be.an.instanceof(assert.AssertionError);
      done();
    });
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
  });

  it('throws on invalid arguments', function() {
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();
    function callback(err) {}

    should.throws(function() {
      streamCompare(true, stream2, deepEqual, true);
    }, /\bstream1\b/);

    should.throws(function() {
      streamCompare(stream1, true, deepEqual, true);
    }, /\bstream2\b/);

    // Missing .read() method for readPolicy === 'least'
    should.throws(function() {
      streamCompare(stream1, new EventEmitter(), deepEqual, true);
    }, /'least'/);

    should.throws(function() {
      streamCompare(stream1, stream2, deepEqual, true);
    }, /\bcallback\b/);

    should.throws(function() {
      streamCompare(stream1, stream2, null, callback);
    }, /\boptions\.compare\b/);

    should.throws(function() {
      streamCompare(stream1, stream2, true, callback);
    }, /\boptions\.compare\b/);

    should.throws(function() {
      var options = {
        compare: deepEqual,
        events: 'invalid'
      };
      streamCompare(stream1, stream2, options, callback);
    }, /\boptions\.events\b/);

    should.throws(function() {
      var options = {
        compare: deepEqual,
        incremental: true
      };
      streamCompare(stream1, stream2, options, callback);
    }, /\boptions\.incremental\b/);

    should.throws(function() {
      var options = {
        compare: deepEqual,
        readPolicy: true
      };
      streamCompare(stream1, stream2, options, callback);
    }, /\boptions\.readPolicy\b/);
  });

  describe('Promise', function() {
    if (typeof Promise !== 'undefined') {
      it('returns a Promise by default', function() {
        var stream1 = new stream.PassThrough();
        var stream2 = new stream.PassThrough();
        function cb() {}

        var result = streamCompare(stream1, stream2, deepEqual, cb);
        should(result).be.an.instanceof(Promise);
      });
    }

    it('can be set to null to avoid returning one', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: null,
        compare: deepEqual
      };
      var result = streamCompare(stream1, stream2, options, function() {});
      should.not.exist(result);
    });

    it('throws an Error if no callback or Promise is passed', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: null,
        compare: deepEqual
      };

      should.throws(function() {
        streamCompare(stream1, stream2, options);
      });
    });

    it('returns a Promise of the requested type', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: BBPromise,
        compare: deepEqual
      };
      function cb() {}

      var result = streamCompare(stream1, stream2, options, cb);
      should(result).be.an.instanceof(BBPromise);
    });

    it('returns a Promise which resolves when done', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: PPromise,
        compare: deepEqual
      };
      streamCompare(stream1, stream2, options).then(done, done);
      stream1.end();
      stream2.end();
    });

    it('resolves the Promise and calls the callback', function(done) {
      var cbCount = 0;
      function cb() {
        ++cbCount;
        if (cbCount > 1) {
          done();
        }
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: PPromise,
        compare: deepEqual
      };
      streamCompare(stream1, stream2, options, cb).then(cb, cb);
      stream1.end();
      stream2.end();
    });

    it('rejects the Promise and calls the callback on error', function(done) {
      var firstErr;
      function cb(err) {
        if (!firstErr) {
          firstErr = err;
        } else {
          should.strictEqual(firstErr, err);
          done();
        }
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        Promise: PPromise,
        compare: deepEqual
      };
      streamCompare(stream1, stream2, options, cb).catch(cb);
      stream1.end('hello');
      stream2.end();
    });
  });

  describe('abortOnError', function() {
    it('compares error events by default', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, done);
      stream1.emit('error', new Error('Test'));
      stream2.emit('error', new Error('Test'));
    });

    it('can abort on error events', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        abortOnError: true,
        compare: deepEqual
      };
      var errTest = new Error('Test');
      streamCompare(stream1, stream2, options, function(err) {
        should.strictEqual(err, errTest);
        done();
      });
      stream1.emit('error', errTest);
    });

    it('doesn\'t call incremental or compare on abort', function(done) {
      function compare(state1, state2) {
        done(new Error('compare shouldn\'t be called'));
      }
      function incremental(state1, state2) {
        done(new Error('incremental shouldn\'t be called'));
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        abortOnError: true,
        compare: compare,
        incremental: incremental
      };
      var errTest = new Error('Test');
      streamCompare(stream1, stream2, options, function(err) {
        should.strictEqual(err, errTest);
        done();
      });
      stream1.emit('error', errTest);
    });
  });

  describe('delay', function() {
    it('compares delayed end events if delayed more', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var eventDelay = 5;
      var options = {
        compare: deepEqual,
        delay: eventDelay + 1
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.end();
      stream2.end();
      setTimeout(function() {
        stream1.emit('end');
      }, eventDelay);
    });
  });

  describe('events', function() {
    it('compares Readable events by default', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, done);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
    });

    it('can ignore all events', function(done) {
      function compare(state1, state2) {
        should.deepEqual(state1.events, []);
        should.deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: []
      };
      streamCompare(stream1, stream2, options, done);
      stream1.emit('close');
      stream1.emit('error');
      stream1.end();
      stream2.emit('close');
      stream2.emit('error');
      stream2.end();
    });

    it('ignores non-Readable events by default', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, done);
      stream1.end();
      stream1.emit('finish');
      stream2.end();
    });

    it('can compare custom events', function(done) {
      var eventValue = {};
      function compare(state1, state2) {
        should.deepEqual(state1.events, [
          {name: 'test', args: [eventValue]}
        ]);
        should.deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['test']
      };
      streamCompare(stream1, stream2, options, done);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
    });

    it('ignores multiple occurrances of event name', function(done) {
      var eventValue = {};
      function compare(state1, state2) {
        should.deepEqual(state1.events, [
          {name: 'test', args: [eventValue]}
        ]);
        should.deepEqual(state2.events, []);
      }
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        events: ['test', 'test']
      };
      streamCompare(stream1, stream2, options, done);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
    });

    it('compares different Readable events as different', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.emit('close');
      stream1.end();
      stream2.end();
    });

    it('compares different event counts as different', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.emit('close');
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
    });

    // If the end events overlap the function returns early
    it('compares multiple non-overlapping end events', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.end();
      stream1.emit('end');
      stream2.end();
    });

    it('compares immediate overlapping end events', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.end();
      stream2.end();
      stream1.emit('end');
    });
  });

  describe('incremental', function() {
    it('has no effect if null is returned', function(done) {
      function incremental(state1, state2) {
        return null;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        incremental: incremental
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.end('hello');
      stream2.end('world');
    });

    it('avoids compare if a non-null value is returned', function(done) {
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
      streamCompare(stream1, stream2, options, function(err, value) {
        should.ifError(err);
        should.strictEqual(value, incrementalValue);
        done();
      });
      stream1.end('hello');
      stream2.end('hello');
    });

    it('avoids compare if a value is thrown', function(done) {
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
      streamCompare(stream1, stream2, options, function(err) {
        should.strictEqual(err, incrementalErr);
        done();
      });
      stream1.end('hello');
      stream2.end('hello');
    });

    it('causes early return if a value is thrown', function(done) {
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
      streamCompare(stream1, stream2, options, function(err) {
        should.strictEqual(err, incrementalErr);
        done();
      });
      stream1.end('hello');
      // stream2 writes more than stream1 but does not end.
      stream2.write('hello2');
    });

    it('is used in place of compare, if not specified', function(done) {
      var incrementalValue = false;
      function incremental(state1, state2) {
        return state1.ended && state2.ended ? incrementalValue : null;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: incremental
      };
      streamCompare(stream1, stream2, options, function(err, value) {
        should.ifError(err);
        should.strictEqual(value, incrementalValue);
        done();
      });
      stream1.end('hello');
      stream2.end('world');
    });

    // This is a subtle implementation detail that we need to be careful about
    it('calls done once when conclusive on end', function(done) {
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
      streamCompare(stream1, stream2, options, function(err, value) {
        should.ifError(err);
        should.strictEqual(value, incrementalValue);
        done();
      });
      stream1.end();
      stream2.end();
    });
  });

  describe('objectMode', function() {
    it('errors on differing-type reads not in objectMode', function(done) {
      // Streams are in objectMode, streamCompare is not
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(TypeError);
        done();
      });
      stream1.write('hello');
      stream1.end(new Buffer(' world'));
      stream2.end();
    });

    it('errors on object reads not in objectMode', function(done) {
      // Streams are in objectMode, streamCompare is not
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      streamCompare(stream1, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(TypeError);
        done();
      });
      stream1.end({test: true});
      stream2.end();
    });

    it('supports object reads in objectMode', function(done) {
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
      var options = {
        compare: deepEqual,
        objectMode: true
      };
      streamCompare(stream1, stream2, options, done);
      stream1.end({test: true});
      stream2.end({test: true});
    });
  });

  describe('readPolicy', function() {
    it('doesn\'t call read() when \'flowing\'', function(done) {
      var isDone = false;
      var isPaused = true;

      function incremental(state1, state2) {
        should.strictEqual(isPaused, false);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        readPolicy: 'flowing',
        incremental: incremental
      };
      streamCompare(stream1, stream1, options, function(err) {
        should.ifError(err);
        isDone = true;
        done();
      });
      stream1.pause();
      stream1.write('hello');
      stream2.pause();
      stream2.write('hello');

      // Delay long enough to ensure we don't read/finish
      var testDelay = 10;
      setTimeout(function() {
        should.strictEqual(isDone, false);
        isPaused = false;
        stream1.resume();
        stream2.resume();
        stream1.end();
        stream2.end();
      }, testDelay);
    });

    it('compares the same stream as equal when \'flowing\'', function(done) {
      var stream1 = new stream.PassThrough();
      var options = {
        compare: deepEqual,
        readPolicy: 'flowing'
      };
      streamCompare(stream1, stream1, options, done);
      stream1.end('hello');
    });

    it('handles empty-Buffer \'read\' events', function(done) {
      var data1 = new Buffer('hello world');
      var data2 = [new Buffer('hello'), new Buffer(0), new Buffer(' world')];
      function compare(state1, state2) {
        should.deepEqual(state1.data, data1);
        should.deepEqual(state1.events, [
          {name: 'data', args: [data1]}
        ]);

        // Data properly recombined by flowing reads
        should.deepEqual(state2.data, Buffer.concat(data2));
        // Events record each 'data' event, even empty ones
        should.deepEqual(state2.events, [
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
      streamCompare(stream1, stream2, options, done);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);
    });

    it('handles empty-string \'read\' events', function(done) {
      var data1 = 'hello world';
      var data2 = ['hello', '', ' world'];
      function compare(state1, state2) {
        should.deepEqual(state1.data, data1);
        should.deepEqual(state1.events, [
          {name: 'data', args: [data1]}
        ]);

        // Data properly recombined by flowing reads
        should.deepEqual(state2.data, data2.join(''));
        // Events record each 'data' event, even empty ones
        should.deepEqual(state2.events, [
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
      streamCompare(stream1, stream2, options, done);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);
    });

    it('doesn\'t read any data when \'none\'', function(done) {
      function compare(state1, state2) {
        should.not.exist(state1.data);
        should.not.exist(state2.data);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        readPolicy: 'none'
      };
      streamCompare(stream1, stream2, options, done);
      // Since there are no 'data' listeners, must .resume() to get 'end'
      stream1.resume();
      stream2.resume();
      stream1.end('hello');
      stream2.end('world');
    });

    it('can treat data as events only', function(done) {
      var data1 = new Buffer('hello');
      var data2 = new Buffer('world');
      function compare(state1, state2) {
        should.not.exist(state1.data);
        should.not.exist(state2.data);
        should(state1.events).deepEqual([
          {name: 'close', args: []},
          {name: 'data', args: [data1]},
          {name: 'end', args: []}
        ]);
        should(state2.events).deepEqual([
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
      streamCompare(stream1, stream2, options, done);
      stream1.emit('close');
      stream1.end(data1);
      stream2.write(data2);
      stream2.emit('close');
      stream2.end();
    });
  });

  describe('.makeIncremental()', function() {
    it('makes incremental from a Buffer comparison function', function(done) {
      var data1 = [new Buffer('hello'), new Buffer('world')];
      var data2 = [new Buffer('hello'), new Buffer('there')];
      // Use of compareCount in this way is illustrative, but over-specified.
      // Callers shouldn't depend on this exact behavior.
      // If this test breaks, it may be rewritten in a less-strict way
      var compareCount = 0;
      var compareValue = false;
      function compareData(incData1, incData2) {
        should.deepEqual(incData1, data1[compareCount]);
        should.deepEqual(incData2, data2[compareCount]);
        ++compareCount;
        // null/undefined means "continue comparing future data"
        return bufferEqual(incData1, incData2) ? null : compareValue;
      }
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(compareData)
      };
      streamCompare(stream1, stream2, options, function(err, value) {
        should.ifError(err);
        should.strictEqual(value, compareValue);
        done();
      });

      stream1.write(data1[0]);
      stream2.write(data2[0]);
      stream1.end(data1[1]);
      stream2.end(data2[1]);
    });

    it('makes incremental from an event comparison function', function(done) {
      var compareValue = false;
      function compareEvents(incEvents1, incEvents2) {
        should(incEvents1).be.an.instanceof(Array);
        should(incEvents2).be.an.instanceof(Array);

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
      streamCompare(stream1, stream2, options, function(err, value) {
        should.ifError(err);
        should.strictEqual(value, compareValue);
        done();
      });

      stream1.emit('close');
      stream1.end();
      stream2.end();
    });

    it('removes inconclusive data before compare', function(done) {
      function compare(state1, state2) {
        should.strictEqual(state1.data.length, 0);
        should.strictEqual(state2.data.length, 0);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      streamCompare(stream1, stream2, options, done);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
    });

    // This test is primarily for testing empty string state handling internals
    it('removes inconclusive string data before compare', function(done) {
      function compare(state1, state2) {
        should.strictEqual(state1.data.length, 0);
        should.strictEqual(state2.data.length, 0);
      }

      var stream1 = new stream.PassThrough({encoding: 'utf8'});
      var stream2 = new stream.PassThrough({encoding: 'utf8'});
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      streamCompare(stream1, stream2, options, done);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
    });

    it('removes inconclusive events before compare', function(done) {
      function compare(state1, state2) {
        should.strictEqual(state1.events.length, 0);
        should.strictEqual(state2.events.length, 0);
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        compare: compare,
        incremental: streamCompare.makeIncremental(deepEqual, deepEqual)
      };
      streamCompare(stream1, stream2, options, done);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
    });

    it('doesn\'t return early due to incompleteness', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      var isDone = false;
      streamCompare(stream1, stream2, options, function(err) {
        isDone = true;
        should.ifError(err);
        done();
      });
      stream1.write('he');
      stream2.write('hel');
      stream1.end('llo');
      stream2.write('l');

      var testDelay = 10;
      setTimeout(function() {
        should.strictEqual(isDone, false);
        stream2.end('o');
      }, testDelay);
    });

    it('returns early if streams differ before ending', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      stream1.write('hello');
      stream2.write('hella');
    });

    it('returns early if stream ends early', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end('hell');
    });

    it('returns early if stream ends empty', function(done) {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var options = {
        incremental: streamCompare.makeIncremental(deepEqual)
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(assert.AssertionError);
        done();
      });
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end();
    });
  });
});
