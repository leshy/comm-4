var Backbone = require('backbone');
var _ = require('underscore')
var decorators = require('decorators');
var decorate = decorators.decorate;

// converts retarded magical arguments object to an Array object
function toArray(arg) { return Array.prototype.slice.call(arg) }


// defaults attribute inheritance, and automatic super.initialize calls
(function () {
    function extend4000 () {
        var args = Array.prototype.slice.call(arguments),
        child = this;

        var initf = []
        var defaults = {}
        if (child.prototype.defaults) {
            defaults = _.clone(child.prototype.defaults)
        }

        _.each(args, function (superc) {
            // did I receive a dictionary or an object/backbone model?
            if (superc.prototype) { superc = superc.prototype }

            // inherit defaults
            if (superc.defaults) {
                defaults = _.extend(defaults,superc.defaults)
            }

            // build a list of initialize functions if you find more then one
            if (superc.initialize) {
                (initf.length) || initf.push(child.prototype.initialize);
                initf.push(superc.initialize)
            }

            child = child.extend(superc);
        });

        // construct a combined init function
        if (initf.length) {
            child = child.extend({ initialize : function(attributes,options) {
                var self = this
                _.map(initf,function(initf) { initf.call(self,attributes,options) })
            }})
        }
        child.prototype.defaults = defaults
        return child;
    }

    Backbone.Model.extend4000 =
    Backbone.Collection.extend4000 =
    Backbone.Router.extendEach =
    Backbone.View.extend4000 = extend4000;

    function triggerOnce(event,f) {
        var self = this;
        this.bind(event,function() {
            self.unbind(event,f)
            f.apply(this,toArray(arguments))
        })
    }

    Backbone.Model.triggerOnce = triggerOnce;

})();



// a node that connects to other nodes via 'plugs'
// plug is just a name of collection that contains other nodes
// GraphNode specializes GenericGraphNode by adding 'children' and 'parents' plugs
var GenericGraphNode = Backbone.Model.extend({ 
    defaults: { name: 'node' },

    initialize: function() {
        var self = this

        // simple decorator to check if plug exists for plug accepting functions
        var plugfundecorator = function() {
            var args = toArray(arguments); var f = args.shift(); var plugname = _.first(args);
            if (!self.plugs[plugname]) { throw "graph node can't find plug named '" + plugname + "'"; return; }
            return f(args)
        }
        
        _.map(['add','remove','has'], function(fname) {
            self.fname = decorate(plugfundecorator,self.fname)
        })

        this.plugs = {}
    },

    name: function() {
        return this.get('name')
    },

    addplug: function(plugplural, plugsingular, nomodels) {
        var self = this;

        this.plugs[plugplural] = true

        this[ plugplural ] = new Backbone.Collection()
        
        this[ 'add' + plugsingular ] = decorate(decorators.multiArg,function(obj) { return self.add.call(self,plugplural,obj) })
        this[ 'del' + plugsingular ] = decorate(decorators.multiArg,function(obj) { return self.remove.call(self,plugplural,obj) })
        this[ 'has' + plugsingular ] = function(obj) { return self.has.call(self,plugplural,obj) }
        this[ 'get' + plugplural ] = function(obj) { return self[plugplural].models }
    },

    add: function(plug,obj) {
        this[plug].add(obj)
    },

    remove: function(plug,obj) {
        this[plug].remove(obj)
    },

    has: function(plug, obj) {
        return (this[plug].indexOf(obj) != -1)
    },

})


// GraphNode specializes GenericGraphNode by adding 'children' and 'parents' plugs
var GraphNode = GenericGraphNode.extend4000({
    initialize: function() {
        this.addplug('parents','parent')
        this.addplug('children','child')
    }
})




var a = new GraphNode()
var b = new GraphNode()
console.log(a.parents)

var c = new Backbone.Model()

a.addparent(c)

console.log(a.hasparent(c))
console.log(b.hasparent(c))




//console.log(a.parents)

console.log(_.keys(a.plugs))