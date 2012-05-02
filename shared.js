
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
                if ((pattern[property].constructor == RegExp) && (msg[property].constructor == String)) { return pattern[property].test(msg[property]) }
	            if (pattern[property] !== true) { 
                    var atomicTypes = { Number: true, String: true }
                    if (atomicTypes[pattern[property].constructor.name]) { return Boolean(msg[property] === pattern[property] ) } // can I compare you with === ?
                    if ((pattern[property].constructor) != (msg[property].constructor)) { return false } // are you of different type? you are surely not the same then!

                    if (msg[property].constructor == Object) {  // should I compare deeper?
                        return checkmatch(msg[property], pattern[property])
                    }

                    throw "what is this I don't even " + JSON.stringify(msg[property]) + "(" + msg[property].constructor + ") and " + JSON.stringify(pattern[property]) + " (" + pattern[property].constructor + ")"
                }
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
    if (data.body) {
        _.extend(this,data)
    } else {
        this.body = data;
    }

    if (!this.meta) { this.meta = {} }

}
Msg.prototype.render = function() { return JSON.stringify(this.body) }


//
// specializes subscriptionman to deal with message objects instead of just dictionaryes
//
var MsgSubscriptionMan = SubscriptionMan.extend4000({
    MsgIn: decorate(MakeObjReceiver(Msg), function(msg) {
        return this._matches(msg.body).map( function(f) { return f(msg); } );
    })
});


// function, arg1...argX, callback
// callback is passed to a function as a last argument, but
// if a function returns some data, callback is called with that data immediately
// 
// used in places where we'd like to accept a function that takes a callback OR the one that returns right away.
//
function maybeCb() {
    var args = toArray(arguments)
    var f = args.shift()
    var callback = _.last(args)
    var response = f.apply(this,args)
    if (!response) { return }
    if (response.constructor != Array) { throw "function didn't return array, [err, data] expected" }
    if (response.length != 2) { throw "function didn't return array with correct size [err, data]" }
    callback.apply(this,response)    
}

function Response(msg,node,callback) { 
    this.node = node
    this.msg = msg 
    this.end = function(data) {
        callback(data)
    }
    var self = this;
    this.write = 
        function(reply) { 
            if (!reply) { return }
            if (!reply.body.queryid) { reply.body.queryid = msg.body.queryid }
            reply.meta = _.extend(reply.meta,msg.meta)
            self.node.MsgOut(reply)
        }
}


var MsgSubscriptionManAsync = SubscriptionMan.extend4000({
    MsgIn: decorate(MakeObjReceiver(Msg), function(msg,callbackdone) {
        // get a list of functions that care about this message
        var self = this;

        var flist = this._matches(msg).map( 
            function(f) { return function(callback) { 
                // function can accept callback OR it can return a reply right away

                var response = new Response(msg,self,callback)
                f(msg,function(err,responsemsg) { 
                    
                    if (!responsemsg) { callback(err); return }

                    
                    if (msg.body.queryid && !responsemsg.body.queryid)  { responsemsg.body.queryid = msg.body.queryid }

                    responsemsg.meta = _.extend(responsemsg.meta,msg.meta)
                    callback(err,responsemsg)
                },response)
            }}
        ); 
        // boooom
        async.parallel(flist,callbackdone)
    }),
});

var Lobby = MsgSubscriptionManAsync.extend4000({ 
    defaults: {name: 'lobby'},
    initialize: function() {
        var master = this.get('master')
        this.MsgIn = function(msg,callback) { return master.MsgIn(msg,callback) }
         
    },
    Allow: function(pattern) {
        delete this.MsgIn
        var master = this.get('master');
        this.subscribe(pattern, function(msg,callback) { 
            return master.MsgIn(msg,callback) 
        });
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
//            console.log(">>>", this.get('name'), message);

            if (!message) { return }
            var self = this

            async.parallel(
                this.children.map(function(child) { 
                    return function(callback) { child.lobby.MsgIn(message,callback) }
                }).concat(
                    function(callback) { MsgSubscriptionManAsync.prototype.MsgIn.apply(self,[message,callback]) }
                ),
                function(err,data) {
                    data = _.flatten(data)
                    data = _.filter(data, function(entry) { return Boolean(entry) })
                    if (data.length == 0) { data = undefined } else 
                    {
                        _.map(data, function(msg) { self.MsgOut(msg) })
                    }
                    if (callback) { callback(err) }
                })
        }),

        send: decorate(MakeObjReceiver(Msg),function(message) {
            this.MsgOut(message);
        }),
        
        MsgOut: function(message) {
            console.log("<<<", this.get('name'), message.body);
            if (!message) { return }
            return _.flatten(this.parents.map(function(parent) { parent.MsgOut(message); }));
        },
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



var RemoteModel = Backbone.Model.extend4000({
    initialize: function() {
        this.changes = {}
        // smarter json diff can be implemented here.
        if (!this.get("id")) {
            this.changes = _.reduce(_.keys(this.attributes), function(all, key) { all[key] = true; return all }, {})
        }
        this.bind('change',function(model,change) {
            _.extend(this.changes,change.changes)
        }.bind(this))
    },

    // call to persist/propagade an object after changes.
    flush: function(callback) {
        if (!this.changes)  { return }
        var self = this;

        // add id to all flush messages
        if (this.get('id')) { this.changes.id = true }
        
        // resolve changes
        //_.map(this.changes, function(val,key) { self.changes[key] = self.attributes[key] })
        
        // send msg to the store
        //this.get('owner').MsgIn( new Msg({ origin: "store",  o: this.changes }) )
        
        var data = this.render('store', _.keys(this.changes))

        if (!data.id) {
            this.trigger('create')
            this.get('owner').MsgIn( new Msg({ origin: "store",  create: data }), callback)
        } else {
            this.get('owner').MsgIn( new Msg({ origin: "store",  update: data }), callback )
        }
       
        this.changes = {};
    },

    verifypermissions: function(origin,data) {
        console.log("green lighting", origin)
        return false
    },

    _applypermission: function(attribute,permission) {
        
    },

    render: function(origin, attributes) {
        if (!attributes) { 
            attributes = _.keys(this.attributes)
        }
        
        var res = {}
        var self = this;
        var permissions = this.get('permissions')[origin]

        _.map(attributes, function(attribute) {
            if (!permissions[attribute]) { return false }
            res[attribute] = self.attributes[attribute]
        })

        if (id = this.get('id')) { res.id = id }
        return res
        return JSON.parse(JSON.stringify(res))
    },

    remove: function(callback) {
        this.get('owner').MsgIn( new Msg({ origin: "store",  remove: this.get('id') }), callback )
    },

    call: function(permission, f, args) {
        
    },

    update: function(permission, data) {
        
    },
    
    refresh: function() {
        
    },
    
    delete: function() {
        
    }
})
