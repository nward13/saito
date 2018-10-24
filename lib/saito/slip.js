'use strict';

/**
 * Slip Constructor
 * @param {*} add
 * @param {*} amt
 * @param {*} type
 * @param {*} bid
 * @param {*} tid
 * @param {*} sid
 * @param {*} bhash
 * @param {*} lc
 * @param {*} rn
 */
function Slip(add="", amt="0", type=0, bid=0, tid=0, sid=0, bhash="", lc=1, rn=-1) {

  if (!(this instanceof Slip)) {
    return new Slip(add, amt, type, bid, tid, sid, bhash, lc, rn);
  }

  this.add    = add;
  this.amt    = amt.toString();  // sanity check
				 // sometimes people submit as numbers
				
  this.type   = type;	// 0 = normal transaction
		        // 1 = golden ticket
		        // 2 = fee ticket
		        // 3 = automatic tx rebroadcasting
		        // 4 = VIP transaction
		        // 5 = golden chunk
  this.bid    = bid;
  this.tid    = tid;
  this.sid    = sid;
  this.bhash  = bhash;
  this.lc     = lc;

  return this;

}
module.exports = Slip;

/**
 * Returns the index created from the fields of the slip
 * @return {string} index
 */
Slip.prototype.returnIndex = function returnIndex() {
  return this.bid.toString() + this.type.toString() + this.tid.toString() + this.sid.toString() + this.bhash + this.amt.toString();
}



/*
 * serializer for testing intended to replace JSON.stringify with something faster
 * note that it is creating a meta-JSONed string as we are using this for inclusion
 * when the transaction class calls for it -- gets subsumed within block function
 */
Slip.prototype.stringify = function stringify(escape_quotes=0) {

  if (escape_quotes == 0) {

    let json      =  '{"add":"' + this.add + '",'
                  +  '"amt":"' + this.amt + '",'
                  +  '"type":' + this.type + ','
                  +  '"bid":' + this.bid + ','
                  +  '"tid":' + this.tid + ','
                  +  '"sid":' + this.sid + ','
                  +  '"bhash":"' + this.bhash + '",'
                  +  '"lc":' + this.lc + '}';

    return json;

  } else {

    let json      =  '{\\"add\\":\\"' + this.add + '\\",'
                  +  '\\"amt\\":\\"' + this.amt + '\\",'
                  +  '\\"type\\":' + this.type + ','
                  +  '\\"bid\\":' + this.bid + ','
                  +  '\\"tid\\":' + this.tid + ','
                  +  '\\"sid\\":' + this.sid + ','
                  +  '\\"bhash\\":\\"' + this.bhash + '\\",'
                  +  '\\"lc\\":' + this.lc + '}';

    return json;

  }
}





