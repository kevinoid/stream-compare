/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const stream = require('node:stream');

// https://github.com/import-js/eslint-plugin-import/issues/2844
// eslint-disable-next-line import/extensions
const streamCompare = require('..');

function assertInstanceOf(obj, ctor) {
  if (!(obj instanceof ctor)) {
    assert.fail(
      obj,
      ctor,
      null,
      'instanceof',
    );
  }
}

function neverCalled(arg) {
  const err = new Error('Should not be called');
  err.actual = arg;
  throw err;
}

// Many tests define helper functions which could be global.
// More readable to keep them near their point of use.
/* eslint-disable unicorn/consistent-function-scoping */

describe('streamCompare', () => {
  it('propagates the value returned by compare', () => {
    const compareValue = false;
    function compare(state1, state2) {
      return compareValue;
    }

    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, compare)
      .then((value) => {
        assert.strictEqual(value, compareValue);
      });
    stream1.end();
    stream2.end();

    return promise;
  });

  it('propagates the value thrown by compare', () => {
    const compareErr = new Error('compare error');
    function compare(state1, state2) {
      throw compareErr;
    }

    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, compare).then(
      neverCalled,
      (err) => { assert.strictEqual(err, compareErr); },
    );
    stream1.end();
    stream2.end();

    return promise;
  });

  it('propagates falsey value thrown by compare', () => {
    const compareErr = false;
    function compare(state1, state2) {
      throw compareErr;
    }

    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, compare).then(
      neverCalled,
      (err) => { assert.strictEqual(err, compareErr); },
    );
    stream1.end();
    stream2.end();

    return promise;
  });

  it('passes stream state information to compare', () => {
    const data1 = Buffer.from('hello');
    const data2 = Buffer.from('there');

    function compare(state1, state2) {
      assert.deepStrictEqual(state1.data, data1);
      assert.deepStrictEqual(state1.ended, true);
      // PassThrough emits close after end in v14 (nodejs/node#30623)
      if (state1.events && state1.events.length === 2) {
        assert.deepStrictEqual(state1.events, [
          { name: 'close', args: [] },
          { name: 'end', args: [] },
        ]);
      } else {
        assert.deepStrictEqual(state1.events, [
          { name: 'close', args: [] },
          { name: 'end', args: [] },
          { name: 'close', args: [] },
        ]);
      }
      assert.deepStrictEqual(state1.totalDataLen, data1.length);

      assert.deepStrictEqual(state2.data, data2);
      assert.deepStrictEqual(state2.ended, true);
      // PassThrough emits close after end in v14 (nodejs/node#30623)
      if (state2.events && state2.events.length === 1) {
        assert.deepStrictEqual(state2.events, [
          { name: 'end', args: [] },
        ]);
      } else {
        assert.deepStrictEqual(state2.events, [
          { name: 'end', args: [] },
          { name: 'close', args: [] },
        ]);
      }
      assert.deepStrictEqual(state2.totalDataLen, data2.length);
    }

    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, compare);

    const writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.emit('close');
    stream1.end(data1.slice(writeSize));

    stream2.write(data2.slice(0, 0));
    stream2.end(data2);

    return promise;
  });

  it('treats string stream data as strings', () => {
    const data1 = 'hello';
    const data2 = 'there';

    function compare(state1, state2) {
      assert.strictEqual(state1.data, data1);
      assert.strictEqual(state2.data, data2);
    }

    const stream1 = new stream.PassThrough({ encoding: 'utf8' });
    const stream2 = new stream.PassThrough({ encoding: 'utf8' });
    const promise = streamCompare(stream1, stream2, compare);

    const writeSize = 2;
    stream1.write(data1.slice(0, writeSize));
    stream1.end(data1.slice(writeSize));
    stream2.write(data2.slice(0, 0));
    stream2.end(data2);

    return promise;
  });

  it('compares empty streams as equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
    stream1.end();
    stream2.end();
    return promise;
  });

  it('compares empty and non-empty streams as not equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
      .then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
    stream1.end();
    stream2.end('hello');

    return promise;
  });

  it('compares non-empty and empty streams as not equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
      .then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
    stream1.end('hello');
    stream2.end();
    return promise;
  });

  it('compares same-data streams as equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
    stream1.end('hello');
    stream2.end('hello');
    return promise;
  });

  it('compares different-data streams as not equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
      .then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
    stream1.end('hello');
    stream2.end('world');
    return promise;
  });

  it('compares buffered different-data streams as not equal', () => {
    const compareVal = false;
    function compare(state1, state2) {
      return compareVal;
    }
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    stream1.end('hello');
    stream2.end('world');

    return new Promise((resolve, reject) => {
      setImmediate(resolve);
    }).then(() => streamCompare(stream1, stream2, compare)).then((result) => {
      assert.strictEqual(result, compareVal);
    });
  });

  it('compares same-data same-writes as equal', () => {
    // Note:  objectMode to prevent write-combining
    const stream1 = new stream.PassThrough({ objectMode: true });
    const stream2 = new stream.PassThrough({ objectMode: true });
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
    stream1.write('hello');
    stream1.end(' world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares same-data different-writes as equal', () => {
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares different-writes to objectMode streams equal', () => {
    const stream1 = new stream.PassThrough({ objectMode: true });
    const stream2 = new stream.PassThrough({ objectMode: true });
    const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  it('compares different-writes as non-equal in objectMode', () => {
    const stream1 = new stream.PassThrough({ objectMode: true });
    const stream2 = new stream.PassThrough({ objectMode: true });
    const options = {
      compare: assert.deepStrictEqual,
      objectMode: true,
    };
    const promise = streamCompare(stream1, stream2, options).then(
      neverCalled,
      (err) => { assertInstanceOf(err, assert.AssertionError); },
    );
    stream1.end('hello world');
    stream2.write('hello');
    stream2.end(' world');
    return promise;
  });

  describe('argument checking', () => {
    // Since these are by streamCompare, reuse them
    const stream1 = new stream.PassThrough();
    const stream2 = new stream.PassThrough();

    it('throws for invalid stream1', () => {
      assert.throws(
        () => {
          streamCompare(true, stream2, assert.deepStrictEqual);
        },
        (err) => err instanceof TypeError
            && /\bstream1\b/.test(err.message),
      );
    });

    it('throws for invalid stream2', () => {
      assert.throws(
        () => {
          streamCompare(stream1, true, assert.deepStrictEqual);
        },
        (err) => err instanceof TypeError
            && /\bstream2\b/.test(err.message),
      );
    });

    it('throws for no .read() method and readPolicy \'least\'', () => {
      assert.throws(
        () => {
          streamCompare(stream1, new EventEmitter(), assert.deepStrictEqual);
        },
        (err) => err instanceof TypeError
            && /\bread\b/.test(err.message)
            && /\bleast\b/.test(err.message),
      );
    });

    it('throws for missing optionsOrCompare', () => {
      assert.throws(
        () => { streamCompare(stream1, stream2, null); },
        (err) => err instanceof TypeError
            && /\boptions\.compare\b/.test(err.message),
      );
    });

    it('throws for invalid optionsOrCompare', () => {
      assert.throws(
        () => { streamCompare(stream1, stream2, true); },
        (err) => err instanceof TypeError
            && /\boptions\.compare\b|\boptionsOrCompare\b/.test(err.message),
      );
    });

    it('throws for invalid options.readPolicy', () => {
      assert.throws(
        () => {
          const options = {
            compare: assert.deepStrictEqual,
            readPolicy: 'invalid',
          };
          streamCompare(stream1, stream2, options);
        },
        (err) => err instanceof RangeError
            && /\boptions\.readPolicy\b/.test(err.message),
      );
    });

    const optionNames = ['endEvents', 'events', 'incremental', 'readPolicy'];
    for (const optionName of optionNames) {
      it(`for invalid options.${optionName}`, () => {
        assert.throws(
          () => {
            const options = {
              compare: assert.deepStrictEqual,
            };
            options[optionName] = true; // None accepts true as valid
            streamCompare(stream1, stream2, options);
          },
          (err) => {
            const optionRE = new RegExp(`\\boptions\\.${optionName}\\b`);
            return err instanceof TypeError
              && optionRE.test(err.message);
          },
        );
      });
    }
  });

  describe('abortOnError', () => {
    it('compares error events by default', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
      stream1.emit('error', new Error('Test'));
      stream2.emit('error', new Error('Test'));
      return promise;
    });

    it('can abort on error events', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        abortOnError: true,
        compare: assert.deepStrictEqual,
      };
      const errTest = new Error('Test');
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => {
          assert.strictEqual(err, errTest);
        },
      );
      stream1.emit('error', errTest);
      return promise;
    });

    it('doesn\'t call incremental or compare on abort', () => {
      function compare(state1, state2) {
        queueMicrotask(() => {
          throw new Error('compare shouldn\'t be called');
        });
      }
      function incremental(state1, state2) {
        queueMicrotask(() => {
          throw new Error('incremental shouldn\'t be called');
        });
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        abortOnError: true,
        compare,
        incremental,
      };
      const errTest = new Error('Test');
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => {
          assert.strictEqual(err, errTest);
        },
      );
      stream1.emit('error', errTest);
      return promise;
    });
  });

  describe('delay', () => {
    it('compares delayed end events if delayed more', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      // Since 0 is treated as 1, min is 1
      const eventDelay = 1;
      const options = {
        compare: assert.deepStrictEqual,
        delay: eventDelay + 1,
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
      stream1.end();
      stream2.end();
      setTimeout(() => {
        stream1.emit('end');
      }, eventDelay);
      return promise;
    });
  });

  describe('endEvents', () => {
    it('can end on custom event', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare: assert.deepStrictEqual,
        endEvents: ['test'],
      };
      let ended = false;
      const promise = streamCompare(stream1, stream2, options)
        .then(() => { ended = true; });

      stream1.emit('test');

      return new Promise((resolve, reject) => {
        setImmediate(() => {
          assert.strictEqual(ended, false);
          stream2.emit('test');
          resolve(promise);
        });
      });
    });

    it('can avoid ending on stream \'end\'', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      let ended = false;
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(() => { ended = true; });

      stream1.end();
      stream2.end();

      return new Promise((resolve, reject) => {
        setImmediate(() => {
          assert.strictEqual(ended, false);

          resolve(promise);
        });
      });
    });

    it('abortOnError takes precedence for \'error\' event', () => {
      function compare(state1, state2) {
        queueMicrotask(() => {
          throw new Error('compare shouldn\'t be called');
        });
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        abortOnError: true,
        compare,
        endEvents: ['end', 'error'],
      };
      const errTest = new Error('Test');
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => {
          assert.strictEqual(err, errTest);
        },
      );
      // Note:  .emit() rather than .end() to avoid delay
      stream1.emit('end');
      stream2.emit('error', errTest);
      return promise;
    });
  });

  describe('events', () => {
    it('compares Readable events by default', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    it('compares events immediately after end by default', () => {
      function compare(state1, state2) {
        assert.deepStrictEqual(state1, state2);
        assert.deepStrictEqual(
          state1.events.at(-1).name,
          'close',
        );
      }
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);
      function emitClose() { this.emit('close'); }
      stream1.once('end', emitClose);
      stream2.once('end', emitClose);
      stream1.end();
      stream2.end();
      return promise;
    });

    it('can ignore all events', () => {
      function compare(state1, state2) {
        assert.deepStrictEqual(state1.events, []);
        assert.deepStrictEqual(state2.events, []);
      }
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        events: [],
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.emit('error');
      stream1.end();
      stream2.emit('close');
      stream2.emit('error');
      stream2.end();
      return promise;
    });

    it('ignores non-Readable events by default', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual);
      stream1.end();
      stream1.emit('finish');
      stream2.end();
      return promise;
    });

    it('can compare custom events', () => {
      const eventValue = {};
      function compare(state1, state2) {
        assert.deepStrictEqual(state1.events, [
          { name: 'test', args: [eventValue] },
        ]);
        assert.deepStrictEqual(state2.events, []);
      }
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        events: ['test'],
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
      return promise;
    });

    it('ignores multiple occurrances of event name', () => {
      const eventValue = {};
      function compare(state1, state2) {
        assert.deepStrictEqual(state1.events, [
          { name: 'test', args: [eventValue] },
        ]);
        assert.deepStrictEqual(state2.events, []);
      }
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        events: ['test', 'test'],
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.emit('test', eventValue);
      stream1.end();
      stream2.end();
      return promise;
    });

    it('compares different Readable events as different', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, assert.AssertionError); },
        );
      stream1.emit('close');
      stream1.end();
      stream2.end();
      return promise;
    });

    it('compares different event counts as different', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, assert.AssertionError); },
        );
      stream1.emit('close');
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    // If the end events overlap the function returns early
    it('compares multiple non-overlapping end events', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, assert.AssertionError); },
        );
      // streamCompare may read from either stream first and the 'end' event
      // does not fire until read() is called after EOF, so we emit directly
      // for first stream.  Then streamCompare must read from the second.
      stream1.emit('end');
      setImmediate(() => {
        stream1.emit('end');
        stream2.end();
      });
      return promise;
    });

    it('compares immediate overlapping end events', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, assert.AssertionError); },
        );
      stream1.end();
      stream2.end();
      stream2.once('end', () => {
        queueMicrotask(() => {
          stream1.emit('end');
        });
      });
      return promise;
    });
  });

  describe('incremental', () => {
    it('has no effect if null is returned', () => {
      function incremental(state1, state2) {
        return null;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare: assert.deepStrictEqual,
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
      stream1.end('hello');
      stream2.end('world');
      return promise;
    });

    it('avoids compare if a non-null value is returned', () => {
      const incrementalValue = false;
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        return incrementalValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options)
        .then((value) => {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end('hello');
      stream2.end('hello');
      return promise;
    });

    it('avoids compare if a value is thrown', () => {
      const incrementalErr = new Error('incremental error');
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        throw incrementalErr;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assert.strictEqual(err, incrementalErr); },
      );
      stream1.end('hello');
      stream2.end('hello');
      return promise;
    });

    it('causes early return if a value is thrown', () => {
      const incrementalErr = new Error('incremental error');
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      function incremental(state1, state2) {
        throw incrementalErr;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assert.strictEqual(err, incrementalErr); },
      );
      stream1.end('hello');
      // stream2 writes more than stream1 but does not end.
      stream2.write('hello2');
      return promise;
    });

    it('is used in place of compare, if not specified', () => {
      const incrementalValue = false;
      function incremental(state1, state2) {
        return state1.ended && state2.ended ? incrementalValue : null;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options)
        .then((value) => {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end('hello');
      stream2.end('world');
      return promise;
    });

    // This is a subtle implementation detail that we need to be careful about
    it('calls done once when conclusive on end', () => {
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }
      const incrementalValue = {};
      function incremental(state1, state2) {
        return incrementalValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental,
      };
      const promise = streamCompare(stream1, stream2, options)
        .then((value) => {
          assert.strictEqual(value, incrementalValue);
        });
      stream1.end();
      stream2.end();
      return promise;
    });
  });

  describe('objectMode', () => {
    it('errors on differing-type reads not in objectMode', () => {
      // Streams are in objectMode, streamCompare is not
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, TypeError); },
        );
      stream1.write('hello');
      stream1.end(Buffer.from(' world'));
      stream2.end();
      return promise;
    });

    it('errors on object reads not in objectMode', () => {
      // Streams are in objectMode, streamCompare is not
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const promise = streamCompare(stream1, stream2, assert.deepStrictEqual)
        .then(
          neverCalled,
          (err) => { assertInstanceOf(err, TypeError); },
        );
      stream1.end({ test: true });
      stream2.end();
      return promise;
    });

    it('supports object reads in objectMode', () => {
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const options = {
        compare: assert.deepStrictEqual,
        objectMode: true,
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.end({ test: true });
      stream2.end({ test: true });
      return promise;
    });
  });

  describe('readPolicy', () => {
    it('doesn\'t call read() when \'flowing\'', () => {
      let isDone = false;
      let isPaused = true;

      function incremental(state1, state2) {
        assert.strictEqual(isPaused, false);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare: assert.deepStrictEqual,
        readPolicy: 'flowing',
        incremental,
      };
      const promise = streamCompare(stream1, stream1, options).then(() => {
        isDone = true;
      });
      stream1.pause();
      stream1.write('hello');
      stream2.pause();
      stream2.write('hello');

      // Delay to ensure we don't read/finish
      setImmediate(() => {
        assert.strictEqual(isDone, false);
        isPaused = false;
        stream1.resume();
        stream2.resume();
        stream1.end();
        stream2.end();
      });

      return promise;
    });

    it('compares the same stream as equal when \'flowing\'', () => {
      const stream1 = new stream.PassThrough();
      const options = {
        compare: assert.deepStrictEqual,
        readPolicy: 'flowing',
      };
      const promise = streamCompare(stream1, stream1, options);
      stream1.end('hello');
      return promise;
    });

    it('handles empty-Buffer \'read\' events', () => {
      const data1 = Buffer.from('hello world');
      const data2 = [
        Buffer.from('hello'),
        Buffer.alloc(0),
        Buffer.from(' world'),
      ];
      function compare(state1, state2) {
        assert.deepStrictEqual(state1.data, data1);
        assert.deepStrictEqual(state1.events, [
          { name: 'data', args: [data1] },
        ]);

        // Data properly recombined by flowing reads
        assert.deepStrictEqual(state2.data, Buffer.concat(data2));
        // Events record each 'data' event, even empty ones
        assert.deepStrictEqual(state2.events, [
          { name: 'data', args: [data2[0]] },
          { name: 'data', args: [data2[1]] },
          { name: 'data', args: [data2[2]] },
        ]);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        events: ['data'],
        readPolicy: 'flowing',
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);

      return promise;
    });

    it('handles empty-string \'read\' events', () => {
      const data1 = 'hello world';
      const data2 = ['hello', '', ' world'];
      function compare(state1, state2) {
        assert.deepStrictEqual(state1.data, data1);
        assert.deepStrictEqual(state1.events, [
          { name: 'data', args: [data1] },
        ]);

        // Data properly recombined by flowing reads
        assert.deepStrictEqual(state2.data, data2.join(''));
        // Events record each 'data' event, even empty ones
        assert.deepStrictEqual(state2.events, [
          { name: 'data', args: [data2[0]] },
          { name: 'data', args: [data2[1]] },
          { name: 'data', args: [data2[2]] },
        ]);
      }

      const stream1 = new stream.PassThrough({ encoding: 'utf8' });
      const stream2 = new stream.PassThrough({ encoding: 'utf8' });
      const options = {
        compare,
        events: ['data'],
        readPolicy: 'flowing',
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.end(data1);

      stream2.write(data2[0]);
      // stream.PassThrough suppresses empty writes.  Emit it ourselves.
      stream2.emit('data', data2[1]);
      stream2.end(data2[2]);

      return promise;
    });

    it('doesn\'t read any data when \'none\'', () => {
      function compare(state1, state2) {
        assert.strictEqual(state1.data, undefined);
        assert.strictEqual(state2.data, undefined);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        readPolicy: 'none',
      };
      const promise = streamCompare(stream1, stream2, options);
      // Since there are no 'data' listeners, must .resume() to get 'end'
      stream1.resume();
      stream2.resume();
      stream1.end('hello');
      stream2.end('world');

      return promise;
    });

    it('can treat data as events only', () => {
      const data1 = Buffer.from('hello');
      const data2 = Buffer.from('world');
      function compare(state1, state2) {
        assert.strictEqual(state1.data, undefined);
        assert.strictEqual(state2.data, undefined);
        // PassThrough emits close after end in v14 (nodejs/node#30623)
        if (state1.events && state1.events.length === 3) {
          assert.deepStrictEqual(state1.events, [
            { name: 'close', args: [] },
            { name: 'data', args: [data1] },
            { name: 'end', args: [] },
          ]);
        } else {
          assert.deepStrictEqual(state1.events, [
            { name: 'close', args: [] },
            { name: 'data', args: [data1] },
            { name: 'end', args: [] },
            { name: 'close', args: [] },
          ]);
        }
        if (state2.events && state2.events.length === 3) {
          assert.deepStrictEqual(state2.events, [
            { name: 'data', args: [data2] },
            { name: 'close', args: [] },
            { name: 'end', args: [] },
          ]);
        } else {
          assert.deepStrictEqual(state2.events, [
            { name: 'data', args: [data2] },
            { name: 'close', args: [] },
            { name: 'end', args: [] },
            { name: 'close', args: [] },
          ]);
        }
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        events: ['close', 'data', 'end', 'error'],
        readPolicy: 'none',
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.end(data1);
      stream2.write(data2);
      stream2.emit('close');
      stream2.end();
      return promise;
    });
  });

  describe('.makeIncremental()', () => {
    it('makes incremental from a Buffer comparison function', () => {
      const data1 = [Buffer.from('hello'), Buffer.from('world')];
      const data2 = [Buffer.from('hello'), Buffer.from('there')];
      // Use of compareCount in this way is illustrative, but over-specified.
      // Callers shouldn't depend on this exact behavior.
      // If this test breaks, it may be rewritten in a less-strict way
      let compareCount = 0;
      const compareValue = false;
      function compareData(incData1, incData2) {
        assert.deepStrictEqual(incData1, data1[compareCount]);
        assert.deepStrictEqual(incData2, data2[compareCount]);
        compareCount += 1;
        // null/undefined means "continue comparing future data"
        return incData1.equals(incData2) ? null : compareValue;
      }
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }

      // Note:  objectMode to prevent write-combining
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const options = {
        compare,
        incremental: streamCompare.makeIncremental(compareData),
      };
      const promise = streamCompare(stream1, stream2, options)
        .then((value) => {
          assert.strictEqual(value, compareValue);
        });

      stream1.write(data1[0]);
      stream2.write(data2[0]);
      stream1.end(data1[1]);
      stream2.end(data2[1]);

      return promise;
    });

    it('makes incremental from an event comparison function', () => {
      const compareValue = false;
      function compareEvents(incEvents1, incEvents2) {
        assertInstanceOf(incEvents1, Array);
        assertInstanceOf(incEvents2, Array);

        try {
          assert.assert.deepStrictEqual(incEvents1, incEvents2);
          // null/undefined means "continue comparing future data"
          return null;
        } catch {
          return compareValue;
        }
      }
      function compare(state1, state2) {
        throw new Error('compare shouldn\'t be called');
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental: streamCompare.makeIncremental(null, compareEvents),
      };
      const promise = streamCompare(stream1, stream2, options)
        .then((value) => {
          assert.strictEqual(value, compareValue);
        });

      stream1.emit('close');
      stream1.end();
      stream2.end();

      return promise;
    });

    it('removes inconclusive data before compare', () => {
      function compare(state1, state2) {
        assert.strictEqual(state1.data.length, 0);
        assert.strictEqual(state2.data.length, 0);
      }

      // Note:  objectMode to prevent write-combining
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const options = {
        compare,
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
      return promise;
    });

    // This test is primarily for testing empty string state handling internals
    it('removes inconclusive string data before compare', () => {
      function compare(state1, state2) {
        assert.strictEqual(state1.data.length, 0);
        assert.strictEqual(state2.data.length, 0);
      }

      const streamOptions = {
        encoding: 'utf8',
        // Note:  objectMode to prevent write-combining
        objectMode: true,
      };
      const stream1 = new stream.PassThrough(streamOptions);
      const stream2 = new stream.PassThrough(streamOptions);
      const options = {
        compare,
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.write('hello');
      stream1.end(' world');
      stream2.write('hello');
      stream2.end(' world');
      return promise;
    });

    it('removes inconclusive events before compare', () => {
      function compare(state1, state2) {
        assert.strictEqual(state1.events.length, 0);
        assert.strictEqual(state2.events.length, 0);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        compare,
        incremental: streamCompare.makeIncremental(
          assert.deepStrictEqual,
          assert.deepStrictEqual,
        ),
      };
      const promise = streamCompare(stream1, stream2, options);
      stream1.emit('close');
      stream1.end();
      stream2.emit('close');
      stream2.end();
      return promise;
    });

    it('doesn\'t return early due to incompleteness', () => {
      // Note:  objectMode to prevent write-combining
      const stream1 = new stream.PassThrough({ objectMode: true });
      const stream2 = new stream.PassThrough({ objectMode: true });
      const options = {
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      let isDone = false;
      const promise = streamCompare(stream1, stream2, options).then(() => {
        isDone = true;
      });
      stream1.write('he');
      stream2.write('hel');
      stream1.end('llo');
      stream2.write('l');

      setImmediate(() => {
        assert.strictEqual(isDone, false);
        stream2.end('o');
      });

      return promise;
    });

    it('returns early if streams differ before ending', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
      stream1.write('hello');
      stream2.write('hella');
      return promise;
    });

    it('returns early if stream ends early', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end('hell');
      return promise;
    });

    it('returns early if stream ends empty', () => {
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const options = {
        incremental: streamCompare.makeIncremental(assert.deepStrictEqual),
      };
      const promise = streamCompare(stream1, stream2, options).then(
        neverCalled,
        (err) => { assertInstanceOf(err, assert.AssertionError); },
      );
      // stream1 writes more data than stream2 but doesn't end
      stream1.write('hello');
      stream2.end();
      return promise;
    });

    // Note:  Avoids throwing from compare since 'error' gets thrown and caught
    // outside of the constructor.
    it('compares buffered different-data streams as not equal', () => {
      const incrementalVal = false;
      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      stream1.end('hello');
      stream2.end('world');
      return new Promise((resolve, reject) => {
        setImmediate(resolve);
      }).then(() => {
        const options = {
          compare: function compare(state1, state2) {
            throw new Error('compare shouldn\'t be called');
          },
          incremental: function incremental(state1, state2) {
            return incrementalVal;
          },
        };
        return streamCompare(stream1, stream2, options);
      }).then((result) => {
        assert.strictEqual(result, incrementalVal);
      });
    });
  });
});

describe('Promise', () => {
  describe('#checkpoint()', () => {
    it('does a non-incremental comparison and resolves on result', () => {
      let compareCalled = false;
      const compareValue = false;
      function compare(state1, state2) {
        if (compareCalled) {
          queueMicrotask(() => {
            throw new Error('compare called multiple times');
          });
        }
        compareCalled = true;
        return compareValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      setImmediate(() => {
        assert.strictEqual(compareCalled, false);
        promise.checkpoint();
        assert.strictEqual(compareCalled, true);
      });

      return promise.then((value) => {
        assert.strictEqual(value, compareValue);

        stream1.end();
        stream2.end();

        // Delay to ensure compare is not called
        return new Promise((resolve, reject) => {
          setImmediate(resolve);
        });
      });
    });

    it('does not resolve for compare non-result', () => {
      let compareValue;
      function compare(state1, state2) {
        return compareValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      let ended = false;
      const promise2 = promise.then(() => {
        ended = true;
      });

      return new Promise((resolve, reject) => {
        setImmediate(() => {
          assert.strictEqual(ended, false);
          promise.checkpoint();

          setImmediate(() => {
            assert.strictEqual(ended, false);

            stream1.end();
            stream2.end();

            resolve(promise2);
          });
        });
      });
    });

    it('can compare before reading', () => {
      let compareCount = 0;
      const compareValue = false;
      function compare(state1, state2) {
        compareCount += 1;
        return compareValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      const testData = Buffer.from('test');

      promise.checkpoint();

      // Test that data written after end is not read by StreamComparison
      stream1.write(testData);
      stream2.write(testData);

      return promise.then((value) => {
        assert.strictEqual(value, compareValue);

        return new Promise((resolve, reject) => {
          setImmediate(() => {
            assert.strictEqual(compareCount, 1);

            assert.deepStrictEqual(stream1.read(), testData);
            assert.deepStrictEqual(stream2.read(), testData);

            resolve();
          });
        });
      });
    });

    it('does not compare after resolving', () => {
      let ended = false;
      function compare(state1, state2) {
        assert.strictEqual(ended, false);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      stream1.end();
      stream2.end();

      return promise.then((value) => {
        ended = true;
        promise.checkpoint();
      });
    });

    it('can take the place of the final compare', () => {
      let ended = false;
      const compareValue = false;
      function compare(state1, state2) {
        if (ended) {
          queueMicrotask(() => {
            throw new Error('compare called after end');
          });
        }
        return compareValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      let endCount = 0;
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

      return promise.then((value) => {
        assert.strictEqual(value, compareValue);
        ended = true;

        // Delay to ensure compare is not called
        return new Promise((resolve, reject) => {
          setImmediate(resolve);
        });
      });
    });
  });

  // Note:  Testing is lighter since most code paths shared with #checkpoint()
  describe('#end()', () => {
    it('does a non-incremental compare and ends on non-result', () => {
      let compareValue;
      function compare(state1, state2) {
        return compareValue;
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);
      promise.end();
      return promise;
    });

    it('does not compare after resolving', () => {
      let ended = false;
      function compare(state1, state2) {
        assert.strictEqual(ended, false);
      }

      const stream1 = new stream.PassThrough();
      const stream2 = new stream.PassThrough();
      const promise = streamCompare(stream1, stream2, compare);

      stream1.end();
      stream2.end();

      return promise.then((value) => {
        ended = true;
        promise.end();
      });
    });
  });
});
