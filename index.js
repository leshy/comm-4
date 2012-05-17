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

// responses of children -> switch to functions with callbacks, use async.parallel
// done

// each msgparser could return an iterator object? SWEET

var Backbone = require('backbone');
var _ = require('underscore');
var decorators = require('decorators');
var decorate = decorators.decorate;
var graph = require('graph')
var async = require('async')
var BSON = require('mongodb').BSONPure
var fs = require('fs')

var expression = fs.readFileSync('node_modules/comm4/shared.js','utf8');
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

        if (!db || !collection || (!this.get('model') && !this.get('modelResolver'))) { throw ("What is this I don't even (" + this.get('name')) + ")" }
        
        // resolve collection if you only have its name
        if (collection.constructor === String) {
            db.collection(collection, function (err,real_collection) {
                self.log('general','info','collection "' + collection + '" open.')
                self.set({collection: real_collection})
            })
        }
    },
    
    log: function() { if (this.l) { this.l.log.apply(this.l,arguments) } },

    // receives data from the db and figures out which model should be instantiated
    // looks up modelresolver function and this.model attribute.
    resolveModel: function(data) {
        var model = undefined
        // I'm enjoying writing these conditionals like this and I'm being a douschebag, 
        // I know its confusing
        this.ModelResolver && (model = this.ModelResolver(data))
        if (!model && !(model = this.get('model'))) {
            throw ("can't resolve model for data",data)
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


// receives mongodb query cursor and collection exposer
// and creates a fake 'cursor' that returns instances of models instead of just raw data
var ModelIterator = function(exposer,cursor) {
    this.exposer = exposer
    this.cursor = cursor
}

/*
// this makes it a valid interator
ModelIterator.prototype.next = function() {
    var data = this.cursor.next()
    var model = this.exposer.resolveModel(data)
    return new model(data)
}

//iterators.MakeIterator(ModelIterator.prototype)
*/
// define some iteration helpers


var CollectionExposer = MsgNode.extend4000({
    defaults: { store: undefined,
                accesslevel: 'nobody',
                name: 'collectionexposer',
                permissions: {}
              },

    initialize: function() {
        this.lobby.Allow({body: {collection: this.get('model').prototype.defaults.name}})
        this.subscribe({body: {filter: true}}, this.filterMsg.bind(this))
        this.subscribe({body: {create: true}}, this.createMsg.bind(this))
        this.subscribe({body: {update: true}}, this.updateMsg.bind(this))
        this.subscribe({body: {remove: true}}, this.removeMsg.bind(this))
    },
    
    removeMsg: function(msg,callback) {
        // this should be abstracted, filtermsg, and updatemsg use the same thing
        if (msg.body.remove.id) { 
            msg.body.remove._id = msg.body.remove.id; delete msg.body.remove['id'] 
        }
        
        if (msg.body.remove._id) {
            msg.body.remove._id = new BSON.ObjectID(msg.body.remove._id)
        }

        this.remove(msg.body.remove, function(err,res) {
            callback()
        })
        
    },

    filtermodels: function(filter,limits,callback) {
        var self = this
        // how to I build a classic interator out of object that supports next() ?
        this.filter(filter,limits,function(err,cursor) {
            if (err) { callback(err); return }
            callback(err, ModelIterator(self,cursor))
        })
    },

    filterMsg: function(msg,callback,response) { 
        var self = this;
        var origin = msg.body.origin
        if (!msg.body.limits) { msg.body.limits = {} }
        
        this.filter(msg.body.filter, msg.body.limits, function(err,cursor) {
            cursor.each(function(err,entry) {
                if (!entry) { response.end(); return }
                entry.id = String(entry._id)
                delete entry._id
                var model = self.resolveModel(entry)
                var instance = new model(entry)
                response.write(new Msg({o: instance.render(origin)}))
            })
        }, msg.body.limits)
        /*

        this.filtermodels(msg.body.filter, msg.body.limits, function(err,models) {
            models.each(function(model) {
                response.write(new Msg({o: model.render(origin)}))
            })
         })
         */

    },

    updateMsg: function(msg,callback) {
        var model = this.resolveModel(msg.update)
        var self = this;
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.body.origin,msg.body.update])) !== false) {
            callback(err)
            return
        }
        if (!msg.body.select) {
            msg.body.select = { _id: msg.body.update.id }
        }
        if (msg.body.select.id) { 
            msg.body.select._id = msg.body.select.id; delete msg.body.select['id'] 
        }
        
        if (msg.body.select._id) {
            msg.body.select._id = new BSON.ObjectID(msg.body.select._id)
        }

        this.update(msg.body.select,msg.body.update, function(err,data) {
            callback(new Msg({ success: true }))
        })

    },

    createMsg: function(msg,callback) { 
        var model = this.resolveModel(msg.body.create)
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.body.origin,msg.body.create])) !== false) {
            callback(err)
            return
        }

        var instance = new model(msg.body.create)
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


