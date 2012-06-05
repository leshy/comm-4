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

var Backbone = require('backbone');
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

var DbCollection = Collection.extend4000({
    defaults: { 
        name: 'dbcollection',
        db: undefined,
        collection: undefined,
        model: undefined,
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

    // receives data from the db and figures out which model should be instantiated
    // you can override this if you want a more complex algo that decides on the right model for the data
    resolveModel: function(data) {
        var model = this.get('model')
        // type is defined? Try to look up more appropriate model
        if (data.type) {
            var differentmodel = undefined
            if (differentmodel = this.get('types')[data.type]) { return differentmodel }
            
            // issue a warning here
            console.warn("data in " + this.get('name') + " collection has a type defined to " + data.type + " but I couldn't find the appropriate model in my black book of appropriate models (" + JSON.stringify(_.keys(this.get('types'))) + ")")
        }
        
        return model
    },

    filter: function() { this.find.apply(this,arguments) },

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


var CollectionExposer = MsgNode.extend4000({
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
        var definition = args.shift()

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
        var model = RemoteModel.extend4000(definition)
        
        // now we need to figure out how to hook it up to the collection        
        var types = this.get('types')
        
        // this collection has only one model for now, just save it as a model attribute
        if (!(_.keys(types).length) && !(this.get('model'))) { 
            this.set({model : model})
            return
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

    filterModels: function(filter,callback,limits) {
        var self = this

        if (!limits) { limits = {} }
        this.filter(filter,limits,function(err,cursor) {
            if (err) { callback(err); return }
            callback(err, new ModelIterator(self.resolveModel.bind(self),cursor), cursor)
        })
    },

    
    removeMsg: function(msg,callback) {
        // this should be abstracted, filtermsg, and updatemsg use the same thing
        if (msg.remove.id) { 
            msg.remove._id = msg.remove.id; delete msg.remove['id'] 
        }
        
        if (msg.remove._id) {
            msg.remove._id = new BSON.ObjectID(msg.remove._id)
        }

        this.remove(msg.remove, function(err,res) {
            callback()
        })
        
    },

    filterMsg: function(msg,callback,response) { 
        var self = this;
        var origin = msg.origin
        if (!msg.limits) { msg.limits = {} }
        console.log('filtermsg!')
        
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
        var model = this.resolveModel(msg.update)
        var self = this;
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.origin,msg.update])) !== false) {
            callback(err)
            return
        }
        if (!msg.select) {
            msg.select = { _id: msg.update.id }
        }
        if (msg.select.id) { 
            msg.select._id = msg.select.id; delete msg.select['id'] 
        }        
        if (msg.select._id) {
            msg.select._id = new BSON.ObjectID(msg.select._id)
        }

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
exports.CollectionExposer = CollectionExposer
exports.MsgSubscriptionManAsync = MsgSubscriptionManAsync


