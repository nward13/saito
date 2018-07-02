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



//////////////////
// CONSTRUCTOR  //
//////////////////
function Init(app) {

  if (!(this instanceof Init)) { return new Init(app); }

  Init.super_.call(this);

  this.app             = app;
  this.name            = "Init";

  return this;

}
module.exports = Init;
util.inherits(Init, ModTemplate);




Init.prototype.onNewBlock = function onNewBlock(blk) {

  if (this.app.BROWSER == 1) { return; }

  //if (blk.block.id > 99) { return; }

  // empty mempool
  this.app.mempool.transactions = [];

  var thisfee = Big(2.0);
  var thisamt = Big(this.app.wallet.returnBalance());
      thisamt = thisamt.minus(thisfee);

  if (thisamt.gt(0)) {

  let newtx = this.app.wallet.createUnsignedTransaction(this.app.wallet.returnPublicKey(), thisamt.toFixed(8), thisfee.toFixed(8));
    if (newtx != null) {
      console.log("------------- CREATING TX ---------------");
      newtx = this.app.wallet.signTransaction(newtx);
      this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate
    } else {
console.log("ERROR: spammer modules - newtx is null...");
    }

  }
}

