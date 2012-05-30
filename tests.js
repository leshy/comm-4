var fs = require('fs')
var comm = require('./index.js')


exports.testSomething = function(test){
    test.expect(1);
    test.ok(true, "this assertion should pass");
    test.done();
};



exports.basicComm = function(test){
    var a = new MsgNode()
    var b = new MsgNode()
    
    a.addparent(b)

    a.lobby.allow({test: true})
    
    b.msgIn

    test.expect(1);
    test.ok(true, "this assertion should pass");
    test.done();
};
