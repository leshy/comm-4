var Backbone = require('backbone');
var _ = require('underscore');
var decorators = require('decorators');
var decorate = decorators.decorate;

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


// a node that connects to other nodes via 'plugs'
// plug is just a name of collection that contains other nodes
// GraphNode specializes GenericGraphNode by adding 'children' and 'parents' plugs
var GenericGraphNode = Backbone.Model.extend({ 
    defaults: { name: 'node' },

    initialize: function() {
        var self = this;

        // simple decorator to check if plug exists for plug accepting functions
        var plugfundecorator = function() {
            var args = toArray(arguments); var f = args.shift(); var plugname = _.first(args);
            if (!self.plugs[plugname]) { throw "graph node can't find plug named '" + plugname + "'"; return; }
            return f(args);
        };
        /*
        _.map(['get', 'add', 'remove', 'has'], function(fname) {
            self.fname = decorate(plugfundecorator,self.fname);
        });
        */
        this.plugs = {};
    },

    name: function() {
        return this.get('name');
    },

    addplug: function(plugplural, plugsingular) {
        var self = this;
        if (!plugsingular) { plugsingular = plugplural; }
        
        var plug
        plug = this.plugs[plugplural] = this[ plugplural ] = new Backbone.Collection();
        
        plug.singular = plugsingular
        plug.name = plugplural
        
        var add = this[ 'add' + plugsingular ] = decorate(decorators.multiArg,function(obj) { return self.plugadd.call(self,plugplural,obj); });

        this[ 'del' + plugsingular ] = decorate(decorators.multiArg,function(obj) { return self.plugremove.call(self,plugplural,obj); });
        this[ 'del' + plugplural ] = function() { return self.plugremoveall.call(self,plugplural) }
        this[ 'has' + plugsingular ] = function(obj) { return self.plughas.call(self,plugplural,obj); };
        this[ 'get' + plugsingular ] = function() { return _.first(self.plugget.call(self,plugplural)); };
        this[ 'get' + plugplural ] = function() { return self.plugget.call(self,plugplural); };
        this[ 'replace' + plugsingular ] = function(obj1,obj2) { return self.plugreplace.apply(self,[plugplural,obj1,obj2]); };

        this[ 'on' + plugsingular ] = function(callback) { return self.plugon.call(self,plugplural,callback) }
        // you can preinitialize contents of the plug
        var toadd = (this.get(plugplural) || [])
        this.unset(plugplural)

        this.trigger('addplug:' + plugplural,this[plugplural])
        this.trigger('addplug', plugplural)

        // preinit?
        _.map(toadd, function(el) { add(el) })
    },

    del: function() {
        _.map(this.plugs,(function(plug,plugname) {
            this.plugremoveall(plugname)
        }.bind(this)))

        this.trigger('del')
    },

    plugget: function(plug) {
        return this[plug].models;
    },

    plugadd: function(plug,obj) {
//        if (!obj) { return }
        //console.log(this.get('name'), 'add', plug,obj.get('name'))
        if (!this.plughas(plug,obj)) { this[plug].add(obj); }
    },

    plugon: function(plug,callback) {
        var model
        this[plug].map(callback)
        this[plug].on('add',callback)
    },

    plugremove: function(plug,obj) {
        this[plug].remove(obj);
    },

    plugremoveall: function(plug,obj) {
        var plug = this[plug]
        plug.map(function(obj) { plug.remove(obj) })
    },

    plughas: function(plug, obj) {
        return (this[plug].indexOf(obj) != -1);
    },
   
    plugreplace: function(plug, obj1, obj2) {
        if (obj1 == obj2) { return }
        var plug = this[plug]
        plug.map(function(obj,index) {
            if (obj == obj1) { 
                plug.remove(obj,{index:index})
                plug.add(obj2,{at:index})
            }
        })        
    }
});

// GraphNode specializes GenericGraphNode by adding 'children' and 'parents' plugs
var GraphNode = GenericGraphNode.extend4000({
    initialize: function() {
        var self = this;

        this.addplug('parents','parent');
        this.addplug('children','child');
        
        this.parents.on('add',function(obj) {
            obj.addchild(self);
        });

        this.children.on('add',function(obj) {
            obj.addparent(self);
        });
        

        // in case the object was prefilled
        this.children.map(function(child) {
            child.addparent(self)
        })

        this.parents.map(function(child) {
            child.addchild(self)
        })

    },

    destroy: function() {
        this.delparents()
        this.delchildren()
        this.trigger('destroy')
    }
});


var TraversalMixin = Backbone.Model.extend4000({
    // this is actually a depthfirst reduce
    plugDepthFirst: function(plug,callback,reducePacket) {

        var reducePacket = callback(this,reducePacket) 
        if (reducePacket === NaN) { return NaN } // a way to cancel the tranversal, this should be made differently

        var models = this[plug].models

        for (index in models) {
            var element = models[index]
            var reducePacket = element.plugDepthFirst(plug,callback,reducePacket)
            if (reducePacket === NaN) { break }
        }
        
        return reducePacket
    },
    
    

    initialize: function() {

        var buildFunctions = function(plug) {
            this[plug.name + 'DepthFirst'] = function(callback,reducePacket) { return this.plugDepthFirst(plug.name,callback,reducePacket) }
        }
        
        // hook addplug
        this.on('addplug', function(model,plug) { this.buildFunctions(plug)}.bind(this))

        // build functions for existing plugs
        _.map(this.plugs, buildFunctions.bind(this))

    }
})


exports.GenericGraphNode = GenericGraphNode
exports.GraphNode = GraphNode
exports.TraversalMixin = TraversalMixin
