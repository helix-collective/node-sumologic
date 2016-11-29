var assert = require('assert');
var sinon = require('sinon');
var chai = require('chai')
  , expect = chai.expect;
var SumoLogger = require('../sumo.js');

function newTestSumoLogger(fakeRequest) {
  return new SumoLogger('FAKE-COLLECTOR-CODE', fakeRequest);
}

describe('Sumo Logic Collector', function() {
  var clock;
  beforeEach(function() { clock = sinon.useFakeTimers(); })
  afterEach(function() { clock.restore(); })

  function requestShouldntBeCalled() {
    throw new Error("Unexpected call to request");
  }

  it("No sync for first second", function () {
    var sumologic = newTestSumoLogger(requestShouldntBeCalled);
    sumologic.log("log line");

    clock.tick(1);
    clock.tick(998);
  });

  it("No sync if there's no log data", function () {
    var sumologic = newTestSumoLogger(requestShouldntBeCalled);

    clock.tick(1);
    clock.tick(1000);
    clock.tick(1000);
  });

  it("Only one in progress request at any time", function () {
    var count = 0
    var sumologic = newTestSumoLogger(function() {
      count += 1;
      assert.equal(1, count);
    });

    sumologic.log("log line");

    // First call to request
    clock.tick(1000);

    // Shouldn't call request, as we have an active call
    clock.tick(1000);
  });

  it("Failed requests should be retried first", function () {
    var expectedBody = ''
    var sumologic = newTestSumoLogger(function(opts, cb) {
      assert.equal(expectedBody , opts.body);
      cb("some error");
    });

    sumologic.log("log line");

    // First call to request, we should get a single line
    expectedBody = '{"level":"INFO","data":"log line"}',
    clock.tick(1000);

    // Retry attempt - should have the same body as the previous request
    expectedBody = '{"level":"INFO","data":"log line"}',
    clock.tick(1000);

    // Third retry attempt, should have 2 lines to sync (the original and the new line just added)
    sumologic.log("new log line");
    expectedBody = '{"level":"INFO","data":"log line"}\n{"level":"INFO","data":"new log line"}'
    clock.tick(1000);
  });

  it("Non 200/300 status codes are treated as errors", function () {
    var expectedBody = '';
    var nextStatus = 0;
    var sumologic = newTestSumoLogger(function(opts, cb) {
      assert.equal(expectedBody, opts.body);
      cb(undefined, {status: nextStatus});
    });

    sumologic.log("log line");

    // First call to request, we should get a single line
    nextStatus = 100;
    expectedBody = '{"level":"INFO","data":"log line"}';
    clock.tick(1000);

    // Retry attempt - should have the same body as the previous request
    nextStatus = 400;
    expectedBody = '{"level":"INFO","data":"log line"}';
    clock.tick(1000);

    // Third retry attempt, should have 2 lines to sync (the original and the new line just added)
    sumologic.log("new log line");
    nextStatus = 500;
    expectedBody = '{"level":"INFO","data":"log line"}\n{"level":"INFO","data":"new log line"}'
    clock.tick(1000);

    // attempts from now on sync all data, then request should no longer be called (as there are no log lines)
    nextStatus = 200;
    expectedBody = '{"level":"INFO","data":"log line"}\n{"level":"INFO","data":"new log line"}'
    clock.tick(1000);

    nextStatus = 200;
    expectedBody = "ERROR, request shouldn't be called anymore";
    clock.tick(1000);
  });

  it("Expected happy case of a few logs being synced every tick", function () {
    var expectedLogLines = [];
    var sumologic = newTestSumoLogger(function(opts, cb) {
      expect(opts.body.split('\n')).to.deep.equal(expectedLogLines);
      cb(undefined, {status: 200});
    });

    function logLine(line) {
      expectedLogLines.push(JSON.stringify({level: 'INFO', data: line}));
      sumologic.log(line);
    }

    function runSync() {
      clock.tick(1000);
      expectedLogLines = [];
    }

    logLine("msg 1");
    logLine("msg 2");
    logLine("msg 3");
    runSync();

    logLine("msg 3");
    runSync();

    logLine("msg 4");
    logLine("msg 5");
    logLine("msg 6");
    logLine("msg 7");
    runSync();
  });

  it("Exercise safeToString", function () {
    var expectedBody = ''
    var sumologic = new SumoLogger(function(opts, cb) {
      expect(opts.body).to.equal(expectedBody);
      cb(undefined, {status: 200});
    });

    function checkObject(line, expected) {
      expectedBody = expected || JSON.stringify({level: 'INFO', data: line});
      sumologic.log(line);
      clock.tick(1000);
    }

    checkObject("msg 1");
    checkObject({});

    // circular refs will confuse JSON.stringify, fallback to toString
    x = {};
    x.y = x;
    checkObject(x, '{"level":"INFO","data":"[object Object]"}');

    // Finally, check errors in toString are handled
    function TestObj() { }
    TestObj.prototype.toJSON = function() { throw new Error(); }
    TestObj.prototype.toString = function() { throw new Error(); }
    checkObject(new TestObj(), '{"level":"INFO","data":"error serializing log line"}');
  });

  it("Ensure log lines are valid json", function () {
    var expected = {};
    var sumologic = newTestSumoLogger(function(opts, cb) {
      expect(JSON.parse(opts.body)).to.deep.equal({level: "INFO", data: expected});
      cb(undefined, {status: 200});
    });

    function check(obj) {
      expected = obj;
      sumologic.log(obj);
      clock.tick(1000);
    }

    check("msg 1");
    check({some: "values", and: "keys"});
    check([1,2,3,4]);

    function checkVarargs(obj1, obj2) {
      expected = [obj1, obj2];
      sumologic.log(obj1, obj2);
      clock.tick(1000);
    }

    checkVarargs("msg 1", "msg 2");
    checkVarargs("some string", {some: "values", and: "keys"});
    checkVarargs("some string", [1,2,3,4], {});
  });

  it("Re-writes console.log correctly", function () {
    var expected = {};
    var sumologic = newTestSumoLogger(function(opts, cb) {
      expect(JSON.parse(opts.body)).to.deep.equal({level: "INFO", data: expected});
      cb(undefined, {status: 200});
    });

    function check(obj) {
      expected = obj;
      try {
        sumologic.replaceConsole();
        console.log(obj);
      } finally {
        sumologic.restoreConsole();
      }
      clock.tick(1000);
    }

    check("msg 1");
    check({some: "values", and: "keys"});
    check([1,2,3,4]);
  });

  it("Augments console correctly", function () {
    var expected = {};
    var sumologic = newTestSumoLogger(function(opts, cb) {
      expect(JSON.parse(opts.body)).to.deep.equal({level: "INFO", data: expected});
      cb(undefined, {status: 200});
    });
    sumologic.augmentConsole();

    sinon.spy(sumologic, 'log');
    sinon.spy(sumologic.stdConsole, 'log');
    console.log("msg 1", "msg 2");
    expect(sumologic.log.calledOnce, 'sumo/log').to.equal(true);
    expect(sumologic.stdConsole.log.calledOnce, 'console/log').to.equal(true);

    sinon.spy(sumologic, 'info');
    sinon.spy(sumologic.stdConsole, 'info');
    console.info("msg 1", "msg 2");
    expect(sumologic.info.calledOnce, 'sumo/info').to.equal(true);
    expect(sumologic.stdConsole.info.calledOnce, 'console/info').to.equal(true);

    sinon.spy(sumologic, 'warn');
    sinon.spy(sumologic.stdConsole, 'warn');
    console.warn("msg 1", "msg 2");
    expect(sumologic.warn.calledOnce, 'sumo/warn').to.equal(true);
    expect(sumologic.stdConsole.warn.calledOnce, 'console/warn').to.equal(true);

    sinon.spy(sumologic, 'error');
    sinon.spy(sumologic.stdConsole, 'error');
    console.error("msg 1", "msg 2");
    expect(sumologic.error.calledOnce, 'sumo/error').to.equal(true);
    expect(sumologic.stdConsole.error.calledOnce, 'console/error').to.equal(true);

    sinon.spy(sumologic, 'dir');
    sinon.spy(sumologic.stdConsole, 'dir');
    console.dir("msg 1", "msg 2");
    expect(sumologic.dir.calledOnce, 'sumo/dir').to.equal(true);
    expect(sumologic.stdConsole.dir.calledOnce, 'console/dir').to.equal(true);
  });
});
