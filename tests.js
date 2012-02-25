var fs = require('fs')
var expression = fs.readFileSync('./app.js','utf8');
eval(expression);


exports.addParent = function(test){

    var a = new GraphNode({name: 'a'})
    var b = new GraphNode({name: 'b'})
    var c = new GraphNode({name: 'c'})

    a.addparent(c)

    test.equal(a.parents.models.length,1, 'not added to parents')
    test.equal(c.children.models.length,1, 'not added to children')
    test.equal(b.parents.models.length,0,  'parents leaked to another instance')
    test.equal(b.children.models.length,0,  'children leaked to another instance')
    test.equal(c.parents.models.length,0, 'addparent modified parents list of a parent')
    test.equal(a.children.models.length,0, 'addparent modified children list of a child')
    test.equal(c.haschild(a), true, "addparent didn't add child")
    test.equal(a.haschild(c), false, "addparent added to children collection of a child")
    test.equal(a.hasparent(c),true, 'hasparent didnt return true')
    test.equal(c.hasparent(a),false, 'addparent changed parents of a parent')
    test.equal(b.hasparent(c),false, 'hasparent leaked')

    test.done();
};


