var fs = require('fs')
var comm = require('./index.js')

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
//        reply.end({serverreply: 'done'})
        callback(undefined,new comm.Msg({serverreply:'done'}))
    })
    
    client.lobby.Allow({'*': true})
    client.subscribe({serverreply: 'done'}, function(msg,callback,reply) {
        callback(undefined,new comm.Msg({test: true, clientreply:'done'}))
    })
    
    server.subscribe({clientreply:'done'}, function() {
        //server.stop()
        client.stop()
        var client2 = new comm.nodes.TcpClientNode({port: 8888, name:'testclient2'})

        client2.lobby.Allow({'*': true})
        server.send({bla: 3})
        client2.subscribe({serverreply: 'done'}, function(msg,callback,reply) {
            server.send({bla: 3})
            client2.stop()
            server.send({bla: 3})
            server.stop()
            test.done()
        })

        client2.start(function (err) {
            if (err) { test.failed(); return }
            // send two messages
            client2.send(new comm.Msg({bla: true, lala: 22}))
            client2.send(new comm.Msg({test: { a : 'x', b: 3} , lalala: 22}))
            
        })
        
        //test.done()
    })
    
    client.start(function(err) {
        if (err) { test.failed(); return }
        // send two messages
        client.send(new comm.Msg({bla: true, lala: 22}))
        client.send(new comm.Msg({test: { a : 'x', b: 3} , lalala: 22}))
    })
}

