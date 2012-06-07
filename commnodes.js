var net = require('net')
var comm = require('./index.js')
var Msg = comm.Msg

// tcp node, tcp server and client subclass this
var TcpNode = comm.MsgNode.extend4000({    
    initialize: function() {
        if (!(this.port = this.get('port'))) { throw "I need a port" }
        this.SocketNode = (this.get('protocolNode') || PlainTcpSocket)
    },

    stop: function() {
        this.trigger('stop')
        this.parents.map(function(socketNode) { socketNode.remove() })
    }

})


// client and server nodes are almost the same, msg parsing logic is implemented in PlainTcpSocket
var TcpClientNode = TcpNode.extend4000({
    initialize: function() {
        this.host = ( this.get('host') || 'localhost' )
    },

    stop: function() {
        TcpNode.prototype.stop.apply(this)
        if (this.socket) {
            try {
                this.socket.end()
            } catch (err) {}
        }
    },

    start: function(callback) {
        try {
            var socket = this.socket = net.connect(this.port,this.host, function() {
                this.addparent(new this.SocketNode({socket: socket}))
            }.bind(this));
        } catch(err) {
            callback(true)
        }

        socket.on('connect',callback)

    }
})

var TcpServerNode = TcpNode.extend4000({
    initialize: function() {
        this.on('remove',this.stop.bind(this))
    },

    stop: function() {
        TcpNode.prototype.stop.apply(this)
        try {
            this.server.close()
        } catch(err) {}
    },

    start: function() {
        this.server = net.createServer(function(socket) {
            this.addparent(new this.SocketNode({socket: socket}))
        }.bind(this)).listen(this.port)
    }
})



// each tcpnode (tcpserver or client) have socket nodes as their children.
// socket nodes represent concrete connections, client tcp node has only one socket node as a child
var PlainTcpSocket = comm.MsgNode.extend4000({    

    initialize: function() {
        var socket
        if (!(socket = this.socket = this.get('socket'))) 
        { throw "I need a socket object in order to make sense" }
        
        // wait to be connected to your master node and then initialize yourself, 
        // this will be called immediately if your child has been set upon instantiation
        this.onchild(this.bindSocket.bind(this))

        this.children.on('remove', function() {
            if (!this.children.models.length) { this.remove() }
        }.bind(this))
    },

    // waits for a new line from the other side, and then tries to parse the JSON it received.
    // in case of invalid data, it dies
    bindSocket: function() {
        var self = this
        var socket = this.socket
        var maxbuffer = (this.get('maxbuffer') || 255)
        var buffer = ""

        this.on('remove', function() {
            socket.end()
        })

        socket.on('end', function() { this.remove() }.bind(this));

        socket.on('data', function(data) {
            buffer += data.toString('utf8')
            if (buffer.length > maxbuffer) { 
                this.log('tcpnode','warning','received too long message from client')
                this.remove()
                return
            }

            bufferChanged()

        }.bind(this))
        
        var master = this.getchild() // get the tcpnode that spawned you
        var origin = (master.get('origin') || master.get('name')) // origin is used to mark the messages received from this socket, in order to know which permissions those messages have.
        var id = this.get('id')

        // check if new line is received, if so, parse it, and send it out as a message
        function bufferChanged() {
            var sbuffer = buffer.split('\n')
            // didn't get a new line?
            if (sbuffer.length < 1) { return }
            // eat the buffer line by line until you reach the last line. last one is not parsed
            // until the new line character is received, and its fed back to the buffer
            while (sbuffer.length) {
                var msgJSON = sbuffer.shift()
                if (!sbuffer.length) { buffer = msgJSON; return } // last line?
                if (!msgJSON) { return }
                
                try {
                    var msg = new Msg(JSON.parse(msgJSON))
                }   
                catch(err) {
                    self.log('tcpnode','warning','received invalid JSON from client (' + err + ')')
                    self.remove()
                    return
                }

                msg.origin = origin

                // this is important, replyes to message will inherit the _viral attribute, 
                // this socketNode is subscribed to this _viral attribute so that it sends those messages back to the client.
                msg._viral = { tcp: id } 
                
                self.MsgIn(msg)

            }
        }
    },

    MsgOut: function(msg) {
        this.socket.write(msg.render() + "\n") // sends a new line delimited JSON message
    }
})


exports.TcpNode = TcpNode
exports.TcpClientNode = TcpClientNode
exports.TcpServerNode = TcpServerNode
exports.PlainTcpSocket = PlainTcpSocket