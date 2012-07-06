
var decorators = require('decorators')
var _ = require('underscore')
var decorate = decorators.decorate
var comm = require('comm4')

var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''); 

function uuid (len) { 
    if (!len) { len = 20 }
    var uuid = []
    charlen = chars.length
    for (var i = 0; i < len; i++) uuid[i] = chars[ 0 | Math.random() * charlen ];
    return uuid.join('')
}

function toArray(arg) { return Array.prototype.slice.call(arg); }

function Msg(data) {
    var self = this;
    _.extend(this,data)
    if (!this._meta) { this._meta = {} }
    var id 
    if (!this._meta.id) { id = this._meta.id = uuid() }
    if (!this._meta.queryid) { this._meta.queryid = id }
}

// metadecorator for message receiving functions, 
// it just subclasses a message class if it receives a plain dictionary
// used to be able to call bla.send({lala: 3}) instead of bla.send(new Msg({lala:3}))
var MakeObjReceiver = function(objclass) {
    return function() {
        var args = toArray(arguments);
        var f = args.shift();
        if ((!args.length) || (!args[0])) { f.apply(this,[]); return }
        if (args[0].constructor != objclass) { args[0] = new objclass(args[0]) }
        return f.apply(this,args)
    }
}

// creates an appropriate reply message for this message,
// (populates _viral, queryid and such)
Msg.prototype.makereply = decorate(MakeObjReceiver(Msg),function(msg) {
    if (!msg) { return }
    msg._meta.queryid = this._meta.queryid
    msg._meta.replyto = this._meta.id
//    msg._viral = _.extend(msg._viral,this._viral)
    return msg
})

Msg.prototype.export = function() { 
    var data = _.clone(this)    
    return data
}

Msg.prototype.render = function() { 
    return JSON.stringify(this.export())
}

function timeit(f) {
    var time1 = new Date().getTime()
    f()
    var time2 = new Date().getTime()
    return time2 - time1
}

var x = new Msg({test: 3, blabla: "tralala" })

console.log(x)
console.log(x.makereply({ thisisareply: true }))




//
// a protocol could be defined as a wrapper for 'reply' object
//

var node1 = comm.MsgNode({ })

var node2 = comm.MsgNode({ })

node2.addparent(node1)

var reply = node1.MsgOut({test: 1})

reply.read(function(msg,response) {
    // when querydone msg is received, this fun is called with undefined in place of a response
    console.log('got',msg)
})



node2.subscribe({test: true}, function(msg,response) {
    response.write({lala:1})
    response.write({lala:2})
    
    var reply = response.write({lala:3})
    // response.write == node2.MsgOut(msg.makereply(...))
    
    response.end({lala:4})
    // smthing like this
    // node2.MsgOut(new Msg({ _meta: { querydone: msg._meta.queryid }}))
})



//
// nodes defined as connectors inherit filters of their parents... (websocket node, tcp node, etc)
//




