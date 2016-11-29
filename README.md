# node-sumologic

A well tested, drop-in replacement for console.log that syncs logs directly to Sumo Logic via their
HTTP api (as opposed to using their collectors)

## Installation
npm install sumologic

## Usage

```
var SumoLogger = require('sumologic')

// Optional opts
var opts = {
   request // wrapper around https://www.npmjs.com/package/request (useful for testing)
   endpoint // default https://collectors.au.sumologic.com/receiver/v1/http/, change again mostly to aid testing/debugging
   syncInterval // how often we should sync to sumo logic (default ever second)
};

var logger = new SumoLogger('SUMOLOGIC-HTTP-COLLECTOR-CODE' /*, opts */);

// optional - if you would like console.log to go to sumo logic
logger.replaceConsole()

// optional - if you would like console.log to go to sumo logic and stdout
logger.augmentConsole()

logger.log("Yeah, it worked");
```
