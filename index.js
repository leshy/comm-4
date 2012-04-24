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
        this.get('collection').find(filter,limits,function(err,cursor) {
//            console.log("ERR",err)
            callback(err, cursor)
        })
    },
    
    create: function(data,callback) { 
        var model = this.get('model')
        console.log("db create", data)
        this.get('collection').insert(data,function(err,data) {
            console.log(err,data)
            callback(err,data)
        })
    },

    remove: function(find,callback) {
        this.get('collection').remove(find,callback)
    },

    update: function(findOne,data,callback) {
        this.get('collection').update(findOne, { '$set' : data }, function(err,data) {
//            if (!err) { self.trigger('updated',findOne, msg.o) }
            callback(err,data)
        })
    }
})



var CollectionExposer = MsgNode.extend4000({
    defaults: { store: undefined,
                accesslevel: 'nobody',
                name: 'collectionexposer',
                permissions: {}
              },

    initialize: function() {
        console.log("ALLOW",{body: {collection: this.get('model').prototype.defaults.name}})
        this.lobby.Allow({body: {collection: this.get('model').prototype.defaults.name}})
        this.subscribe({body: {filter: true}}, this.filterMsg.bind(this))
        this.subscribe({body: {create: true}}, this.createMsg.bind(this))
        this.subscribe({body: {update: true}}, this.updateMsg.bind(this))
        this.subscribe({body: {remove: true}}, this.removeMsg.bind(this))
    },
    
    removeMsg: function(msg,callback) {
        this.remove({ "_id": BSON.ObjectID(msg.body.remove) })
        callback()
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
    },

    updateMsg: function(msg,callback) {
        var model = this.resolveModel(msg.update)
        var self = this;
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.body.origin,msg.body.update])) !== false) {
            callback(err)
            return
        }
        var id = BSON.ObjectID(msg.body.update.id)
        delete msg.body.update['id']

        this.update({_id: id},msg.body.update, function(err,data) {
        })

    },

    createMsg: function(msg,callback) { 
        var model = this.resolveModel(msg.o)
        var err;
        if ((err = model.prototype.verifypermissions.apply(this,[msg.body.origin,msg.body.create])) !== false) {
            callback(err)
            return
        }

        this.create(msg.body.create,function(err,data) { callback() })
    }
})


exports.Msg = Msg
exports.MsgNode = MsgNode
exports.RemoteModel = RemoteModel
exports.DbCollection = DbCollection
exports.CollectionExposer = CollectionExposer
exports.MsgSubscriptionManAsync = MsgSubscriptionManAsync


