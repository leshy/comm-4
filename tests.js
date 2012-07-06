var fs = require('fs')
var comm = require('./index.js')
/*
exports.internalComm = function(test){
    var a = new comm.MsgNode()
    var b = new comm.MsgNode()
    
    a.addparent(b)

    var data = []

    a.lobby.Allow({'test': true})
    a.subscribe({"*" : true}, function(msg) { data.push(msg.render()) })

    // send two messages
    b.MsgIn( {bla: true, lala: 22} )
    b.MsgIn( {test: { a : 'x', b: 3 } , lalala: 22 } )

    test.equals('["{\\"test\\":{\\"a\\":\\"x\\",\\"b\\":3},\\"lalala\\":22}"]',JSON.stringify(data))
    
    test.done()
};

// spawn server and client, connect them and spark an interesting conversation.
exports.tcpComm = function(test) {

    var server = new comm.nodes.TcpServerNode({port: 8888, name:'testserver'})
//    server.debug = true
    server.start()
    
    var data = []
    
    server.lobby.Allow({'test': true})
    
    var client = new comm.nodes.TcpClientNode({port: 8888, name:'testclient'})
//    client.debug = true

    server.subscribe({"test" : true}, function(msg,callback,reply) { 
        reply.write({serverreply: 333})
        callback(undefined,new comm.Msg({serverreply:'done'}))
    })
    
    client.lobby.Allow({'*': true})
    client.subscribe({serverreply: 'done'}, function(msg,callback,reply) {
        callback(undefined,new comm.Msg({test: true, clientreply:'done'}))
    })
    
    server.subscribe({clientreply:'done'}, function() {
        server.remove()
        client.remove()
        test.done()
    })


    client.start(function(err) {
        if (err) { test.failed(); return }
        // send two messages
        client.send(new comm.Msg({bla: true, lala: 22}))
        client.send(new comm.Msg({test: { a : 'x', b: 3} , lalala: 22}))
        //client.send(new comm.Msg({howmanytimeswillthisrepeat: 4148} ))
        //client.send(new comm.Msg({howmanytimeswillthisrepeat: 414} ))

    })
}

*/




exports.sending = function(test){
    var a = new comm.MsgNode({name:'a'})
    var b = new comm.MsgNode({name:'b'})
    a.debug = true
    b.debug = true
    a.addparent(b)

    var data = []

    a.lobby.Allow({'test': true})
    b.lobby.Allow({'*': true})
    
    b.MsgIn( {test: { a : 'x', b: 3 } , lalala: 22 } )
    
    a.subscribe({"*" : true}, function(msg,callback,reply) { 
        //reply.write({blalal: 15125})
        callback(undefined,{ lalala : 666 })
    })


}

