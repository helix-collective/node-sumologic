// Log to sumo logic directly

var _ = require('underscore');

function safeToString(obj) {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    try {
      return JSON.stringify(String(obj));
    } catch (err) {
      return JSON.stringify('error serializing log line');
    }
  }
}

module.exports = function SumoLogger(collectorCode, opts) {
  var me = this;

  opts = opts || {};
  var endpoint = opts.endpoint || "https://collectors.au.sumologic.com/receiver/v1/http/";
  var request = opts.request || require('request');
  var collectorEndpoint = endpoint + collectorCode;
  var syncInterval = opts.syncInterval || 1000;

  me.stdConsole = {
    log: console.log,
    info: console.info,
    error: console.error,
    warn: console.warn
  }
  me.replaceConsole = function() {
    console.log = me.log;
    console.info = me.info;
    console.error = me.error;
    console.warn = me.warn;
  }

  me.restoreConsole = function() {
    console.log = me.stdConsole.log;
    console.info = me.stdConsole.info;
    console.error = me.stdConsole.error;
    console.warn = me.stdConsole.warn;
  }

  me.augmentConsole = function() {
      console.log = function() {
          me.stdConsole.log.apply(this, arguments);
          me.log.apply(this, arguments);
      }
      console.info = function() {
          me.stdConsole.info.apply(this, arguments);
          me.info.apply(this, arguments);
      }
      console.warn = function() {
          me.stdConsole.warn.apply(this, arguments);
          me.warn.apply(this, arguments);
      }
      console.error = function() {
          me.stdConsole.error.apply(this, arguments);
          me.error.apply(this, arguments);
      }
  }

  // Cache of entries we are yet to sync
  var unsynced = [];

  function append(lvl, args) {
    var stringifyArgs = _.map(args, function(a) {
      return safeToString(a);
    });

    // In the common case of a single log value, pull it out. It's easier in sumo
    // logic to traverse known object graphs without arrays, especially at the
    // top level
    var data = ''
    if (stringifyArgs.length == 1) {
      data = stringifyArgs[0];
    } else {
      data = '[' + stringifyArgs.join(', ') + ']';
    }

    unsynced.push('{"level":' + JSON.stringify(lvl) + ',"data":' + data + '}');
  }

  // I want arguments to be treated as an object (helps indexing into the correct fields on sumo logic)
  me.log = function() { append('INFO', arguments); };
  me.info = function() { append('INFO', arguments); };
  me.error = function() { append('ERROR', arguments); };
  me.warn = function() { append('WARN', arguments); };

  var numBeingSent = 0;
  var maxLines = 100;

  // explicit decision to *not* use debounce/throttle so the syncing code is
  // explicit, and it's possible for a human to prove it's correctness
  var syncer = setInterval(function() {
    // Only one active sync at any given interval
    if (numBeingSent > 0) {
      return;
    }

    // Short-circuit if there is nothing to send
    if (unsynced.length == 0) {
      return;
    }

    var logLines = unsynced.slice(0, maxLines);
    var body = logLines.join('\n')
    numBeingSent = logLines.length;

    // Sync logs to sumo-logic, and clear all synced data. On failure we'll retry the sync
    request({
      method: 'POST',
      url: collectorEndpoint,
      body: body,
    }, function(error, response) {
      var failed = !!error ||
        response.status < 200 ||
        response.status >= 400;

      if (!failed) {
        unsynced.splice(0, numBeingSent);
      }

      numBeingSent = 0;
    })
  }, syncInterval);
}
