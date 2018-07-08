const saito    = require('../saito');
const Big      = require('big.js');


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
  this.transaction.sig           = ""; 
  this.transaction.ver           = 1.0;
  this.transaction.path          = [];
  this.transaction.gt            = null;
  this.transaction.ft            = null;
  this.transaction.msg           = {};
  this.transaction.msig          = "";
  this.transaction.ps            = 0;
  this.transaction.rb            = 0;  // 0  = do not rebroadcast
				       // 1+ = num of current broadcast
				       // -1 = rebroadcast as VIP token
				       // -2 = rebroadcast as GoldenChunk

  ///////////////////
  // non-consensus //
  ///////////////////
  this.size			 = 0;  // size in bytes
  this.dmsg             	 = ""; // decrypted msg
  this.cfee                      = ""; // fee for block creator
  this.ufee                      = ""; // usable fee
  this.fee                       = ""; // total fee
  this.is_valid			 = 1;  // is valid tx
  this.trapdoor                  = "00000000000000000000000000000000000000000000";


  /////////
  // atr //
  /////////
  this.atr_rebroadcast_floor     = 10;


  /////////////////
  // import json //
  /////////////////
  if (txjson != "") {
    try {
      this.transaction = JSON.parse(txjson.toString("utf8"));
      if (this.transaction.from == null) { this.transaction.from = []; }
      if (this.transaction.to == null)   { this.transaction.to = []; }
      for (var txi = 0; txi < this.transaction.from.length; txi++) {
        this.transaction.from[txi] = new saito.slip(this.transaction.from[txi].add, this.transaction.from[txi].amt, this.transaction.from[txi].gt, this.transaction.from[txi].bid, this.transaction.from[txi].tid, this.transaction.from[txi].sid, this.transaction.from[txi].bhash, this.transaction.from[txi].lc, this.transaction.from[txi].ft, this.transaction.from[txi].rn);
      }
      for (var txi = 0; txi < this.transaction.to.length; txi++) {
        this.transaction.to[txi] = new saito.slip(this.transaction.to[txi].add, this.transaction.to[txi].amt, this.transaction.to[txi].gt, this.transaction.to[txi].bid, this.transaction.to[txi].tid, this.transaction.to[txi].sid, this.transaction.to[txi].bhash, this.transaction.to[txi].lc, this.transaction.to[txi].ft, this.transaction.to[txi].rn);
      }
    } catch (err) {
      this.is_valid = 0;
    }
  }

  return this;

}
module.exports = Transaction;



Transaction.prototype.addFrom = function addFrom(fromAddress, fromAmount) {
  this.from.push(new saito.slip(fromAddress, fromAmount));
}
Transaction.prototype.addTo = function addTo(toAddress, toAmount) {
  this.to.push(new saito.slip(toAddress, toAmount));
}
Transaction.prototype.decryptMessage = function decryptMessage(app) {
  // try-catch avoids errors decrypting non-encrypted content
  try {
    var x = app.keys.decryptMessage(this.transaction.from[0].add, this.transaction.msg);
    this.dmsg = x;
  } catch (e) {}
  return;
}

// validate
Transaction.prototype.validateRebroadcastTransaction = function validateRebroadcastTransaction(slip_id, avg_fee="2") {

  var fee = Big(avg_fee);
  if (fee.eq(0)) { fee = Big(2); }


  // check fee is appropriate
  if (this.transaction.rb >= 1) {

    console.log("normal rebroadcast transaction found (> 0)");

    for (i = 1; i < this.transaction.rb; i++) {
      fee = fee*2;
    }

    if (this.transaction.to.length < 2) {
      console.log("ERROR: rebroadcast transaction does not have fee transaction");
      return 0;
    }
    if (Big(this.transaction.to[1].amt).lt(fee)) { 
      console.log("ERROR: rebroadcast transaction fee inadequate");
      return 0;
    }
    if (this.transaction.to[1].add != this.trapdoor) { 
      console.log("ERROR: rebroadcast transaction fee not trapdoor address");
      return 0;
    }

  }


  if (this.transaction.rb == -1) {

    console.log("VIP rebroadcast transaction found (-1)");

    // TODO -- restrict to genesis key
    //if (this.transaction.from[0].add == "") {
    //  console.log("ERROR: VIP rebroadcast transaction sent from non-genesis key");
    //  return 0;
    //}

  }

  if (this.transaction.rb == -2) {

    console.log("golden chunk rebroadcast transaction found (-2)");

    // TODO -- restrict to genesis key
    //if (this.transaction.from[0].add == "") {
    //  console.log("ERROR: VIP rebroadcast transaction sent from non-genesis key");
    //  return 0;
    //}

  }

  return 1;

}

// accepts the old tx and creates one that will validate
Transaction.prototype.generateRebroadcastTransaction = function generateRebroadcastTransaction(slip_id, avg_fee=2) {

  if (this.transaction.to.length == 0) { 
    console.log("THERE ARE NO TO ADDRESSES IN THIS TX");
    return null; 
  }

  var newtx = new saito.transaction();
  newtx.transaction.sig = this.transaction.sig;
  newtx.transaction.msg = {};

  var fee = Big(avg_fee);
  if (avg_fee == 0) { fee = Big(2); }

  /////////////////////////
  // normal rebroadcasts //
  /////////////////////////
  if (this.transaction.rb >= 0) {

    newtx.transaction.rb = this.transaction.rb+1;
    for (i = 1; i < newtx.transaction.rb; i++) {
      fee = fee.times(2);
    }

    var amt = Big(this.transaction.to[slip_id].amt).minus(fee);
    if (amt.lt(0)) { 
      fee = Big(this.transaction.to[slip_id].amt);
      amt = Big(0);
    }

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = JSON.stringify(this.transaction);
    }

    // create TO and FROM slips
    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt);
    var to   = new saito.slip(this.transaction.to[slip_id].add, amt.toFixed(8));
    var fees = new saito.slip(this.trapdoor, fee.toFixed(8));

    // manually set slip_id as we are not signing so it won't be automatically done
    fees.sid = 1;

    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);
    newtx.transaction.to.push(fees);  // this ensures fee falls into money supply

//    console.log("\n\n\nNORMAL REBROADCAST TX GENERATED: " + JSON.stringify(newtx.transaction));
  }



  ///////////////////////////
  // prestige rebroadcasts //
  ///////////////////////////
  if (this.transaction.rb == -1) {

    // secure tokens for early supporters
    newtx.transaction.rb = this.transaction.rb;

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = JSON.stringify(this.transaction);
    }

    // copy over slips unless this is a trapdoor slip
    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt);
    var to   = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt);
    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);

  }



  //////////////////
  // golden chunk //
  //////////////////
  if (this.transaction.rb == -2) {

    newtx.transaction.rb = this.transaction.rb;

    // calculate fee
    //
    // average fee * 10
    //
    var fee = Big(Big(avg_fee).times(10).toFixed(8));
    // force minimum of 20
    if (fee.lt(20)) { fee = Big(20); }
    var amt = Big(this.transaction.to[slip_id].amt).minus(fee);
    if (amt.lt(0)) {
      fee = Big(this.transaction.to[slip_id].amt);
      amt = Big(0);
//console.log(fee.toFixed(8) + " -1- " + amt.toFixed(8));
    }

//console.log(fee.toFixed(8) + " -2- " + amt.toFixed(8));

    if (this.transaction.msg.tx != undefined) {
      newtx.transaction.msg.tx = this.transaction.msg.tx;
    } else {
      newtx.transaction.msg.tx = JSON.stringify(this.transaction);
    }

    // create TO and FROM slips
    var from = new saito.slip(this.transaction.to[slip_id].add, this.transaction.to[slip_id].amt);
    var to   = new saito.slip(this.transaction.to[slip_id].add, amt.toFixed(8));
    var fees = new saito.slip(this.trapdoor, fee.toFixed(8));

    // manually set slip_id as we are not signing so it won't be automatically done
    fees.sid = 1;

    newtx.transaction.from.push(from);
    newtx.transaction.to.push(to);
    newtx.transaction.to.push(fees);   // this ensures fee falls into money supply

  }



  return newtx;

}
Transaction.prototype.involvesPublicKey = function involvesPublicKey(publickey) {
  if (this.returnSlipsFrom(publickey).length > 0 || this.returnSlipsTo(publickey).length > 0 ) { return 1; }
  return 0;
}
Transaction.prototype.isGoldenTicket = function isGoldenTicket() {
  if (this.transaction.gt != null) { return 1; }
  return 0;
}
Transaction.prototype.isFeeTransaction = function isFeeTransaction() {
  if (this.transaction.ft != 1) { return 0; }
  return 1;
}
Transaction.prototype.isFrom = function isFrom(senderPublicKey) {
  if (this.returnSlipsFrom(senderPublicKey).length != 0) { return 1; }
  return 0;
}
Transaction.prototype.isTo = function isTo(receiverPublicKey) {
  if (this.returnSlipsTo(receiverPublicKey).length != 0) { return 1; }
  return 0;
}
Transaction.prototype.isAutomaticallyRebroadcast = function isAutomaticallyRebroadcast(deadblk, newblk, slip_id) {
  if (this.transaction.to.length == 0) { return 0; }
  if (this.transaction.to[slip_id].add == this.trapdoor) { 
//console.log("\n\n\n\nFOUND TRAPDOOR SLIP!\n\n");
return 0; }
  if (this.transaction.rb < 0)         { return 1; }
  if (Big(this.transaction.to[0].amt).gt(this.atr_rebroadcast_floor)) { return 1; }
  return 0;
}
Transaction.prototype.returnAmount = function returnAmount() {
  var x = Big(0.0);
  if (this.transaction.to != null) {
    for (let v = 0; v < this.transaction.to.length; v++) {
      let xy = Big(this.transaction.to[v].amt);
      if (xy.gt(0)) { x = x.plus(xy); }
    }
  }
  return x.toFixed(8);
}
Transaction.prototype.returnAmountTo = function returnAmountTo(toAddress) {
  var x = Big(0.0);
  if (this.transaction.to != null) {
    for (var v = 0; v < this.transaction.to.length; v++) {
      let xy = Big(this.transaction.to[v].amt);
      if (this.transaction.to[v].add == toAddress) {
        if (xy.gt(0)) { x = x.plus(xy); }
      }
    }
  }
  return x.toFixed(8);
}
Transaction.prototype.returnFeeUsable = function returnFeeUsable() {

  if (this.ufee == "" || this.ufee == null) {

    var inputs = Big(0.0);
    if (this.transaction.from != null) {
      for (var v = 0; v < this.transaction.from.length; v++) { 
       inputs = inputs.plus(Big(this.transaction.from[v].amt));
      }
    }

    var outputs = Big(0.0);
    for (var v = 0; v < this.transaction.to.length; v++) {
      // only count outputs on non-gt transactions
      if (this.transaction.to[v].gt != 1) {
        outputs = outputs.plus(Big(this.transaction.to[v].amt));
      }
    }

    this.fee = inputs.minus(outputs);
    if (this.fee.lt(0)) { this.fee = Big(0); }

    this.ufee = this.fee.toFixed(8);

    var pathlength = this.returnPathLength();

    for (var x = 1; x < pathlength; x++) {
      this.ufee = this.fee.div(2);
      this.ufee = this.ufee.toFixed(8);
    }

    this.fee = this.fee.toFixed(8);

    return this.ufee;
  } else {
    return this.ufee;
  }
}
Transaction.prototype.returnFeeUsableForBlockCreator = function returnFeeUsableForBlockCreator(app, block_miner) {

  // no path info, only valid if creator is originator
  if (this.transaction.path.length == 0) {
    if (block_miner != this.transaction.from[0].add) {
      console.log("ERROR: block miner is not originator");
      return Big(0).toFixed(8);
    }
  }

  // some path info
  //
  // return 0 unless we have a verifiable tx path from [0].add to creator
  //
  let from_node = this.transaction.from[0].add;
  let to_node   = null;

  //
  // check path info
  //
  for (let i = 0; i < this.transaction.path.length; i++) {
    if (this.transaction.path[i].from != from_node) { 
      console.log("ERROR: path does not validate");
      return Big(0).toFixed(8);
    }
    let msg_to_check = this.transaction.path[i].to;
    let sig_to_check = this.transaction.path[i].sig;
    if (!app.crypt.verifyMessage(msg_to_check, sig_to_check, from_node)) {
      console.log("ERROR: cannot verify entry in path");
      return Big(0).toFixed(8);
    }
    from_node = this.transaction.path[i].to;
  }


  //
  // return fees if already calculated
  //
  if (this.ufee != "") {
    this.cfee = this.ufee;
    return this.cfee;
  }


  //
  // calculate fees
  //
  var inputs = Big(0.0);
  if (this.transaction.from != null) {
    for (var v = 0; v < this.transaction.from.length; v++) { 
      inputs = inputs.plus(Big(this.transaction.from[v].amt));
    }
  }

  var outputs = Big(0.0);
  for (var v = 0; v < this.transaction.to.length; v++) {
    // only count outputs on non-gt transactions
    if (this.transaction.to[v].gt != 1) {
      outputs = outputs.plus(Big(this.transaction.to[v].amt));
    }
  }

  this.fee = inputs.minus(outputs);
  if (this.fee.lt(0)) { this.fee = Big(0); }

  this.ufee = this.fee.toFixed(8);
  this.cfee = this.ufee;

  var pathlength = this.returnPathLength();

  for (var x = 1; x < pathlength; x++) {
    this.cfee = this.fee.div(2);
    this.cfee = this.ufee.toFixed(8);
  }

  this.cfee = this.fee.toFixed(8);

  return this.cfee;

}
Transaction.prototype.returnFeeTotal = function returnFeeTotal() {

  if (this.fee == "" || this.fee == null) {

    var inputs = Big(0.0);
    for (var v = 0; v < this.transaction.from.length; v++) {
      inputs = inputs.plus(Big(this.transaction.from[v].amt));
    }

    var outputs = Big(0.0);
    for (var v = 0; v < this.transaction.to.length; v++) {
      // only count outputs on non-gt transactions
      if (this.transaction.to[v].gt != 1) {
        outputs = outputs.plus(Big(this.transaction.to[v].amt));
      }
    }

    this.fee = inputs.minus(outputs);
    if (this.fee.lt(0)) { this.fee = Big(0); }
    this.fee = this.fee.toFixed(8);
  }

  return this.fee;
}
Transaction.prototype.returnId = function returnId() {
  return this.transaction.id;
}
Transaction.prototype.returnMessage = function returnMessage() {
  if (this.dmsg != "") { return this.dmsg; }
  return this.transaction.msg;
}
Transaction.prototype.returnMessageSignatureSource = function returnMessageSignatureSource() {
  return JSON.stringify(this.transaction.msg);
}
Transaction.prototype.returnSignatureSource = function returnSignatureSource() {
  return JSON.stringify(this.transaction.from) + 
         JSON.stringify(this.transaction.to) + 
         this.transaction.ts +
         this.transaction.ps +
         this.transaction.rb +
         JSON.stringify(this.transaction.gt) +
         JSON.stringify(this.transaction.ft) +
         JSON.stringify(this.transaction.msig);
}
Transaction.prototype.returnSlipsTo = function returnSlipsTo(toAddress) {
  var x = [];
  if (this.transaction.to != null) {
    for (var v = 0; v < this.transaction.to.length; v++) {
      if (this.transaction.to[v].add == toAddress) { x.push(this.transaction.to[v]); }
    }
  }
  return x;
}
Transaction.prototype.returnSlipsFrom = function returnSlipsFrom(fromAddress) {
  var x = [];
  if (this.transaction.from != null) {
    for (var v = 0; v < this.transaction.from.length; v++) {
      if (this.transaction.from[v].add == fromAddress) { x.push(this.transaction.from[v]); }
    }
  }
  return x;
}
Transaction.prototype.returnTransactionJson = function returnTransactionJson() {
  return JSON.stringify(this.returnTransaction());
}
Transaction.prototype.returnTransaction = function returnTransaction() {
  return this.transaction;
}
Transaction.prototype.returnPathLength = function returnPathLength() {
  return this.transaction.path.length;
}
Transaction.prototype.returnSender = function returnSender() {
  if (this.transaction.from.length >= 1) {
    return this.transaction.from[0].add;
  }
}
Transaction.prototype.signMessage = function signMessage(message) {
  return saito.crypt().signMessage(message, this.app.wallet.returnPrivateKey());
}
Transaction.prototype.signTransaction = function signTransaction() {
  this.transaction.msig   = this.signMessage(this.transaction.msg);
  this.transaction.sig  = this.signMessage(this.returnSignatureSource());
}

Transaction.prototype.validate = function validate(app, paysplit_vote=0, block_id=0, avg_fee=2) {

  ////////////////////
  // validate votes //
  ////////////////////
  if (paysplit_vote == 1) {
    if (this.transaction.ps != 1 && this.transaction.gt != null) {
      console.log("transaction paysplit vote differs from block paysplit vote");
      app.mempool.removeTransaction(this);
      return 0;
    }
  }
  if (paysplit_vote == -1) {
    if (this.transaction.ps != -1 && this.transaction.gt != null) {
      console.log("transaction paysplit vote differs from block paysplit vote");
      app.mempool.removeTransaction(this);
      return 0;
    }
  }


  //////////////////////////////
  // rebroadcast transactions //
  //////////////////////////////
  if (this.transaction.rb > 0 || this.transaction.rb < 0) {
    if (this.validateRebroadcastTransaction(avg_fee) == 0) { return 0; }
  }


  ////////////////////////////////
  // ensure no negative numbers //
  ////////////////////////////////
  for (let i = 0; i < this.transaction.from.length; i++) {
    if (Big(this.transaction.from[i].amt).lt(0)) { return 0; }
  }
  for (let i = 0; i < this.transaction.to.length; i++) {
    if (Big(this.transaction.to[i].amt).lt(0)) { return 0; }
  }


  ///////////////////////////
  // within genesis period //
  ///////////////////////////
  var acceptable_lower_block_limit = block_id-app.blockchain.returnGenesisPeriod();
  for (var tidx = 0; tidx < this.transaction.from.length; tidx++) {
    if (this.transaction.from[tidx].bid < acceptable_lower_block_limit && this.transaction.ft != 1 && this.transaction.from[tidx].gt != 1) {
      if (Big(this.transaction.from[tidx].amt).gt(0)) {
        console.log("transaction outdated: tries to spend input from block "+this.transaction.from[tidx].bid);
        console.log(this.transaction.from[tidx]); 
        app.mempool.removeTransaction(this);
        return 0;
      }
    }
  }

  /////////////////////////////////
  // min one sender and receiver //
  /////////////////////////////////
  if (this.transaction.from.length < 1) { 
    console.log("no from address in transaction");
    app.mempool.removeTransaction(this);
    return 0;
  }
  if (this.transaction.to.length < 1) { 
    console.log("no to address in transaction");
    app.mempool.removeTransaction(this);
    return 0;
  }


  ///////////////////////////
  // validate tx signature //
  ///////////////////////////
  if (!saito.crypt().verifyMessage(this.returnSignatureSource(),this.transaction.sig,this.returnSender())) {

    // maybe this is a rebroadcast tx
    //if (this.transaction.rb == 1) {
    if (this.transaction.rb > 0 || this.transaction.rb == -1 || this.transaction.rb == -2) {

      var oldtx = new saito.transaction(this.transaction.msg.tx);

      // restore to original signed condition
      if (this.transaction.gt == 1 || this.transaction.ft == 1) {
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

      if (!saito.crypt().verifyMessage(oldtx.returnSignatureSource(), oldtx.transaction.sig, oldtx.returnSender())) {
        console.log("transaction signature in original rebroadcast tx does not verify");
        app.mempool.removeTransaction(this);
        return 0;
      }

    } else {
      console.log("transaction signature does not verify");
      app.mempool.removeTransaction(this);
      return 0;
    }

  }

  ////////////////////////////
  // validate msg signature //
  ////////////////////////////
  if (!saito.crypt().verifyMessage(this.returnMessageSignatureSource(),this.transaction.msig,this.returnSender())) {

    // maybe this is a rebroadcast tx
    if (this.transaction.rb >= 1 || this.transaction.rb == -1 || this.transaction.rb == -2) {

      var oldtx = new saito.transaction(this.transaction.msg.tx);

      // restore message to original condition
      for (let i = 0; i < oldtx.transaction.to.length; i++) {
        oldtx.transaction.to[i].bid = 0;
        oldtx.transaction.to[i].tid = 0;
        oldtx.transaction.to[i].sid = i;
        oldtx.transaction.to[i].bhash = "";
      }

      if (!saito.crypt().verifyMessage(oldtx.returnMessageSignatureSource(), oldtx.transaction.msig, oldtx.returnSender())) {
        console.log("transaction message signature does not verify");
        app.mempool.removeTransaction(this);
        return 0;
      }

    } else {
      console.log("transaction message signature does not verify");
      app.mempool.removeTransaction(this);
      return 0;
    }
  }

  return 1;

}




