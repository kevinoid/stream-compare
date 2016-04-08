/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var BBPromise = require('bluebird');
var EventEmitter = require('events').EventEmitter;
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
    // Note:  objectMode to prevent write-combining
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
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

  it('compares different-writes to objectMode streams equal', function(done) {
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
    streamCompare(stream1, stream2, deepEqual, done);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
  });

  it('compares different-writes as non-equal in objectMode', function(done) {
    var stream1 = new stream.PassThrough({objectMode: true});
    var stream2 = new stream.PassThrough({objectMode: true});
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

  describe('argument checking', function() {
    // Since these are by streamCompare, reuse them
    var stream1 = new stream.PassThrough();
    var stream2 = new stream.PassThrough();

    it('throws for invalid callback', function() {
      should.throws(function() {
        streamCompare(stream1, stream2, deepEqual, true);
      }, /\bcallback\b/);
    });

    it('for invalid stream1', function(done) {
      streamCompare(true, stream2, deepEqual, function(err) {
        should(err).be.an.instanceof(TypeError)
          .and.match({message: /\bstream1\b/});
        done();
      });
    });

    it('for invalid stream2', function(done) {
      streamCompare(stream1, true, deepEqual, function(err) {
        should(err).be.an.instanceof(TypeError)
          .and.match({message: /\bstream2\b/});
        done();
      });
    });

    it('for no .read() method and readPolicy \'least\'', function(done) {
      streamCompare(stream1, new EventEmitter(), deepEqual, function(err) {
        should(err).be.an.instanceof(TypeError)
          .and.match({message: /\bread\b/})
          .and.match({message: /\bleast\b/});
        done();
      });
    });

    it('for missing optionsOrCompare', function(done) {
      streamCompare(stream1, stream2, null, function(err) {
        should(err).be.an.instanceof(TypeError)
          .and.match({message: /\boptions\.compare\b/});
        done();
      });
    });

    it('for invalid optionsOrCompare', function(done) {
      streamCompare(stream1, stream2, true, function(err) {
        should(err).be.an.instanceof(TypeError)
          .and.match({message: /\boptions\.compare\b|\boptionsOrCompare\b/});
        done();
      });
    });

    it('for invalid options.readPolicy', function(done) {
      var options = {
        compare: deepEqual,
        readPolicy: 'invalid'
      };
      streamCompare(stream1, stream2, options, function(err) {
        should(err).be.an.instanceof(RangeError)
          .and.match({message: /\boptions\.readPolicy\b/});
        done();
      });
    });

    ['events', 'incremental', 'readPolicy'].forEach(function(optionName) {
      it('for invalid options.' + optionName, function(done) {
        var options = {
          compare: deepEqual
        };
        options[optionName] = true;  // None accepts true as valid
        streamCompare(stream1, stream2, options, function(err) {
          should(err).be.an.instanceof(TypeError)
            .and.match({
              message: new RegExp('\\boptions\\.' + optionName + '\\b')
            });
          done();
        });
      });
    });
  });

  describe('without global.Promise', function() {
    var hadPromise, oldPromise;

    before('remove global Promise', function() {
      if (global.Promise) {
        hadPromise = global.hasOwnProperty('Promise');
        oldPromise = global.Promise;
        // Note:  Deleting triggers Mocha's global leak detection.
        // Also wouldn't work if global scope had a prototype chain.
        global.Promise = undefined;
      }
    });

    after('restore global Promise', function() {
      if (oldPromise) {
        if (hadPromise) {
          global.Promise = oldPromise;
        } else {
          delete global.Promise;
        }
      }
    });

    it('throws without a callback', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();

      should.throws(
        function() { streamCompare(stream1, stream2, deepEqual); },
        function(err) {
          return err instanceof TypeError && /\bcallback\b/.test(err.message);
        }
      );
    });
  });

  describe('with global.Promise', function() {
    var hadPromise, oldPromise;

    before('ensure global Promise', function() {
      if (typeof global.Promise !== 'function') {
        hadPromise = global.hasOwnProperty('Promise');
        oldPromise = global.Promise;
        global.Promise = BBPromise;
      }
    });

    after('restore global Promise', function() {
      if (hadPromise === true) {
        global.Promise = oldPromise;
      } else if (hadPromise === false) {
        delete global.Promise;
      }
    });

    it('returns a Promise when called without a callback', function() {
      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();

      var result = streamCompare(stream1, stream2, deepEqual);
      should(result).be.an.instanceof(global.Promise);
    });

    it('resolves to value returned by compare', function() {
      var compareValue = {};
      function compare(state1, state2) {
        return compareValue;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare)
        .then(function(result) {
          should.strictEqual(result, compareValue);
        });
      stream1.end();
      stream2.end();
      return promise;
    });

    it('rejects with value thrown by compare', function() {
      var compareErr = new Error('test compare error');
      function compare(state1, state2) {
        throw compareErr;
      }

      var stream1 = new stream.PassThrough();
      var stream2 = new stream.PassThrough();
      var promise = streamCompare(stream1, stream2, compare).then(
        function() { throw Error('Should not be called!'); },
        function(err) { should.strictEqual(err, compareErr); }
      );
      stream1.end();
      stream2.end();
      return promise;
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
      // Since 0 is treated as 1, min is 1
      var eventDelay = 1;
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

      // Delay to ensure we don't read/finish
      setImmediate(function() {
        should.strictEqual(isDone, false);
        isPaused = false;
        stream1.resume();
        stream2.resume();
        stream1.end();
        stream2.end();
      });
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

      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
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

      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
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
      // Note:  objectMode to prevent write-combining
      var stream1 = new stream.PassThrough({objectMode: true});
      var stream2 = new stream.PassThrough({objectMode: true});
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

      setImmediate(function() {
        should.strictEqual(isDone, false);
        stream2.end('o');
      });
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
