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
const fs = require('fs');



//////////////////
// CONSTRUCTOR  //
//////////////////
function Init(app) {

  if (!(this instanceof Init)) { return new Init(app); }

  Init.super_.call(this);

  this.app             = app;
  this.name            = "Init";

  this.max_block       = 100;
  this.payout_block    = 90;

  return this;

}
module.exports = Init;
util.inherits(Init, ModTemplate);




Init.prototype.onNewBlock = function onNewBlock(blk) {

  if (this.app.BROWSER == 1) { return; }

  if (this.max_block < blk.block.id) { return; } 
  if (blk.block.id <= this.max_block && blk.block.id != this.payout_block) { 

    var thisfee = Big(2.0);
    var thisamt = Big(this.app.wallet.returnBalance());
        thisamt = thisamt.minus(thisfee);

    if (thisamt.gt(0)) {
      let newtx = this.app.wallet.createUnsignedTransaction(this.app.wallet.returnPublicKey(), thisamt.toFixed(8), thisfee.toFixed(8));
      if (newtx != null) {
        console.log("------------- CREATING TX ---------------");
        newtx = this.app.wallet.signTransaction(newtx);
        this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate
      }
    }

    return;
  }


  /////////
  // ATR //
  /////////
  if (blk.block.id == this.payout_block) {
 
    let newtx = null;
    let VIPFILE = __dirname + "/VIP.txt";
    let txarray = [];

console.log("RUNNING: " + VIPFILE);

    let contents = fs.readFileSync(VIPFILE, 'utf8').toString('utf8');

console.log(contents);

    let lines = contents.split("\n");
    let amt   = Big(0.0);
    let fee   = Big(2.0);

    //
    // set inputs
    //
    newtx                  = new saito.transaction();
    newtx.transaction.from = blk.app.wallet.returnAdequateInputs(blk.app.wallet.returnBalance());
    newtx.transaction.ts   = new Date().getTime();
    newtx.transaction.type = 4;

    for (let i = 0; i < lines.length; i++) {

      if (lines[i].length > 0) {

        let items = lines[i].split("\t");
        newtx.transaction.to.push(new saito.slip(items[0], items[1]));
        newtx.transaction.to[newtx.transaction.to.length-1].type = 4;

console.log("ADDING: " + items[0] + " -- " + items[1]);

        amt = amt.plus(Big(items[1]));

      }
    }

    //
    // add change input
    //
    var total_inputs = Big(blk.app.wallet.returnBalance());
    var change_amount = total_inputs.minus(amt).minus(fee);
    if (Big(change_amount).gt(0)) {
      newtx.transaction.to.push(new saito.slip(blk.app.wallet.returnPublicKey(), change_amount.toFixed(8)));
      newtx.transaction.to[newtx.transaction.to.length-1].type = 0;
    }

    newtx = this.app.wallet.signTransaction(newtx);

console.log("FINAL: " + JSON.stringify(newtx.transaction));

    this.app.mempool.addTransaction(newtx, 0); // don't relay-on-validate

  }

}

