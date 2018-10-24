const saito    = require('../saito');


/////////////////
// Constructor //
/////////////////
function Path(from="", to="", sig="") {

  if (!(this instanceof Path)) {
    return new Path(from,to,sig);
  }
  this.from = from;
  this.to   = to;
  this.sig  = sig;

  return this;

}
module.exports = Path;



/*
 * serializer for testing intended to replace JSON.stringify with something faster
 */
Path.prototype.stringify = function stringify(escape_quotes=0) {

  if (escape_quotes == 0) {
    let json      = '{"from":"'+this.from+'","to":"'+this.to+'","sig":"'+this.sig+'"}';
    return json;
  } else {
    //
    // see transaction.stringify -- why are double escapes needed?
    //
    let json      = '{\\"from\\":\\"'+this.from+'\\",\\"to\\":\\"'+this.to+'\\",\\"sig\\":\\"'+this.sig+'\\"}';
    return json;
  }

}






