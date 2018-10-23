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
function Spammer(app) {

  if (!(this instanceof Spammer)) { return new Spammer(app); }

  Spammer.super_.call(this);

  this.app             = app;

  return this;

}
module.exports = Spammer;
util.inherits(Spammer, ModTemplate);




Spammer.prototype.onNewBlock = function onNewBlock(blk) {

  if (this.app.BROWSER == 1) { return; }

  var emails_to_send = 10000;
  var size_of_emails_in_mb = 0.036;
  var size_of_mb = 1024000;

  if (blk.block.id == 6) {
    var newtx              = new saito.transaction();
    newtx.transaction.from = blk.app.wallet.returnAdequateInputs(blk.app.wallet.returnBalance());
    newtx.transaction.ts   = new Date().getTime();
    for (let i = 0; i < emails_to_send; i++) {
      newtx.transaction.to.push(new saito.slip(blk.app.wallet.returnPublicKey(), 1));
    }
    newtx = this.app.wallet.signTransaction(newtx);
    blk.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate

    return;
  }



  //
  // one possible cause of failure is if we create a large
  // number of transactions and it takes so long that only
  // some of them get added to the next block, and then we
  // have double-input problems.
  //
  // in order to avoid this, we just empty the mempool first
  //this.app.mempool.transactions = [];
  //this.app.mempool.transactions_hmap = [];
  //this.app.mempool.transactions_inputs_hmap = [];

  try {
console.log("-----------------------------------------");
    for (let x = 0; x < emails_to_send; x++) {

      var available_inputs_limit = 0.5;
      var available_inputs       = Big(blk.app.wallet.returnAvailableInputs(available_inputs_limit));

      if (available_inputs.lt(available_inputs_limit) || (x < 0 || x >= emails_to_send)) {
console.log(" ... txs in mempool: " + this.app.mempool.transactions.length);
console.log("-----------------------------------------");
        return;
      }

       var thisfee = Big(0.0); 
       var thisamt = Big(1.0);
       var strlength = size_of_mb * size_of_emails_in_mb;
       //var random_data = crypto.randomBytes(Math.ceil(strlength/2)).toString('hex').slice(0,strlength);

      if (emails_to_send == 1) {
        //thisamt = Big(this.app.wallet.returnBalance());
        //thisamt = thisamt.minus(thisfee);
      }

      if (thisamt.gt(0)) {

        let newtx = this.app.wallet.createUnsignedTransaction(this.app.wallet.returnPublicKey(), thisamt, thisfee);

        if (newtx != null) {
          if (x == 0) { console.log("------------- CREATING TX ---------------"); }
          var random_data = crypto.randomBytes(Math.ceil(strlength/2)).toString('hex').slice(0,strlength);
          newtx.transaction.msg.data = random_data + x;
          newtx = this.app.wallet.signTransaction(newtx);

	  let prems = this.app.mempool.transactions.length;
	  let prems2 = prems;
          this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate

	  if (this.app.mempool.transactions.length != prems+1) {
	    console.log("THIS TX FAILED: " + x);
	    newtx.transaction.msg.data = "";
	    console.log(JSON.stringify(newtx));
	    console.log(JSON.stringify(blk.app.mempool.transactions));
	  }

        } else {
          console.log("ERROR: spammer modules - newtx is null...");
	  x = emails_to_send+1;
        }
      }
    }
    console.log(" ... txs in mempool: " + this.app.mempool.transactions.length);
    console.log("-----------------------------------------");

  } catch(err) {
console.log("running spammer 3 error...");
    console.log(err);
  }


}

