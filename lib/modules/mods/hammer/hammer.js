//
// This module monitors the blockchain and our
// unspent transaction inputs. It creates fake
// transactions to speed up block production
// for testing purposes.`
//
var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');
var crypto = require('crypto');
const Big      = require('big.js');

console.log("hammer.....started.....");

//////////////////
// CONSTRUCTOR  //
//////////////////
function Hammer(app) {

  if (!(this instanceof Hammer)) { return new Hammer(app); }

  Hammer.super_.call(this);

  this.app             = app;
  this.name            = "Hammer";

  return this;

}
module.exports = Hammer;
util.inherits(Hammer, ModTemplate);

Hammer.prototype.initialize = function initialize() {
  console.log("hammer:.....initialized.....");
  this.flood();
}

Hammer.prototype.flood = function flood() {

  if (this.app.BROWSER == 1) { return; }

  console.log("hammer: public key : "+this.app.wallet.returnPublicKey());
  console.log("hammer: balance: "+this.app.wallet.returnBalance());

  var size_of_emails_in_mb   = 0.075;
  var size_of_mb             = 1024000;
  var pause                  = 5000;

  //var available_inputs_limit = 0.5;
  //var available_inputs       = Big(blk.app.wallet.returnAvailableInputs(available_inputs_limit));

  var pkey                   = this.app.wallet.returnPublicKey();

  var thisfee                = 1.0;
  var thisamt                = 1.0;
  var newtx                  = null;

  if (this.app.wallet.returnAvailableInputs(thisfee+thisamt) == 0) {
    console.log("hammer: not enough saito");
    return;
  } else {
    //newtx = this.app.wallet.createUnsignedTransaction(pkey, thisamt, thisfee);
    newtx = this.app.wallet.createUnsignedTransaction(this.app.wallet.returnPublicKey(), thisamt, thisfee);
    if (newtx != null) {
      var strlength = size_of_mb * size_of_emails_in_mb;
      newtx.transaction.msg.data = crypto.randomBytes(Math.ceil(strlength/2)).toString('hex').slice(0,strlength);
      newtx = this.app.wallet.signTransaction(newtx);
      //this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate
      this.app.network.propagateTransaction(newtx);
      console.log("hammer: message sent");
    } else {
      console.log("hammer: ERROR:  modules - newtx is null...");
    }
  }

  setTimeout(this.flood(), pause);

}

Hammer.prototype.onNewBlock = function onNewBlock(blk) {
  this.flood();
}
