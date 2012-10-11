// notes from comm framework 3:
//
// Permissions - it could accept a JSON schema instead of just attribute list
//
// What if multiple talkers respond to a message? List of messages should be sent in one shot. 
// this will allow for transports like http to send multiple responses, instead of sending first and closing the connection.
// - SOLVED
//
// objecttalker should have different buckets for different object types
// it should be more symmetric. I'd like for clients to be able to create new objects.
//
// abstract permissions/output/input/persist
//
// there should be no difference between objectsync receiving an object from db or from remote host
// another reason for symetric input/output
//
// make it so that comm elements can be remote/persistable objects
// figure out the initialization (phonebook for example)
// callbacks are super ugly
//

// remove lobby -> implement data containing graph edges and use them to contain subscription data
//  - lobby is a graph edge already (almost) no need for this.
// - SOLVED

// responses of children -> switch to functions with callbacks, use async.parallel
// - SOLVED

// each msgparser could return an iterator object? SWEET
// - SOLVED SORTA

var Backbone = require('backbone4000');
var _ = require('underscore');
var decorators = require('decorators');
var decorate = decorators.decorate;
var graph = require('graph')
var async = require('async')
var BSON = require('mongodb').BSONPure
var fs = require('fs')

var helpers = require('helpers')
var requirejs = require('requirejs');

var expression = fs.readFileSync(__dirname + '/shared.js','utf8');
eval(expression)


// --------------------------------------------- SNIP
var DbCollection = Collection.extend4000({
    defaults: { 
        name: 'dbcollection',
        db: undefined,
        collection: undefined,
        logger: undefined
    },

    initialize: function() {
        var db = this.get('db')
        var collection = this.get('collection')
        var self = this;
        this.l = this.get('logger')

        if (!db || !collection) { throw ("What is this I don't even (" + this.get('name') + ")" )}
        
        // resolve collection if you only have its name
        if (collection.constructor === String) {
            db.collection(collection, function (err,real_collection) {
                self.log('db','collection','collection "' + collection + '" open.')
                self.set({collection: real_collection})
            })
        }
    },
    
    log: function() { if (this.l) { this.l.log.apply(this.l,arguments) } },

    find: function(filter,limits,callback) {
        var self = this;
        if (!limits) { limits = {} }
        this.get('collection').find(filter,limits,callback)
    },
    
    create: function(data,callback) { 
        var model = this.get('model')
        console.log("db create", data)
        this.get('collection').insert(data,callback)
    },

    remove: function(find,callback) {
        this.get('collection').remove(find,callback)
    },

    update: function(select,data,callback) {
        this.get('collection').update(select, { '$set' : data }, callback)
    }
})

// sweet jesus! this receives mongodb query cursor and collection exposer
// and creates a fake 'cursor' that returns instances of models instead of just raw data
// I know what you are thinking, its: sweet jesus!
var ModelIterator = function(resolveModel,cursor) {
    this.resolveModel = resolveModel
    this.cursor = cursor
}

// I need an implementation of an abstract async iterator,
// that takes an object that implements a next method 
// and builds an object that supports a shitload of functions, like each, map, reduce, etc.
// for now, I'll just implement each myself and thats it folks.
// btw new implementation of javascript supports iterators natively apparently
ModelIterator.prototype.each = function(callback) {
    var self = this
    this.cursor.each(function(err,data) {
        if (!data) { callback(undefined); return }
        var model = self.resolveModel(data)
        var instance = new model(data)
        callback(instance)
    })
}


ModelIterator.prototype.toArray = function (callback) { 
    var self = this;
    this.cursor.toArray(function (err,data) {
        if (err) { callback(err) ; return }
        
        callback(undefined, _.map(data, function (entry) { 
            var model = self.resolveModel(data)
            return new model(entry)
        }))
    })
}


ModelIterator.prototype.next = function(callback) {
    var self = this
    this.cursor.nextObject(function(err,data) {
        if (!data) { callback();return }
        var model = self.resolveModel(data)
        var instance = new model(data)
        callback(err,instance)
    })
}

/* this is cute but not so easy to understand. written the passthroughs by hand.
var passThrough decorate(decorators.MultiArg, function (name) {
    ModelIterator.prototype[name] = function () { this.cursor[name].apply(this.cursor,arguments) }    
})

passThrough('skip','count')
*/

ModelIterator.prototype.skip = function () { this.cursor.skip.apply(this.cursor,arguments) }
ModelIterator.prototype.count = function () { this.cursor.count.apply(this.cursor,arguments) }


// CollectionExposers are mixed in with Collection models in order to make them able to answer to messages to create/query/modify the collection models

// LIKE SO:
/*

        var collection = new (Backbone.Model.extend4000(
            comm.JsonCollectionExposer, 
            comm.DbCollection,
            {
                defaults: {
                    name: name + "Collection",
                    db: env.db, 
                    collection: name, 
                    logger: env.l
                },
            }))()

*/



var ModelCollectionExposer = MsgNode.extend4000({
    
    
})


// this one is made for MONGODB collection, but any collection with methods find update and remove that returns JSON will work.
var JsonCollectionExposer = MsgNode.extend4000({
    defaults: { store: undefined,
                accesslevel: 'nobody',
                name: 'collectionexposer',
                permissions: {},
                types: undefined
              },

    initialize: function() {
        this.set({types: {} })
        

        var collectionName = this.get('collection')

        if (collectionName.constructor == Object) { 
            collectionName = collectionName.collectionName
        } else if (collectionName.constructor != String) { 
            throw "wtf is this, my collection is set to a " + typeof(collectionName) + " (" + collectionName + ")"
        }

        this.lobby.Allow({collection: collectionName})
        this.subscribe({filter: true}, this.filterMsg.bind(this))
        this.subscribe({create: true}, this.createMsg.bind(this))
        this.subscribe({update: true}, this.updateMsg.bind(this))
        this.subscribe({remove: true}, this.removeMsg.bind(this))
    },

    //
    // SO, a collectionExposer has models it instantiates when it gets the data from the collection
    // collection can have a single model, (defined in its model attribute)
    // OR if multiple models are defined, they need to be named, and each db entry has to have a
    // 'type' field set to a name of the correct model
    //
    // (check this.resolveModel function)
    // 
    // definemodel function accepts definition of a backbone model, and optionally the name,
    // if there is more then one model defined in the exposer, 
    // it will fail if you didn't supply the name
    // 
    defineModel: function() {
        var args = helpers.toArray(arguments)
        
        var name = undefined
        
        if (args.length > 1) { name = args.shift() }        
        var definition = _.last(args)

        // so that a remotemodel knows who to contact about its changes
        definition.defaults.owner = this        

        // maybe in I won't insist on this in the future.. 
        // no permissions could meen save/share everything.
        if (!definition.defaults.permissions) { throw 'model needs to have its permissions defined' }
        if (!definition.defaults.permissions.store) { throw 'model needs to have its "store" permissions defined so that I know how to save it' }        

        // need to figure out a name for this model, and set it to defaults.type
        // this is such a common thing, I should pby implement/find the implementation of
        // some kind of arguments parser
        if (!definition.defaults.type) {
            if (name) {
                definition.defaults.type = name
            } else {
                definition.defaults.type = name = 'default'
            }
        } else {
            if (name && (name != definition.defaults.type)) {
                throw "you've specified a name for a model and its type and they are different. they are supposed to be the same thing bro."
            }
            name = definition.defaults.type
        }
        
        // build new model
        
        var model = RemoteModel.extend4000.apply(RemoteModel,args)

        
        
        // now we need to figure out how to hook it up to the collection        
        var types = this.get('types')
        
        // this collection has only one model for now, just save it as a model attribute
        if (!(_.keys(types).length) && !(this.get('model'))) { 
            this.set({model : model})
            return model
        }
        
        // we have more then one model

        if (types[name]) { throw "Model with a type " + name + " in a collection " + this.get('name') + " already defined" }

        // we'll need to write the type value to a db
        model.prototype.defaults.permissions.store.type = 1
        
        // first model needs to write its type down too
        // (not really, modelresolver would figure it out as this is a default model
        // but still, for clarity in the db I want to write it down)
        if (!(_.keys(types).length) && (this.get('model'))) { 
            var oldmodel = this.get('model')
            oldmodel.prototype.defaults.permissions.store.type = 1
            //types[oldmodel.prototype.defaults.type] = oldmodel
        }
        
        // finally, add the definition of a model to a collectionExposer
        types[name] = model

        return model
    },

    getOne: function (filter,callback) {
        this.filterModels(filter,function (err,cursor) {
            cursor.next(function (err,data) {
                callback(err,data)
            })
        })
    },

    filterModels: function(filter,callback,limits) {
        var self = this

        if (!limits) { limits = {} }
        this.filter(filter,limits,function(err,cursor) {
            if (err) { callback(err); return }
            callback(err, new ModelIterator(self.resolveModel.bind(self),cursor), cursor)
        })
    },
    
    removeModels: function (filter,callback) {
    },
    
    removeMsg: function(msg,callback) {
        var self = this
            // this should be abstracted, filtermsg, and updatemsg use the same thing
            if (msg.remove.id) { 
                msg.remove._id = msg.remove.id; delete msg.remove['id'] 
            }
            
            if (msg.remove._id) {
                msg.remove._id = new BSON.ObjectID(msg.remove._id)
            }

        function notifyModels (callback) {
            self.filterModels(msg.remove,function (err,cursor) {
                cursor.each(function (model) {
                    if (model) { model.trigger('remove') } else { callback(); return }
                })
            })
        }
        
        
        notifyModels(function () {
            self.remove(msg.remove, function(err,res) {
                callback()
            })
        })
    },

    filterMsg: function(msg,callback,response) { 
        var self = this;
        var origin = msg.origin
        if (!msg.limits) { msg.limits = {} }
        
        this.filterModels(msg.filter,function(err,cursor,mongocursor) {

            async.series(
            [
                function(callback) {
                    mongocursor.count(function(err,data) {
                        response.write(new Msg({totalentries: data }))
                        callback()
                    })
                },
                
                function(callback) {
                    cursor.each(function(instance) {
                        if (!instance) { callback(); return }
                        response.write({o: instance.render(origin) })
                    })}
            ],
                function() {
                    response.end()
                })
            
        },msg.limits )
    },

    updateMsg: function(msg,callback) {
        var self = this;
        /*
        var model = this.resolveModel(msg.update)
        var err;
        if (!model) { throw "didn't get anything from resolvemodel function" }
        if ((err = model.prototype.verifypermissions.apply(this,[msg.origin,msg.update])) !== false) {
            callback(err)
            return
        }
        */        
        if (!msg.select) {
            msg.select = { _id: msg.update.id }
        }
        
        if (msg.update.id) {
            delete msg.update['id']
        }
        
        if (msg.select.id) { 
            msg.select._id = msg.select.id; delete msg.select['id'] 
        }        
        
        if (msg.select._id && (msg.select._id.constructor == String)) {
            msg.select._id = new BSON.ObjectID(msg.select._id)
        }
        
        //console.log('updatemsg',msg.select,msg.update)

        // call hooks on models
        this.filterModels(msg.select,function (err,cursor,mongocursor) {  
            cursor.each(function (instance) {
                if (!instance) { return }
//                var previous = {}
//                _.map(msg.update,function (value,key) { previous[key] = instance.attributes[key] })
                instance.set(msg.update)
                instance.trigger('dbupdate',instance,{changes: msg.update})
            })
        })

        this.update(msg.select,msg.update, function(err,data) {
            callback(new Msg({ success: true }))
        })
    },

    createMsg: function(msg,callback) { 
        var model = this.resolveModel(msg.create)
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.origin,msg.create])) !== false) {
            callback(err)
            return
        }

        var instance = new model(msg.create)
        instance.trigger('precreate')
        // this feels a bit upside down, maybe instance.flush should be called here?
        // also, maybe accept instance as O in messages
        this.create(instance.render('store'),function(err,data) { 
            instance.trigger('create')
            callback(err,new Msg({created:String(data[0]._id)}))
        })
    }
})



exports.Msg = Msg
exports.MsgNode = MsgNode
exports.RemoteModel = RemoteModel
exports.DbCollection = DbCollection
exports.JsonCollectionExposer = JsonCollectionExposer
exports.ModelCollectionExposer = ModelCollectionExposer
exports.MsgSubscriptionManAsync = MsgSubscriptionManAsync

exports.nodes = {}

/*
var ConnectionNode = MsgNode.extend4000({
    queryFilters: function() {
        
    },

    receiveFilters: function(filters) {
        var self = this;
        _.map(filters, function(filter) {
            this.lobby.Allow(filter)
        }.bind(this))
    }
})

*/


var net = require('net')

// tcp node, tcp server and client subclass this
var TcpNode = MsgNode.extend4000({    
    initialize: function() {
        if (!(this.port = this.get('port'))) { throw "I need a port" }
        this.SocketNode = (this.get('protocolNode') || PlainTcpSocket)
    },

    stop: function() {
        this.trigger('remove')
    }
})


// client and server nodes are almost the same, msg parsing logic is implemented in PlainTcpSocket
var TcpClientNode = TcpNode.extend4000({
    defaults: { name: "tcpclientnode", origin: "tcp" },
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
                this.addparent(new this.SocketNode({socket: socket, id: this.get('name')}))
            }.bind(this));
        } catch(err) {
            callback(true)
        }

        socket.on('connect', callback)
    },

    send: function(msg) {
        var socket = this.getparent()
        if (socket) { socket.send(msg) }
    }
})

var TcpServerNode = TcpNode.extend4000({
    defaults: { name: "tcpservernode", origin: "tcp" },
    
    stop: function() {
//        console.log('server stop')
        TcpNode.prototype.stop.apply(this)
        try {
            this.server.close()
        } catch(err) {}
    },
    
    start: function() {
        var counter = 0;
        this.server = net.createServer(function(socket) {
            var id = this.get('name') + " " + counter
            var socketnode = new this.SocketNode({socket: socket, id: id })
            this.MsgIn( { tcp: { connect: id } })
            counter ++
            this.addparent(socketnode)
        }.bind(this)).listen(this.port)

        this.parents.on('remove',function(parent) {
//            console.log("NODE DISCONNECTED".green)
            this.MsgIn( { tcp: { disconnect: parent.get('id') } })
        }.bind(this))
    }
})


// each tcpnode (tcpserver or client) has socket nodes as their children.
// socket nodes represent concrete connections, client tcp node has only one socket node as a child
var PlainTcpSocket = MsgNode.extend4000({

    initialize: function() {
        var socket
        if (!(socket = this.socket = this.get('socket'))) 
        { throw "I need a socket object in order to make sense" }
        
        // wait to be connected to your master node and then initialize yourself, 
        // this will be called immediately if your child has been set upon instantiation
        this.onchild(this.bindSocket.bind(this))

        this.children.on('remove', function() {
            if (!this.children.length) { 
//                console.log('I have no children anymore, dying')
                this.del()
            }
        }.bind(this))
    },

    // waits for a new line from the other side, and then tries to parse the JSON it received.
    // in case of invalid data, it dies
    bindSocket: function() {
        var self = this
        var socket = this.socket
        var maxbuffer = (this.get('maxbuffer') || 10000)
        buffer = ""
        
        this.on('del', function() {
            try { socket.end() } catch(err) {}
        })
        
        socket.on('end', function() { this.trigger('disconnect'); this.del() }.bind(this));
        
        socket.on('data', function(data) {
            data = data.toString('utf8')
//            console.log("RECV",data)
            buffer += data
            if (buffer.length > maxbuffer) { 
                this.log('tcpnode','warning','received too long message from client. kicking it out.')
                this.del()
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
                msg._viral = { tcp: id, node: self }
//                console.log("MSGIN",msg)
                self.lobby.MsgIn(msg)
            }
        }
    },

    send: decorate(MakeObjReceiver(Msg), function(msg) {
        try {
            var rendered 
            if ((rendered = msg.render()) != "{}") {
        //        console.log("SEND",rendered)
                this.socket.write(rendered + "\n")
            }
        } catch(err) {
            console.warn('error writing to socket')
        }
    }),

    MsgOut: decorate(MakeObjReceiver(Msg),function(msg) {
        if ((msg._viral.tcp) && (msg._viral.tcp == this.get('id'))) {
            // sends a new line delimited JSON message BOOOOOM
            this.send(msg)
        } else { 
            //console.log('message ignored', this.get('id'))
        }
    })
})

exports.nodes.TcpNode = TcpNode
exports.nodes.TcpClientNode = TcpClientNode
exports.nodes.TcpServerNode = TcpServerNode
exports.nodes.PlainTcpSocket = PlainTcpSocket

