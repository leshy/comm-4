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
// introspective functions for collectionexposers


var Backbone = require('backbone');
var _ = require('underscore');
var decorators = require('decorators');
var decorate = decorators.decorate;
var graph = require('graph')
var async = require('async')
var BSON = require('mongodb').BSONPure

// converts retarded magical arguments object to an Array object
function toArray(arg) { return Array.prototype.slice.call(arg); }

// calls function if it exists
function cb() { 
    var args = toArray(arguments)
    if (!args.length) { return }
    var callback = args.shift()
    if (callback) { callback.apply(this,args) }
}



// defaults attribute inheritance, and automatic super.initialize calls
(function () {
    function extend4000 () {
        var args = Array.prototype.slice.call(arguments),
        child = this;

        var initf = [];
        var defaults = {};
        if (child.prototype.defaults) {
            defaults = _.clone(child.prototype.defaults);
        }

        _.each(args, function (superc) {
            // did I receive a dictionary or an object/backbone model?
            if (superc.prototype) { superc = superc.prototype; }

            // inherit defaults
            if (superc.defaults) {
                defaults = _.extend(defaults,superc.defaults);
            }

            // build a list of initialize functions if you find more then one
            if (superc.initialize) {
                (initf.length) || initf.push(child.prototype.initialize);
                initf.push(superc.initialize);
            }

            child = child.extend(superc);
        });

        // construct a combined init function
        if (initf.length) {
            child = child.extend({ initialize : function(attributes,options) {
                var self = this;
                _.map(initf,function(initf) { initf.call(self,attributes,options); });
            }});
        }
        child.prototype.defaults = defaults;
        return child;
    }

    Backbone.Model.extend4000 =
    Backbone.Collection.extend4000 =
    Backbone.Router.extendEach =
    Backbone.View.extend4000 = extend4000;

    function triggerOnce(event,f) {
        var self = this;
        this.bind(event,function() {
            self.unbind(event,f);
            f.apply(this,toArray(arguments));
        });
    }

    Backbone.Model.triggerOnce = triggerOnce;

})();


// simple object that matches json blobs and executes callbacks
// maybe I should upgrade this to use json schemas as patterns
var SubscriptionMan = Backbone.Model.extend4000({ 
    initialize: function() {
        this.subscriptions = [];
    },

    subscribe: function(msg,f,name) { 
        if (!name) { name = function() { f() }; }
        this.subscriptions.push({pattern: msg, f: f, name: name});
        return name;
    },
    
    unsubscribe: function(name) { 
        this.subscriptions = _.filter(this.subscriptions, function(sub) { return ((sub.name != name) && (sub.f != name)); });
    },

    oneshot: function(msg,f) {
        var self = this;
        function ff() {
            self.unsubscribe(ff); f.apply(this,attributes);
        }
        this.subscribe(msg, ff,ff );
        return function() { self.unsubscribe(ff); };
    },

    _matches: function(msg) {
        function checkmatch(msg,pattern) {
	        for (var property in pattern) {
                if ( property == "*" ) { return true; }
	            if (msg[property] == undefined) { return false; }
	            if (pattern[property] != true) { if (msg[property] != pattern[property]) { return false; } }
	        }
	        return true;
        }

        var res = [];
        
        this.subscriptions.forEach(function(matcher) {
	        var pattern = matcher.pattern;
	        if (checkmatch(msg,pattern)) { res.push (matcher.f);  }
        });
        return res;
    },

    event: function(msg) { 	
        return this._matches(msg).forEach( function(f) { f(msg); } );
    }
});


// metadecorator for message receiving functions, 
// it just subclasses a message class if it receives a plain dictionary
// used to be able to call bla.send({lala: 3}) instead of bla.send(new Msg({lala:3}))
var MakeObjReceiver = function(objclass) {
    return function() {
        var args = toArray(arguments);
        var f = args.shift();
        if (args[0].constructor != objclass) { args[0] = new objclass(args[0]) }
        return f.apply(this,args)
    }
}


function Msg(data) {
    var self = this;
    if (data.payload && data.resource_uri) {
        data.body = data.payload
        delete data.payload
        _.extend(this,data)
    } else {
        this.body = data;
    }
}


//
// specializes subscriptionman to deal with message objects instead of just dictionaryes
//
var MsgSubscriptionMan = SubscriptionMan.extend4000({
    MsgIn: decorate(MakeObjReceiver(Msg), function(msg) {
        return this._matches(msg.body).map( function(f) { return f(msg); } );
    })
});

var MsgSubscriptionManAsync = SubscriptionMan.extend4000({
    MsgIn: decorate(MakeObjReceiver(Msg), function(msg,callback) {
        // get a list of functions that care about this message
        var flist = this._matches(msg.body).map( 
            function(f) { return function(callback) { f(msg, callback); }}
        );
        // boooom
        async.parallel(flist,callback)
    })
});

var Lobby = MsgSubscriptionManAsync.extend4000({ 
    defaults: {name: 'lobby'},
    Allow: function(pattern) {
        var master = this.get('master');
        this.subscribe(pattern, function(msg,callback) { return master.MsgIn(msg,callback) });
    },
    Close: function() {
        this.subscriptions = []
    },
    Disallow: function() { }
});

//
// this is the main part of clientside message dispatch system.
// MsgNodes are chained and pass messages thorugh each other until the last parent kicks them out into the world.
//
var MsgNode = Backbone.Model.extend4000(
    graph.GraphNode,
    MsgSubscriptionManAsync,
    {
        initialize: function() {
            // logx('init', this.get('name'), this);
            this.lobby = new Lobby({master: this});
            this.parents.bind('msg', function(msg) {
                lobby.MsgIn(msg);
            });
        },

        MsgIn: decorate(MakeObjReceiver(Msg),function(message,callback) {
            console.log(">>>", this.get('name'), message.body);
            message = this.MsgInMod(message)
            if (!message) { return }
            var self = this
            async.parallel(
                this.children.map(function(child) { 
                    return function(callback) { child.lobby.MsgIn(message,callback) }
                }).concat(
                    function(callback) { MsgSubscriptionManAsync.prototype.MsgIn.apply(self,[message,callback]) }
                ),
                function(err,data) { callback(err,_.flatten(data)) }
            )
        }),

        send: decorate(MakeObjReceiver(Msg),function(message) {
            this.MsgOut(message);
        }),
        
        MsgOut: function(message) {
            console.log("<<<", this.get('name'), message.body);
            message = this.MsgOutMod(message)
            if (!message) { return }
            return _.flatten(this.parents.map(function(parent) { parent.MsgOut(message); }));
        },

        MsgInMod: function(message) { return message },

        MsgOutMod: function(message) { return message }
    });


var Collection = Backbone.Model.extend4000({
    defaults: {
        defaultfilter: undefined,
        absolutefilter: undefined,
        findby: "_id"
    },

    find: function(filter,limis,callback) {
        
    },  

    findOne: function(filter,callback) {
        
    }
})


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

    find: function(filter,callback,limits) {
        var self = this;
        this.get('collection').find(filter,function(err,cursor) {
            cursor.toArray(function(err,array) {
                var model = self.get('model')
                callback(undefined, _.map(array, function(data) { return new model(data) }))
            })
        })
    },
    
    create: function(data) { 
        var model = this.get('model')        
        entry = new model(data)
    },

    update: function(findOne,data,callback) {
        this.get('collection').update(findOne, data, callbacK)
    },

    flush: function(model,changes) {
        //this.update({ _id: model._id }, model.render('collection', changes))
    }
})


var CollectionExposer = MsgNode.extend4000({
    defaults: { store: undefined,
                accesslevel: 'nobody',
                name: 'collectionexposer',
                permissions: {}
              },

    initialize: function() {
        this.subscribe({filter: true}, this.filterMsg.bind(this))
        this.subscribe({create: true}, this.createMsg.bind(this))
    },

    filterMsg: function(msg,callback) { this.filter(msg.body.filter, callback, msg.body.limits) },

    updateMsg: function(msg,callback) {
        var model = this.resolveModel(msg.o)
        
        var err;
        if ((err = this.verifypermissions.call(this,msg.origin,msg.o)) !== false) {
            callback(err)
            return
        }
        
        this.update(msg.o.id, msg.o, callback)

    },
    
    createMsg: function(msg,callback) { 
        var instance = new this.resolveModel(msg.o)

        var err;
        if ((err = instance.verifypermissions.call(this,msg.origin,msg.o)) !== false) {
            callback(err)
            return
        }

        


        console.log('createmsg!',msg.body)
        callback(undefined,true)
        return
        var newobj = new this.get('model')
        async.series([ 
            function(callback) { newobj.update('api', msg.body.create, callback) },
            newobj.flush
        ], function(err,data) {
            callback(err,data)
        })
    }
})


var PermissionFilter = MsgNode.extend4000({
    defaults: { permission: "nobody" },

    MsgOutMod: function(message) {
        var permission = this.get('permission')
        message.body.origin = permission

        if (!message.body.o) { return message }
        
        if (message.body.o.constructor == Array) {
            message.body.o = message.body.o.map(function(o) { return o.render(permission) })
            return message
        }
        
        message.body.o = message.body.o.render(permission)
        return message
    }
})



var RemoteModel = Backbone.Model.extend4000({
    initialize: function() {
        this.changes = {}
        // smarter json diff can be implemented here.
        this.bind('change',function(model,change) {
            _.extend(this.changes,change.changes)
        }.bind(this))
    },

    // call to persist/propagade an object after changes.
    flush: function(callback) {
        if (!this.changes)  { return }
        

        this.changes = {};
    },

    _applypermission: function(attribute,permission) {
        
    },

    call: function(permission, f, args) {
        
    },

    update: function(permission, data) {
        
    },
    
    refresh: function() {
        
    },
    
    destroy: function() {
        
    }
})

exports.Msg = Msg
exports.MsgNode = MsgNode
exports.PermissionFilter = PermissionFilter
exports.RemoteModel = RemoteModel
exports.DbCollection = DbCollection
exports.CollectionExposer = CollectionExposer



