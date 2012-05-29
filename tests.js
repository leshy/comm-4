var fs = require('fs')
var comm = require('./index.js')


exports.testSomething = function(test){
    test.expect(1);
    test.ok(true, "this assertion should pass");
    test.done();
};
