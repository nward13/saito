//
// This module monitors the blockchain and our
// unspent transaction inputs. It creates fake
// transactions to speed up block production 
// for testing purposes.`
//
var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');
var ledgerdir  = __dirname + "/ledger/";
var ledgerfile = ledgerdir + "ledger.txt";
const fs = require('fs');



//////////////////
// CONSTRUCTOR  //
//////////////////
function PermanentLedger(app) {

  if (!(this instanceof PermanentLedger)) { return new PermanentLedger(app); }

  PermanentLedger.super_.call(this);

  this.app             = app;
  this.name            = "PermanentLedger";

  return this;

}
module.exports = PermanentLedger;
util.inherits(PermanentLedger, ModTemplate);




PermanentLedger.prototype.onChainReorganization = async function onChainReorganization(block_id, block_hash, lc) {

  let write_to_log = block_id + "\t" + block_hash + "\t" + lc + "\n";

  fs.appendFile(ledgerfile, write_to_log, function (err) {
    if (err) { throw err; }
  });

}





PermanentLedger.prototype.onNewBlock = async function onNewBlock(blk, i_am_the_longest_chain) {

  if (this.app.BROWSER == 1) { return; }

  let block_filename = ledgerdir + blk.filename;

  if (i_am_the_longest_chain == 1) { 
    let write_to_log = blk.block.id + "\t" + blk.returnHash() + "\t" + i_am_the_longest_chain + "\n";
    fs.appendFileSync(ledgerfile, write_to_log, function (err) {
      if (err) { throw err; }
    });
  }

  if (blk.hasTransactionsInBloomFilter(blk.app.wallet.returnPublicKey())) {
    fs.appendFileSync(block_filename, JSON.stringify(blk.block), function (err) {
      if (err) { throw err };
    });
  } else {
    fs.appendFileSync(block_filename, blk.prehash, function (err) {
      if (err) { throw err };
    });
  }

}


