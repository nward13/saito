const Big      = require('big.js');
const saito    = require('../saito');

/**
 * Transaction Constructor
 * @param {*} txjson
 */
function Transaction(txjson="") {

  if (!(this instanceof Transaction)) {
    return new Transaction(txjson);
  }

  /////////////////////////
  // consensus variables //
  /////////////////////////
  this.transaction               = {};
  this.transaction.id            = 1;
  this.transaction.from          = [];
  this.transaction.to            = [];
  this.transaction.ts            = "";
  this.transaction.sig           = "";  // sig of tx
  this.transaction.mhash         = "";  // hash of msg
  this.transaction.ver           = 1.0;
  this.transaction.path          = [];
  this.transaction.type          = 0; // 0 = normal
                                      // 1 = golden ticket
                                      // 2 = fee transaction
                                      // 3 = rebroadcasting
                                      // 4 = VIP rebroadcast
                                      // 5 = floating coinbase / golden chunk
  this.transaction.msg           = {};
  this.transaction.ps            = 0;


  this.fees_total                = "";
  this.fees_usable               = "";
  this.fees_publickey            = "";

  this.dmsg			 = "";
  this.size                      = 0;
  this.is_valid                  = 1;

  //
  // this address is used by the automatic transaction rebroadcasting functions
  // to identify slips that we are going to ALLOW to fall through our collection
  // and rebroadcast criteria. This is how we do things like bleed parts of the 
  // golden chunk.
  //
  // the rebroadcasting limit is the lower limit of SAITO that a transaction must
  // have and then we will rebroadcast it assuming it can pay the necessary fee.
  //
  // the golden chunk will point to the trapdoor_address but have a type of 5
  //
  this.atr_rebroadcasting_limit  = 10;
  this.atr_trapdoor_address      = "0";
  this.message_signature_source  = "";

  if (txjson != "") {
    try {

      let txobj = JSON.parse(txjson.toString("utf8"));

      //
      // both txjson as well as tx.transaction json
      //
      if (txobj.transaction == undefined)      { let t = txobj; txobj={}; txobj.transaction = t; }
      if (txobj.transaction.id != undefined)   { this.transaction.id   = txobj.transaction.id; }
      if (txobj.transaction.ts != undefined)   { this.transaction.ts   = txobj.transaction.ts; }
      if (txobj.transaction.from != undefined) { this.transaction.from = txobj.transaction.from; }
      if (txobj.transaction.to != undefined)   { this.transaction.to   = txobj.transaction.to; }
      if (txobj.transaction.sig != undefined)  { this.transaction.sig  = txobj.transaction.sig; }
      if (txobj.transaction.mhash != undefined) { this.transaction.mhash = txobj.transaction.mhash; }
      if (txobj.transaction.ver != undefined)  { this.transaction.ver  = txobj.transaction.ver; }
      if (txobj.transaction.path != undefined) { this.transaction.path = txobj.transaction.path; }
      if (txobj.transaction.type != undefined) { this.transaction.type = txobj.transaction.type; }
      if (txobj.transaction.msg != undefined)  { this.transaction.msg  = txobj.transaction.msg; }
      if (txobj.transaction.ps != undefined)   { this.transaction.ps   = txobj.transaction.ps; }

      for (let tpl = 0; tpl < this.transaction.path.length; tpl++) {
        let tmppath      = new saito.path();
            tmppath.from = this.transaction.path[tpl].from;
            tmppath.to   = this.transaction.path[tpl].to;
            tmppath.sig  = this.transaction.path[tpl].sig;
            this.transaction.path[tpl] = tmppath;
      }

      for (var txi = 0; txi < this.transaction.from.length; txi++) {
        this.transaction.from[txi] = new saito.slip(
          this.transaction.from[txi].add,
          this.transaction.from[txi].amt,
          this.transaction.from[txi].type,
          this.transaction.from[txi].bid,
          this.transaction.from[txi].tid,
          this.transaction.from[txi].sid,
          this.transaction.from[txi].bhash,
          this.transaction.from[txi].lc,
          this.transaction.from[txi].rn
        );
      }

      for (var txi = 0; txi < this.transaction.to.length; txi++) {
        this.transaction.to[txi] = new saito.slip(
          this.transaction.to[txi].add,
          this.transaction.to[txi].amt,
          this.transaction.to[txi].type,
          this.transaction.to[txi].bid,
          this.transaction.to[txi].tid,
          this.transaction.to[txi].sid,
          this.transaction.to[txi].bhash,
          this.transaction.to[txi].lc,
          this.transaction.to[txi].rn
        );
      }
    } catch (err) {
      console.log(err);
      this.is_valid = 0;
    }
  }

  return this;

}
module.exports = Transaction;


/**
 * Checks if any from fields in the slips contains a publickey and returns a boolean
 * @param {string} senderPublicKey
 * @return {boolean} does the publickey exist in from?
 */
Transaction.prototype.isFrom = function isFrom(senderPublicKey) {
  if (this.returnSlipsFrom(senderPublicKey).length != 0) { return true; }
  return false;
}


/**
 * Checks if any from fields in the slips contains a publickey and returns a boolean
 *
 * @return {boolean} is this transaction a golden ticket solution?
 */
Transaction.prototype.isGoldenTicket = function isGoldenTicket() {
  if (this.transaction.type == 1) { return 1; }
  return 0;
}

/**
 * Checks if any to fields in the slips contains a publickey and returns a boolean
 * @param {string} senderPublicKey
 * @return {boolean} does the publickey exist in to?
 */
Transaction.prototype.isTo = function isTo(receiverPublicKey) {
  if (this.returnSlipsTo(receiverPublicKey).length != 0) { return true; }
  return false;
}

/**
 * does this transaction reference this publickey?
**/
Transaction.prototype.involvesPublicKey = function involvesPublicKey(publickey) {
  let slips = this.returnSlipsToAndFrom(publickey);
  if (slips.to.length > 0 || slips.from.length > 0) { return 1; }
  return 0;
}


/**
 * Returns slips with publickey in from fields
 * @param {string} fromAddress
 * @return {saito.slips} slips_from
 */
Transaction.prototype.returnSlipsFrom = function returnSlipsFrom(fromAddress) {
  var x = [];
  if (this.transaction.from != null) {
    for (var v = 0; v < this.transaction.from.length; v++) {
      if (this.transaction.from[v].add == fromAddress) { x.push(this.transaction.from[v]); }
    }
  }
  return x;
}



/**
 * Returns slips with publickey in from and to fields
 * @param {string} fromAddress
 * @return {saito.slips} object with two arrays => slips_to, slips_from
 */
Transaction.prototype.returnSlipsToAndFrom = function returnSlipsToAndFrom(theAddress) {
  var x = {};
  x.from = [];
  x.to = [];
  if (this.transaction.from != null) {
    for (var v = 0; v < this.transaction.from.length; v++) {
      if (this.transaction.from[v].add == theAddress) { x.from.push(this.transaction.from[v]); }
    }
  }
  if (this.transaction.to != null) {
    for (var v = 0; v < this.transaction.to.length; v++) {
      if (this.transaction.to[v].add == theAddress) { x.to.push(this.transaction.to[v]); }
    }
  }
  return x;
}

/**
 * Returns slips with publickey in to fields
 * @param {string} toAddress
 * @return {saito.slips} slips_to
 */
Transaction.prototype.returnSlipsTo = function returnSlipsTo(toAddress) {
  var x = [];
  if (this.transaction.to != null) {
    for (var v = 0; v < this.transaction.to.length; v++) {
      if (this.transaction.to[v].add == toAddress) { x.push(this.transaction.to[v]); }
    }
  }
  return x;
}


/**
 * decrypt the message
 **/
Transaction.prototype.decryptMessage = function decryptMessage(app) {
  // try-catch avoids errors decrypting non-encrypted content
  try {
    var x = app.keys.decryptMessage(this.transaction.from[0].add, this.transaction.msg);
    this.dmsg = x;
  } catch (e) {
    console.log("\n\n\nERROR DECRYPTING MESSAGE!\n\n");
  }
  return;
}


/**
 * Returns the message attached to the transaction
**/
Transaction.prototype.returnMessage = function returnMessage() {
  if (this.dmsg != "") { return this.dmsg; }
  return this.transaction.msg;
}


/**
 * Returns the source text signed to create this.transaction.sig
 */
Transaction.prototype.returnSignature = function returnSignature(app) {
  if (this.transaction.sig != "") { return this.transaction.sig; }
  this.transaction.sig = app.wallet.signMessage(this.returnSignatureSource(app));
  return this.transaction.sig;
}


/**
 * Returns the source text signed to create this.transaction.sig
 */

Transaction.prototype.returnSignatureSource = function returnSignatureSource(app) {
  return this.stringifySlipsFrom()
    + this.stringifySlipsTo(2)
    + this.transaction.ts
    + this.transaction.ps
    + this.transaction.type
    + this.returnMessageHash(app);
}


/**
 * Returns this.transaction.mhash
 *
 * we include the transaction timestamp so that it is legit
 */
Transaction.prototype.returnMessageHash = function returnMessageHash(app) {
  if (this.transaction.mhash == "") { this.transaction.mhash = app.crypto.hash(this.returnMessageSignatureSource(app)); }
  return this.transaction.mhash;
}
Transaction.prototype.returnMessageSignatureSource = function returnMessageSignatureSource(app) {
  //return app.crypto.fastSerialize(this.transaction.msg) + this.transaction.ts;
  if (this.message_signature_source == "") { this.message_signature_source = app.crypto.fastSerialize(this.transaction.msg) + this.transaction.ts; }
  return this.message_signature_source;
}


/**
 * Returns total fees
 * @param {app} application
 * @param {string} creator publickey
 * @returns {string} usable transaction fees
 */
Transaction.prototype.returnFeesTotal = function returnFeesTotal(app, publickey="") {
  if (this.fees_publickey != publickey || this.fees_total == "") { this.calculateFees(app, publickey); }
  return this.fees_total;
}

/**
 * Returns usable fees
 * @param {app} application
 * @param {string} creator publickey
 * @returns {string} usable transaction fees
 */
Transaction.prototype.returnFeesUsable = function returnFeesUsable(app, publickey="") {
  if (this.fees_publickey != publickey || this.fees_usable == "") { this.calculateFees(app, publickey); }
  return this.fees_usable;
}
Transaction.prototype.returnFees = function returnFees() {
  if (this.fees_publickey != publickey || this.fees_usable == "") { this.calculateFees(app, publickey); }
  return this.fees_usable;
}
/**
 * calculates the usable and total transaction fees available from the
 * perspective of the creator publickey (provided as the second argument)
 * @param {app} application
 * @param {string} creator publickey
 */
Transaction.prototype.calculateFees = function calculateFees(app, publickey="") {

  //
  // keep track of which key these were calculated against
  // so that we can refresh the figures if a different key
  // is submitted in the future, and do not just return
  // the wrong figure out of habit.
  //
  this.fees_publickey == publickey;

  //
  // publickey should be block creator, or default to me
  //
  if (publickey == "") {
    publickey = app.wallet.returnPublicKey();
  }

  //
  // calculate total fees
  //
  var inputs = Big(0.0);
  if (this.transaction.from != null) {
    for (var v = 0; v < this.transaction.from.length; v++) {
      //
      // inputs counted on all tx types
      //
      inputs = inputs.plus(Big(this.transaction.from[v].amt));
    }
  }

  var outputs = Big(0.0);
  for (var v = 0; v < this.transaction.to.length; v++) {
    //
    // only count outputs on non-gt transactions
    //
    if (this.transaction.to[v].type != 1 && this.transaction.to[v].type != 2) {
      outputs = outputs.plus(Big(this.transaction.to[v].amt));
    }
  }

  let tx_fees = inputs.minus(outputs);
  this.fees_total = tx_fees.toFixed(8);

  //
  // mark negative total as invalid tx
  //
  if (tx_fees.lt(0)) { this.is_valid = 0; }

  //
  // calculate usable fees
  //
  if (this.transaction.path.length == 0) {
    // only valid if creator is originator
    if (publickey != this.transaction.from[0].add) {
      this.fees_usable = "0";
      return;
    }
  } else {
    // check publickey is last recipient
    if (publickey != "") {
      if (this.transaction.path[this.transaction.path.length-1].to != publickey) {
        this.fees_usable = "0";
        return;
      }
    }
  }

  //
  // check path integrity
  //
  let from_node = this.transaction.from[0].add;

  for (let i = 0; i < this.transaction.path.length; i++) {

    if (this.transaction.path[i].from != from_node) {
      // path invalid
      this.fees_usable = "0";
      return;
    }

    let msg_to_check = this.transaction.path[i].to;
    let sig_to_check = this.transaction.path[i].sig;

    if (!app.crypto.verifyMessage(msg_to_check, sig_to_check, from_node)) {
      // path invalid
      console.log("ERROR: transaction has invalid path signatures");
      this.fees_usable = "0";
      return;
    }

    from_node = this.transaction.path[i].to;
  }


  //
  // adjust usable fee for pathlength
  //
  var pathlength = this.returnPathLength();
  for (var x = 1; x < pathlength; x++) {
    tx_fees = tx_fees.div(2);
  }

  this.fees_usable = tx_fees.toFixed(8);
  return;

}


Transaction.prototype.returnPathLength = function returnPathLength() {
  return this.transaction.path.length;
}
Transaction.prototype.returnSender = function returnSender() {
  if (this.transaction.from.length >= 1) {
    return this.transaction.from[0].add;
  }
}


/**
 * validate that a transaction is valid given the consensus rules
 * of the blockchain. Note that this function can be called in two
 * different contents:
 *
 * 1. when adding transaction to mempool
 * 2. when confirming block is valid
 *
 * In the first case, we expect the block provided to the function
 * to be null. In the latter case, we expect to have the actual
 * block.
 *
 * @returns {boolean} true_if_validates
 **/
Transaction.prototype.validate = function validate(app, blk=null) {

  if (app.BROWSER == 1 || app.SPVMODE == 1) { return true; }

  //
  // set defaults
  //
  let block_id = app.blockchain.returnLatestBlockId();
  let block_paysplit_vote = 0;
  let avg_fee = 2;


  if (blk != null) { block_id = blk.block.id; }

  if (this.is_valid == 0) { return false; }


  ////////////////////////////
  // confirm inputs unspent //
  ////////////////////////////
  if (!app.storage.validateTransactionInputs(this.transaction.from, app.blockchain.returnLatestBlockId())) {
    console.log("Transaction Invalid: checking inputs in validate function");
    return false;
  }


  /////////////////////////////////
  // min one sender and receiver //
  /////////////////////////////////
  if (this.transaction.from.length < 1) {
    console.log("no from address in transaction");
    return false;
  }
  if (this.transaction.to.length < 1) {
    console.log("no to address in transaction");
    return false;
  }


  /////////////
  // VIP TXs //
  /////////////
  //
  // should be replaced with:
  //
  // app.GENESIS_PUBLICKEY
  // 
  // on deployment
  //
  if (this.transaction.type == 4 && this.transaction.msg == {}) {
    if (this.transaction.from[0].add != this.app.wallet.returnPublicKey()) {
      console.log("Unapproved VIP transaction - we have to pay fees to support the network, folks!");
      return 0; 
    }
  }



  //////////////////////////
  // no negative payments //
  //////////////////////////
  let total_from = Big(0.0);
  for (let i = 0; i < this.transaction.from.length; i++) {
    total_from = total_from.plus(Big(this.transaction.from[i].amt));
    if (total_from.lt(0)) { 
      console.log("WE HAVE FOUND A NEGATIVE PAYMENT IN THE FROM AMT");
      return 0; 
    }
  }
  let total_to = Big(0.0);
  for (let i = 0; i < this.transaction.to.length; i++) {
    total_to = total_to.plus(Big(this.transaction.to[i].amt));
    if (total_to.lt(0)) { 
      console.log("WE HAVE FOUND A NEGATIVE PAYMENT IN THE TO AMT");
      return 0;
    }
  }
  if (this.transaction.type == 0 || this.transaction.type >= 3) {
    if (total_to.gt(total_from)) {
      console.log("WE HAVE FOUND A NEGATIVE PAYMENT - TO > FROM");
      return 0;
    }
  }




  //
  // NOTE
  //
  // at this point we have done all of the validation that would happen
  // if we were provided a transaction without a block. From this point
  // on our checks are for things that require consistency between the
  // transaction and the block / blockchain containing it.
  //
  // return 1 because there is no block provided, so if we have hit this
  // point the transaction has passed our superficial validation tests
  //
  if (blk == null) { return 1; }

  //
  // update variables
  //
  block_paysplit_vote = blk.block.vote;
  block_id = blk.block.id;
  avg_fee = 2;


  ////////////////////
  // validate votes //
  ////////////////////
  if (block_paysplit_vote == 1) {
    if (this.transaction.ps != 1 && this.transaction.type == 0) {
      console.log("transaction paysplit vote differs from block paysplit vote");
      return false;
    }
  }
  if (block_paysplit_vote == -1) {
    if (this.transaction.ps != -1 && this.transaction.type == 0) {
      console.log("transaction paysplit vote differs from block paysplit vote");
      app.mempool.removeTransaction(this);
      return false;
    }
  }


  ///////////////////////////
  // within genesis period //
  ///////////////////////////
  let acceptable_lower_block_limit = block_id - app.blockchain.returnGenesisPeriod();
  for (let tidx = 0; tidx < this.transaction.from.length; tidx++) {
    if (this.transaction.from[tidx].bid < acceptable_lower_block_limit && this.transaction.type == 0) {
      if (Big(this.transaction.from[tidx].amt).gt(0)) {
        console.log("transaction outdated: tries to spend input from block "+this.transaction.from[tidx].bid);
        console.log(this.transaction.from[tidx]);
        app.mempool.removeTransaction(this);
        return false;
      }
    }
  }

  return true;

}

/**
 * Validate
 **/
Transaction.prototype.clusterValidate = function clusterValidate(app) {

  ///////////////////////////
  // validate tx signature //
  ///////////////////////////
  if (!app.crypto.verifyMessage(this.returnSignatureSource(app), this.transaction.sig, this.returnSender())) {

    //
    // maybe this is a rebroadcast tx
    //
    // check if we can make its tx-within-a-tx validate
    //
    if (this.transaction.type >= 3 && this.transaction.type <= 5) {

      if ((this.transaction.type == 4 || this.transaction.type == 5) && this.transaction.msg == {}) {
	//
	// the transaction class needs to check that this passes muster
	// on the sender restrictions.
	//
	console.log("validating first-time rebroadcast VIP transaction");
        return 1;
      }

      if (this.transaction.msg.tx == undefined) {
        console.log("transaction message signature does not verify, and there is no internal rebroadcast tx");
        return false;
      }

      var oldtx = new saito.transaction(this.transaction.msg.tx);

      //
      // fee tickets and golden tickets have special rules
      //
      if (oldtx.transaction.type == 1 || oldtx.transaction.type == 2) {
        for (let vi = 0; vi < oldtx.transaction.to.length; vi++) {
          oldtx.transaction.to[vi].bid = 0;
          oldtx.transaction.to[vi].tid = 0;
          oldtx.transaction.to[vi].sid = vi;
          oldtx.transaction.to[vi].bhash = "";
        }
      } else {

        // all but the first (source of funds) txs will be new for VIP
        // and thus must have bhash reset to nothing
        for (let vi = 0; vi < oldtx.transaction.to.length; vi++) {
          oldtx.transaction.to[vi].bid = 0;
          oldtx.transaction.to[vi].tid = 0;
          oldtx.transaction.to[vi].sid = vi;
          oldtx.transaction.to[vi].bhash = "";
        }

      }

      if (!app.crypto.verifyMessage(oldtx.returnSignatureSource(app), oldtx.transaction.sig, oldtx.returnSender())) {
	//
	// VIP and Golden Transactions should not fail
	//
	//if (this.transaction.msg == {} && (this.transaction.type == 4 || this.transaction.type == 5)) {
        //  console.log("transaction is a VIP / Golden Ticket transaction with no message field -- this will have been approved earlier if from correct account");
	//  return;
	//} else {
          console.log("transaction signature in original rebroadcast tx does not verify");
          return 0;
	//}
      } else {
        console.log("ATR TX Validated: ");
        console.log(oldtx.returnSignatureSource(app) + " -- " + oldtx.transaction.sig + " -- " + oldtx.returnSender());
	return 1;
      }
    } else {
      console.log("transaction message signature does not verify 1");
      console.log(JSON.stringify(this.transaction));
      console.log("Failed TX Source: " + this.returnSignatureSource(app) + " -- " + this.returnSender());
      app.mempool.removeTransaction(this);
      return 0;
    }
    console.log("transaction invalid: signature does not verify");
    return false;

  }

  return 1;

}







/**
 * Returns true if we should rebroadcast this tx according to the
 * consensus criteria.
 *
 * @returns {boolean} should we automatically rebroadcast?
 **/
Transaction.prototype.isAutomaticallyRebroadcast = function isAutomaticallyRebroadcast(oldblk, newblk, slip_id) {

  //
  // fee-capture and golden tickets never rebroadcast
  //
  // if (this.transaction.type == 1) 				         { return false; }
  // if (this.transaction.type == 2) 				         { return false; }
  // if (this.transaction.type == 3) 				         { return false; }
  //
  // Golden Chunk transactions must point to the trapdoor address in order to be considered valid
  //
  if (this.transaction.to[slip_id].add  == this.atr_trapdoor_address) {
    if (this.transaction.to[slip_id].type == 5) { return true; }
    return false;
  }

  if (this.transaction.to.length == 0) 				         { return false; }
  if (this.transaction.type == 4) 				         { return true; }
  if (Big(this.transaction.to[slip_id].amt).gt(this.atr_rebroadcasting_limit)) { return true; }

  return false;

}





/*
 * create a transaction that is valid and that will rebroadcast the relevant tokens
 *
 * the rebroadcast transactions are handled on a slip-by-slip basis. So we will be
 * splitting up a transaction according to its UTXO if needed.
 *
 **/
Transaction.prototype.generateRebroadcastTransaction = function generateRebroadcastTransaction(tid, slip_id, avg_fee=2) {

  if (this.transaction.to.length == 0) { return null; }

  var newtx = new saito.transaction();
  newtx.transaction.sig = this.transaction.sig;
  newtx.transaction.msg = {};
  newtx.transaction.ts  = new Date().getTime();

  var fee = Big(avg_fee);
  if (avg_fee == 0) { fee = Big(2); }


  /////////////////////////
  // normal rebroadcasts //
  /////////////////////////
  //
  // TODO
  //
  // we don't want to circulate golden tickets or fee transactions
  // people should be spending them.
  //
  //if (this.transaction.type == 3 || this.transaction.type == 0) {
  if (this.transaction.type >= 0 && this.transaction.type <= 3) {

    newtx.transaction.type = 3;
    if (this.transaction.msg.loop == undefined) {
      newtx.transaction.msg.loop = 1;
    } else {
      newtx.transaction.msg.loop = this.transaction.msg.loop+1;
    }

    for (i = 1; i < newtx.transaction.msg.loop; i++) { fee = fee.times(2); }

    var amt = Big(this.transaction.to[slip_id].amt).minus(fee);
    if (amt.lt(0)) {
      fee = Big(this.transaction.to[slip_id].amt);
      amt = Big(0);
    }

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = this.stringify(2);
    }

    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt, 3);
        from.tid = tid;
        from.sid = slip_id;
    var to   = new saito.slip(this.transaction.to[slip_id].add, amt.toFixed(8), 3);
    var fees = new saito.slip(this.atr_trapdoor_address, fee.toFixed(8));
    fees.sid = 1;

    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);
    newtx.transaction.to.push(fees);

  }


  ///////////////////////////
  // prestige rebroadcasts //
  ///////////////////////////
  if (this.transaction.type == 4) {

    // protecting early supporters
    newtx.transaction.type = this.transaction.type;

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = this.stringify(2);
    }

    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt, 4);
        from.tid = tid;
        from.sid = slip_id;
    var to   = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt, 4);
    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);

  }



  //////////////////
  // golden chunk //
  //////////////////
  if (this.transaction.type == 5) {

    newtx.transaction.type = this.transaction.type;

    // calculate fee
    //
    // average fee * 10
    //
    var fee = Big(Big(avg_fee).times(10).toFixed(8));

    //
    // minimum of 20
    //
    if (fee.lt(20)) { fee = Big(20); }
    var amt = Big(this.transaction.to[slip_id].amt).minus(fee);
    if (amt.lt(0)) {
      fee = Big(this.transaction.to[slip_id].amt);
      amt = Big(0);
    }

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = this.stringify(2);
    }

    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt, 5);
        from.tid = tid;
        from.sid = slip_id;
    var to   = new saito.slip(this.transaction.to[slip_id].add, amt.toFixed(8), 5);
    var fees = new saito.slip(this.atr_trapdoor_address, fee.toFixed(8));
    fees.sid = 1;

    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);
    newtx.transaction.to.push(fees);   // this ensures fee falls into money supply

  }

  return newtx;

}



/*
 * serializer for testing intended to replace JSON.stringify with something faster
 */
Transaction.prototype.stringify = function stringify(escape_quotes=0) {

  // 0 = raw
  // 1 = escaped for inclusion in block
  // 2 = with TO slips output as ready for SIG
  if (escape_quotes == 0) {

    let json    =  '{"transaction":{"id":' + this.transaction.id + ','
                +  '"from":['
                +  this.stringifySlipsFrom(0)
                +  '],"to":['
                +  this.stringifySlipsTo(0)
                +  '],"ts":' + this.transaction.ts + ','
                +  '"sig":"' + this.transaction.sig + '",'
                +  '"mhash":"' + this.transaction.mhash + '",'
                +  '"ver":' + this.transaction.ver + ','
                +  '"path":[';

    for (let i = 0; i < this.transaction.path.length; i++) {
      if (i != 0) { json += ','; }
      json      += this.transaction.path[i].stringify();
    }

      json      += '],'
                +  '"type":' + this.transaction.type + ','
		+  '"msg":' + JSON.stringify(this.transaction.msg) + ','
		+  '"ps":' + this.transaction.ps + '}}';

    return json;

  } else {

    if (escape_quotes == 1) {

      //
      // TODO
      //
      // baffles me why we need to escape our escapes in this part of the 
      // function but otherwise they don't show up in block.bundle when
      // requested
      //
      let json    =  '{\\"transaction\\":{\\"id\\":' + this.transaction.id + ','
                  +  '\\"from\\":['
                  +  this.stringifySlipsFrom(1)
                  +  '],\\"to\\":['
                  +  this.stringifySlipsTo(1)
                  +  '],\\"ts\\":' + this.transaction.ts + ','
                  +  '\\"sig\\":\\"' + this.transaction.sig + '\\",'
                  +  '\\"mhash\\":\\"' + this.transaction.mhash + '\\",'
                  +  '\\"ver\\":' + this.transaction.ver + ','
                  +  '\\"path\\":[';

      for (let i = 0; i < this.transaction.path.length; i++) {
        if (i != 0) { json += ','; }
        json      += this.transaction.path[i].stringify(1);
      }

      json      += '],'
                +  '\\"type\\":' + this.transaction.type + ','
		+  '\\"msg\\":' + JSON.stringify(this.transaction.msg).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + ','
		+  '\\"ps\\":' + this.transaction.ps + '}}';

      return json;

    } else {

      // escape quotes == 2 means we are generating the output for our SIGNATURE_SOURCE !
      //
      // this means everything is unescaped, except TO slips are reset to their
      // original state in order to ensure that the signature is always going to 
      // match up with that created by the original signer.
      //
      let json    =  '{"transaction":{"id":' + this.transaction.id + ','
                  +  '"from":['
                  +  this.stringifySlipsFrom(0)
                  +  '],"to":['
                  +  this.stringifySlipsTo(2)
                  +  '],"ts":' + this.transaction.ts + ','
                  +  '"sig":"' + this.transaction.sig + '",'
                  +  '"mhash":"' + this.transaction.mhash + '",'
                  +  '"ver":' + this.transaction.ver + ','
                  +  '"path":[';

      for (let i = 0; i < this.transaction.path.length; i++) {
        if (i != 0) { json += ','; }
        json      += this.transaction.path[i].stringify();
      }

      json      += '],'
                +  '"type":' + this.transaction.type + ','
		+  '"msg":' + JSON.stringify(this.transaction.msg) + ','
		+  '"ps":' + this.transaction.ps + '}}';

      return json;

    }
  }

}
Transaction.prototype.stringifySlipsTo = function stringifySlipsTo(escape_quotes=0) {

  let json = "";

  //
  // 0 = no escape
  // 1 = escape
  // 2 = reset TO slips to original state (used in sig verification / generation)
  //
  if (escape_quotes == 0) {
    for (let i = 0; i < this.transaction.to.length; i++) {
      if (i != 0) { json += ','; }
      json      += this.transaction.to[i].stringify(0);
    }
  } else {
    for (let i = 0; i < this.transaction.to.length; i++) {
      if (i != 0) { json += ','; }
      json      += this.transaction.to[i].stringify(escape_quotes);
    }
  }
  return json;

}
Transaction.prototype.stringifySlipsFrom = function stringifySlipsFrom(escape_quotes=0) {

  let json = "";
  if (escape_quotes == 0) {
    for (let i = 0; i < this.transaction.from.length; i++) {
      if (i != 0) { json += ','; }
      json      += this.transaction.from[i].stringify();
    }
  } else {
    for (let i = 0; i < this.transaction.from.length; i++) {
      if (i != 0) { json += ','; }
      json      += this.transaction.from[i].stringify(1);
    }
  }
  return json;

}






