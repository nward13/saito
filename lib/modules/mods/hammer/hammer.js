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

console.log(".....ping started.....");

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

function flood() {

  console.log("flooding.................................................................................");

  if (this.app.BROWSER == 1) { return; }

  var size_of_emails_in_mb   = 0.075;
  var size_of_mb             = 1024000;
  var pause                  = 1000;

  var available_inputs_limit = 0.5;
  var available_inputs       = Big(blk.app.wallet.returnAvailableInputs(available_inputs_limit));

  var pkey                   = this.app.wallet.returnPublicKey();

  var thisfee                = Big(1.0);
  var thisamt                = Big(0.0);
  var newtx                  = null;

  if (available_inputs.lt(available_inputs_limit)) {
    console.log("not enough inputs");
  } else {
    newtx = this.app.wallet.createUnsignedTransaction(pkey, thisamt, thisfee);
    if (newtx != null) {
      var strlength = size_of_mb * size_of_emails_in_mb;
      newtx.transaction.msg.data = crypto.randomBytes(Math.ceil(strlength/2)).toString('hex').slice(0,strlength);
      newtx = this.app.wallet.signTransaction(newtx);
      this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate
      console.log("message sent");
    } else {
      console.log("ERROR:  modules - newtx is null...");
    }
  }

  setTimeout(flood(), pause);

}

flood();
