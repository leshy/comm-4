
function Msg(data) {
    var self = this;
    this._meta = {}
    this._viral = {}
    _.extend(this,data)
}


Msg.prototype.render = function() { return JSON.stringify(this)  }

