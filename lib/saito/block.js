'use strict';

const saito = require('../saito');
const Big = require('big.js');


function Block(app, blkjson="", conf=-1) {

  if (!(this instanceof Block)) {
    return new Block(app, blkjson, conf=-1);
  }

  this.app = app || {};

  /////////////////////////
  // consensus variables //
  /////////////////////////
  this.block                  = {};
  this.block.unixtime         = new Date().getTime();
  this.block.prevhash         = "";
  this.block.merkle           = "";
  this.block.miner            = "";
  this.block.id               = 1;
  this.block.transactions     = [];
  this.block.burn_fee         = 2.0;
  this.block.fee_step         = 0.000165;
  this.block.difficulty       = 0.0;
  this.block.paysplit         = 0.5;
  this.block.treasury         = Big("10000000000.0");
  this.block.coinbase         = Big("0.0");
  this.block.reclaimed        = Big("0.0");
  this.block.paysplit_vote    = 0;     // -1 reduce miner payout
                                       //  0 no change
                                       //  1 increase miner payout
  this.block.segadd	      = [];


  //////////
  // size // (bytes)
  //////////
  this.size                   = 0;


  /////////////////////////////////
  // automated tx rebroadcasting //
  /////////////////////////////////
  this.atr                    = 1;
  this.atr_lower_limit        = 50;
  this.atr_fee_curve          = 2;  // (exponential)

  ////////////////////
  // min and max tx //
  ////////////////////
  this.mintid                 = 0;
  this.maxtid                 = 0;

  ////////////////////////
  // non-consensus vars //
  ////////////////////////
  this.is_valid               = 1;
  this.filename               = "";    // permanent filename on disk
  this.hash                   = "";
  this.transactions           = [];    // objects
  this.confirmations          = conf;  // confirmations
  this.prevalidated           = 0;     // set to 1 to forceAdd to blockchain
				       // without running callbacks


  ///////////////
  // callbacks //
  ///////////////
  this.callbacks              = [];
  this.callbacksTx            = [];


  ///////////////////////
  // who sent me this? //
  ///////////////////////
  this.originating_peer       = ""; // me


  ///////////////
  // reference //
  ///////////////
  this.average_fee            = "";


  /////////////////////////
  // segmented addresses //
  /////////////////////////
  this.segadd_max	      = 0;
  this.segadd_map	      = [];
  this.segadd_enabled	      = 1;
  this.segadd_compression     = 0;


  /////////////////////
  // reindexing vars //
  /////////////////////
  this.saveBlockId            = -1;
  this.saveDatabaseId         = -1;


  if (blkjson != "") {
    try {
      this.block = JSON.parse(blkjson.toString("utf8"));

      for (var i = 0; i < this.block.transactions.length; i++) {
        this.transactions[i] = new saito.transaction(this.block.transactions[i]);

        if (this.transactions[i].is_valid == 0) {
          this.is_valid = 0;
          return;
        }
      }
    } catch (err) {
      this.app.logger.logError("Error thrown in Block constructor", err);
      this.is_valid = 0;
      return;
    }
  }

  return this;

}
module.exports = Block;


Block.prototype.addTransaction = function addTransaction(tx) {
  this.block.transactions.push(JSON.stringify(tx));
  this.transactions.push(tx);
}
// when we add teh callbacks, we have to decide whether there
// is a decrypted msg field we use instead of the default encrypted
// or basic one
Block.prototype.affixCallbacks = function affixCallbacks() {
  for (var z = 0; z < this.transactions.length; z++) {
    var txmsg = this.transactions[z].returnMessage();
    this.app.modules.affixCallbacks(z, txmsg, this.callbacks, this.callbacksTx, this.app);
  }
}

Block.prototype.bundleBlock = function bundleBlock(prevblock=null) {

console.log("block to bundle block:   " + (new Date().getTime()));

  //////////////////
  // sanity check //
  //////////////////
  if (this.app.blockchain.currently_indexing == 1 && this.app.blockchain.currently_reclaiming == 1 && this.app.mempool.currently_clearing == 1) {
    var { currently_indexing, currently_reclaiming } = this.app.blockchain
    console.log(`block.js -- busy and refusing to create block: ${currently_indexing} / ${currently_reclaiming} / ${this.app.mempool.currently_clearing}`);

    this.app.logger.logInfo(`block.js -- busy and refusing to create block: ${currently_indexing} / ${currently_reclaiming} / ${this.app.mempool.currently_clearing}`)
    return 0;
  }

  /////////////////
  // alphabetize //
  /////////////////
  this.transactions.sort();

  ///////////////////////////
  // seequential block IDs //
  ////////////////////////////
  if (prevblock == null) {
    this.block.id = 1;
  } else {
    this.block.id = prevblock.block.id+1;
  }

  ////////////////////////////////
  // sequential transaction IDs //
  ////////////////////////////////
  var mtid = 0;
  if (prevblock != null) { mtid = prevblock.returnMaxTxId(); }
  for (i = 0; i < this.transactions.length; i++) {
    mtid++;
    this.transactions[i].transaction.id = mtid;
  }

  /////////////////////////////
  // insert transaction json //
  /////////////////////////////
  for (var i = 0; i < this.transactions.length; i++) {
    this.block.transactions[i] = this.transactions[i].returnTransactionJson();
  }


  ////////////////////////
  // set default values //
  ////////////////////////
  this.originating_peer   = "";


  if (this.transactions.length == 0) {
    this.block.merkle     = "";
  } else {
    this.block.merkle     = this.app.crypt.returnMerkleTree(this.block.transactions).root;
  }
  this.block.miner        = this.app.wallet.returnPublicKey();

  if (prevblock != null) {

    this.block.treasury = Big(prevblock.block.treasury).plus(prevblock.block.reclaimed);
    this.block.coinbase = Big(this.block.treasury).div(this.app.blockchain.genesis_period).toFixed(8);
    this.block.treasury = this.block.treasury.minus(Big(this.block.coinbase)).toFixed(8);

    console.log("TREASURY: " + this.block.treasury);
    console.log("COINBASE: " + this.block.coinbase);

    this.block.prevhash   = prevblock.returnHash();
    this.block.difficulty = prevblock.returnDifficulty();
    this.block.paysplit   = prevblock.returnPaysplit();
    this.block.burn_fee   = prevblock.returnBurnFee();
    this.block.fee_step   = prevblock.returnFeeStep();
  }

  // consensus variables if genesis block
  if (this.block.id == 1) {
      this.block.prevhash   = "";
      this.block.paysplit   = 0.5;
      this.block.difficulty = 0.1875;
  }

  ///////////////////
  // paysplit vote //
  ///////////////////
  //
  // now set in mempool as we select the txs for inclusion there
  //

  //////////////
  // burn fee //
  //////////////
  var nbf = this.calculateBurnFee(this.block.burn_fee, this.block.fee_step);
  this.block.burn_fee = nbf[0];
  this.block.fee_step = nbf[1];

console.log("set burn fee: " + this.block.burn_fee + " ========== fee_step: " + this.block.fee_step);


  /////////////////////
  // monetary policy //
  /////////////////////
  var block_self = this;

console.log("block to reclaim funds:  " + (new Date().getTime()));
  this.calculateReclaimedFunds(0, function(reclaimed, validates=0) {

console.log("block to reclaim funds2  " + (new Date().getTime()));

    //////////////////////////////////////
    // repeat ourselves as new tx added //
    //////////////////////////////////////

    //
    // TODO - test to see if we can remove this earlier
    //
    block_self.transactions.sort();
    var mtid = 0;
    if (prevblock != null) { mtid = prevblock.returnMaxTxId(); }
    for (i = 0; i < block_self.transactions.length; i++) {
      mtid++;
      block_self.transactions[i].transaction.id = mtid;
    }
    for (var i = 0; i < block_self.transactions.length; i++) {
      block_self.block.transactions[i] = block_self.transactions[i].returnTransactionJson();
    }
    if (block_self.transactions.length == 0) {
      block_self.block.merkle     = "";
    } else {
      block_self.block.merkle     = block_self.app.crypt.returnMerkleTree(block_self.block.transactions).root;
    }





    ///////////////////////////////////////////
    // lite nodes will not properly set this //
    ///////////////////////////////////////////
    //
    // Big.js number
    //
    block_self.block.reclaimed = reclaimed;

    /////////////////////////////////////
    // add to blockchain and propagate //
    /////////////////////////////////////
    if (validates == 1) {
      block_self.app.blockchain.validateBlockAndQueueInMempool(block_self, 1);    // 1 = propagate
    }
    block_self.app.mempool.currently_creating = 0;

  });
}

//
// @validate = 1 (validate that the tx is in teh new block)
//             0 (add transactions to the new block to keep onchain)
Block.prototype.calculateReclaimedFunds = function calculateReclaimedFunds(validate=0, mycallback) {

  // lite nodes exit quickly
  if (this.app.SPVMODE == 1) { mycallback(Big(0.0), 1); return; }

  var eliminated_block = this.returnId() - this.app.blockchain.returnGenesisPeriod() - 1;
  var total_amount_to_add_to_treasury = 0.0;
  var does_block_validate = 1;
  var total_rebroadcast = 0;
  var current_rebroadcast = 0;

  if (eliminated_block < 1) {
    mycallback(Big(0.0), 1);
    return;
  } else {

    var block_self = this;

    var sql = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
//    console.log("SELECT * FROM blocks WHERE longest_chain = 1 AND block_id = " + eliminated_block);
    var params = { $longest_chain : 1, $block_id : eliminated_block }
    block_self.app.storage.queryDatabase(sql, params, function(err, row) {

      if (row == null) {
        console.log("Error handling monetary policy....");
        this.app.logger.logError("Error handling monetary policy....", {message:"",err:""});
        process.exit(0);
      }

      var db_id = row.id;
      var bid   = row.block_id;

      var filename = db_id + "-" + bid + ".blk";

      block_self.app.storage.openBlockByFilename(filename, function(storage_self, blk) {

        if (row == null) {
          block_self.log("Error opening block that is supposed to be on disk: " + filename);
          this.app.logger.logError(`Error opening block that is supposed to be on disk: ${filename}`,
            {message:"",err:""});
          process.exit(0);
        }

	var unspent_amt = Big(0.0);

	for (var i = 0; i < blk.transactions.length; i++) {

          //
          // the TO slips are the ones that may or may
          // not have been spent, so we check to see if
          // they are spent using our hashmap.
          //
	  for (var ii = 0; ii < blk.transactions[i].transaction.to.length; ii++) {

	    var slip = blk.transactions[i].transaction.to[ii];
	    slip.bid = blk.returnId();
	    slip.tid = blk.transactions[i].transaction.id;
	    slip.sid = ii;
	    slip.bhash = blk.returnHash();


            if (Big(slip.amt).gt(0)) {

	      if (slip.bhash == "") { slip.bhash = blk.returnHash(); }
              if (slip.gt != null || slip.ft != null) {
if (slip.add == blk.transactions[i].trapdoor) {
  console.log("FOUND TRAPDOOR SLIP: " + JSON.stringify(slip));
  console.log("spent? " + storage_self.isSlipSpent(slip, block_self.returnId()));
}

                if (storage_self.isSlipSpent(slip, block_self.returnId()) == 0) {

		  console.log("\n\n\nSLIP " + ii + " IS NOT SPENT: " + JSON.stringify(slip));

		  //////////////////////////////////////////
		  // automatic transaction rebroadcasting //
		  //////////////////////////////////////////	// deadblk, newblk, slip_id
		  if (blk.transactions[i].isAutomaticallyRebroadcast(blk, block_self, ii) == 1) {
		  console.log("\n\n\nSLIP " + ii + " IS AUTOREBROADCAST: " + JSON.stringify(slip));
		  console.log("Automatic Transaction Rebroadcasting: ");
		    current_rebroadcast++;
		    // let us know which slip is getting rebroadcast
		    var newtx = blk.transactions[i].generateRebroadcastTransaction(ii, block_self.block.paysplit_vote);
		    if (newtx == null) {
		      console.log("ERROR GENERATING REBROADCAST TX: null tx returned");
		      mycallback(Big(0.0), 0);
		      return;
		      //process.exit(0);
		    }
		    console.log("NEW: " + JSON.stringify(newtx.transaction));

		    // inform system that BID for tx is this block
		    for (let iii = 0; iii < newtx.transaction.from.length; iii++) {
		      newtx.transaction.from[iii].bid = block_self.block.id;
		    }

		    if (validate == 1) {
		      console.log(" ... just validating");
		      does_block_validate = 0;
		      for (let v = 0; v < block_self.transactions.length; v++) {
		        if (block_self.transactions[v].transaction.sig == blk.transactions[i].transaction.sig) {
		          does_block_validate = 1;
		          v = block_self.transactions.length+1;
		        }
                      }
console.log("\n\n\nVALIDATING: " + does_block_validate);
		    } else {
console.log("\n\n\nADDING TX TO BLOCK SELF: ");
		      block_self.addTransaction(newtx);
		    }
		  } else {
		    unspent_amt = unspent_amt.plus(Big(slip.amt));
		  }
	        }
	      }
            }
          }
        }

        // more rebroadcast txs than we want
	//
	// TODO
	//
	// clear new txs so that they do not claim to be rebroadcast 
        //
        // check that only the txs we have rebroadcast are the rebroadcasting ones
        //
        for (let v = 0; v < block_self.transactions.length; v++) {
          if (block_self.transactions[v].transaction.rb != 0) {
	    total_rebroadcast++;
          }
        }

	if (total_rebroadcast < current_rebroadcast) {
	  console.log("Validation Error: too many rebroadcast transactions: " + total_rebroadcast + " - " + current_rebroadcast);
	  does_block_validate = 0;
        }

        var sql2 = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
        var params2 = { $longest_chain : 1, $block_id : eliminated_block+1 }
        block_self.app.storage.queryDatabase(sql2, params2, function(err2, row2) {

          if (row2 == null) {
            console.log("Error handling monetary policy....");
            block_self.app.logger.logError("Error handling monetary policy....", {message:"",err:""});
            process.exit(0);
          }

          var db_id2 = row2.id;
          var bid2   = row2.block_id;
          var bgt    = row2.golden_ticket;

          if (bgt == 0) {

            var sql3 = "SELECT * FROM blocks WHERE longest_chain = $longest_chain AND block_id = $block_id";
            var params3 = { $longest_chain : 1, $block_id : eliminated_block }
            block_self.app.storage.queryDatabase(sql3, params3, function(err3, row3) {

              if (row3 == null) {
                console.log("Error handling monetary policy....");
                block_self.app.logger.logError("Error handling monetary policy....", {message:"",err:""});
                process.exit(0);
              }

              var db_id3 = row3.id;
              var bid3   = row3.block_id;

              var filename3 = db_id3 + "-" + bid3 + ".blk";

              block_self.app.storage.openBlockByFilename(filename3, function(storage_self3, blk3) {

                if (blk3 == null) {
                  console.log("Error handling monetary policy: block missing from disk: " + filename3);
                  block_self.app.logger.logError(`Error handling monetary policy: block missing from disk: ${filename3}`,
                    {message:"",err:""});
                  process.exit(0);
                }

                unspent_amt = unspent_amt.plus(Big(blk3.block.coinbase));
                mycallback(unspent_amt, does_block_validate);

                return;
              });
            });
          } else {
            mycallback(unspent_amt, does_block_validate);
            return;
          }
        });
      });
    });
  }
}
Block.prototype.calculateBurnFee = function calculateBurnFee(starting_burn_fee, starting_fee_step) {

  var bf    = [];
  bf[0] = parseFloat(starting_burn_fee);
  bf[1] = parseFloat(starting_fee_step);

  var current_unixtime = this.block.unixtime;
  var prevblk_unixtime = this.app.blockchain.returnUnixtime(this.block.prevhash);

  if (prevblk_unixtime == -1) { return bf; }

  var block_time  = current_unixtime - prevblk_unixtime;
  var target_time = this.app.blockchain.heartbeat * 1000;

  // faster than target
  if (target_time > block_time) {

    bf[0] += 0.0001;
    bf[0]  = parseFloat(bf[0]).toFixed(8);
    bf[1]  = bf[0] / (this.app.blockchain.max_heartbeat * 1000);
    bf[1]  = bf[1].toFixed(8);

  } else { if (target_time < block_time) {

    bf[0] -= 0.0001;
    if (bf[0] < 2) { bf[0] = 2.0; }
    bf[0]  = parseFloat(bf[0]).toFixed(8);
    bf[1]  = bf[0] / (this.app.blockchain.max_heartbeat * 1000);
    bf[1]  = bf[1].toFixed(8);

  } }

  return bf;

}
Block.prototype.containsTransactionFor = function containsTransactionFor(publickey) {
  for (var i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].involvesPublicKey(publickey) == 1) { return 1; }
  }
  return 0;
}
Block.prototype.decryptTransactions = function decryptTransactions() {
  for (var vsd = 0; vsd < this.transactions.length; vsd++) {
    if (this.transactions[vsd].involvesPublicKey(this.app.wallet.returnPublicKey()) == 1) {
      this.transactions[vsd].decryptMessage(this.app);
    }
  }
}
Block.prototype.compressSegAdd = function compressSegAdd() {

  if (this.segadd_enabled == 0) { return; }
  if (this.transactions.length == 0) { return; }

  // process transactions
  for (var i = 0; i < this.transactions.length; i++) {

    // from
    for (var ii = 0; ii < this.transactions[i].transaction.from.length; ii++) {
      if (this.segadd_map[this.transactions[i].transaction.from[ii].add] != null) {
	      this.transactions[i].transaction.from[ii].add = "_" + this.segadd_map[this.transactions[i].transaction.from[ii].add];
      } else {
        this.segadd_max++;
        this.segadd_map[this.transactions[i].transaction.from[ii].add] = this.segadd_max-1;
        this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.from[ii].add;
        this.transactions[i].transaction.from[ii].add = "_" + (this.segadd_max-1);
      }
    }

    // to
    for (var ii = 0; ii < this.transactions[i].transaction.to.length; ii++) {
      if (this.segadd_map[this.transactions[i].transaction.to[ii].add] != null) {
	      this.transactions[i].transaction.to[ii].add = "_" + this.segadd_map[this.transactions[i].transaction.to[ii].add];
      } else {
        this.segadd_max++;
        this.segadd_map[this.transactions[i].transaction.to[ii].add] = this.segadd_max-1;
        this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.to[ii].add;
        this.transactions[i].transaction.to[ii].add = "_" + (this.segadd_max-1);
      }
    }

    // path
    for (var ii = 0; ii < this.transactions[i].transaction.path.length; ii++) {

      if (this.segadd_map[this.transactions[i].transaction.path[ii].to] != null) {
	      this.transactions[i].transaction.path[ii].to = "_" + this.segadd_map[this.transactions[i].transaction.path[ii].to];
      } else {
        this.segadd_max++;
        this.segadd_map[this.transactions[i].transaction.path[ii].to] = this.segadd_max-1;
        this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.path[ii].to;
        this.transactions[i].transaction.path[ii].to = "_" + (this.segadd_max-1);
      }

      if (this.segadd_map[this.transactions[i].transaction.path[ii].from] != null) {
	      this.transactions[i].transaction.path[ii].from = "_" + this.segadd_map[this.transactions[i].transaction.path[ii].from];
      } else {
        this.segadd_max++;
        this.segadd_map[this.transactions[i].transaction.path[ii].from] = this.segadd_max-1;
        this.block.segadd[this.segadd_max-1] = this.transactions[i].transaction.path[ii].from;
        this.transactions[i].transaction.path[ii].from = "_" + (this.segadd_max-1);
      }

    }
  }

  this.block.transactions = JSON.stringify(this.transactions, compressSegAddReplacer);
  this.segadd_compression = 1;

}
function compressSegAddReplacer(key,value) {
  if (key == "decrypted_msg") { return undefined; }
  return value;
}
Block.prototype.containsGoldenTicket = function containsGoldenTicket() {

  for (let i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].isGoldenTicket() == 1) { return 1; }
  }

  return 0;

}
Block.prototype.decompressSegAdd = function decompressSegAdd() {

  if (this.segadd_enabled == 0) { return; }

  // process transactions
  for (var i = 0; i < this.transactions.length; i++) {

    // from
    for (var ii = 0; ii < this.transactions[i].transaction.from.length; ii++) {
      if (this.transactions[i].transaction.from[ii].add.length > 0) {
        if (this.transactions[i].transaction.from[ii].add[0] == "_") {
	        var x = this.transactions[i].transaction.from[ii].add.substring(1);
          this.transactions[i].transaction.from[ii].add = this.block.segadd[x];
        }
      }
    }

    // to
    for (var ii = 0; ii < this.transactions[i].transaction.to.length; ii++) {
      if (this.transactions[i].transaction.to[ii].add.length > 0) {
        if (this.transactions[i].transaction.to[ii].add[0] == "_") {
          var x = this.transactions[i].transaction.to[ii].add.substring(1);
          this.transactions[i].transaction.to[ii].add = this.block.segadd[x];
        }
      }
    }

    // path
    for (var ii = 0; ii < this.transactions[i].transaction.path.length; ii++) {
      if (this.transactions[i].path[ii].transaction.to.length > 0) {
        if (this.transactions[i].transaction.to[ii].add[0] == "_") {
          var x = this.transactions[i].transaction.to[ii].add.substring(1);
          this.transactions[i].transaction.to[ii].add = this.block.segadd[x];
        }
      }
      if (this.transactions[i].transaction.path[ii].from.length > 0) {
        if (this.transactions[i].transaction.from[ii].add[0] == "_") {
          var x = this.transactions[i].transaction.from[ii].add.substring(1);
          this.transactions[i].transaction.from[ii].add = this.block.segadd[x];
        }
      }
    }

  }

  this.segadd_compression = 0;

}
Block.prototype.importTransaction = function importTransaction(txjson) {
  var tx = new saito.transaction(txjson);
  this.addTransaction(tx);
}
Block.prototype.involvesPublicKey = function involvesPublicKey(publickey) {
  for (var v = 0; v < this.transactions.length; v++) {
    if (this.transactions[v].involvesPublicKey(publickey) == 1) {
      return 1;
    }
  }
  return 0;
}

Block.prototype.returnBlock = function returnBlock() {
  return this.block;
}
Block.prototype.returnBurnFee = function returnBurnFee() {
  return this.block.burn_fee;
}
Block.prototype.returnCoinbase = function returnCoinbase() {

  //
  // we cannot convert to a float and then
  // back to a string as that can cause errors
  // in value which cascade due to floating
  // point issues.
  //
  // so make sure that the treasury is set
  // properly and stick with it afterwards
  //
  return this.block.coinbase;
}
Block.prototype.returnDifficulty = function returnDifficulty() {
  return this.block.difficulty;
}
Block.prototype.returnFeeStep = function returnFeeStep() {
  return this.block.fee_step;
}
Block.prototype.returnGoldenTicketContenders = function returnGoldenTicketContenders() {

  var children = [];

  for (var v = 0; v < this.transactions.length; v++) {
    if (this.transactions[v].transaction.gt != null && this.transactions[v].transaction.ft != null) {
      if (this.transactions[v].transaction.path.length == 0) {
        // if there is no path length, add the sender
        children.push(this.transactions[v].transaction.from[0].add);
      } else {
        // otherwise, we pick the destination node in each hop through
        // the transmission path. this eliminates the sender and keeps
        // the focus on nodes that actively transmitted the message
        for (var x = 0; x < this.transactions[v].transaction.path.length; x++) {
          children.push(this.transactions[v].transaction.path[x].to);
        }
      }
    }
  }
  return children;
}
Block.prototype.returnHash = function returnHash() {
  if (this.hash != "") { return this.hash; }
  this.hash = this.app.crypt.hash( this.returnSignatureSource() );
  return this.hash;
}
Block.prototype.returnId = function returnId() {
  return this.block.id;
}
Block.prototype.returnMaxTxId = function returnMaxTxId() {
  if (this.maxtid != 0) { return this.maxtid; }

  var mti = 0;
  for (var z = 0; z < this.transactions.length; z++) {
    if (this.transactions[z].transaction.id > mti) {
      mti = this.transactions[z].transaction.id;
    }
  }

  this.maxtid = mti;
  return this.maxtid;
}
Block.prototype.returnMinTxId = function returnMinTxId() {
  if (this.mintid != 0) { return this.mintid; }
  if (this.transactions.length == 0) {
    return this.app.blockchain.returnMinTxId();
  };
  var mti = this.transactions[0].transaction.id;
  for (var z = 1; z < this.transactions.length; z++) {
    if (this.transactions[z].transaction.id < mti) {
      mti = this.transactions[z].transaction.id;
    }
  }

  this.mintid = mti;
  return this.mintid;
}
Block.prototype.returnPaysplit = function returnPaysplit() {
  return this.block.paysplit;
}
Block.prototype.returnPaysplitVote = function returnPaysplitVote() {
  return this.block.paysplit_vote;
}
Block.prototype.returnReclaimed = function returnReclaimed() {
  return this.block.reclaimed;
}
Block.prototype.returnSignatureSource = function returnSignatureSource() {

  return this.block.unixtime
	 + this.block.prevhash
	 + this.block.roothash
	 + this.block.miner
	 + this.block.id
	 + this.block.burn_fee
	 + this.block.fee_step
	 + this.block.difficulty
	 + this.block.paysplit
	 + this.block.treasury
	 + this.block.coinbase;

}
Block.prototype.returnTransactionFeesTotalSurplus = function returnTransactionFeesTotalSurplus() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  var transaction_fees_needed = Big(this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs));
  var transaction_fees   = Big(this.returnTransactionFeesTotal());

  var surplus_fees = transaction_fees.minus(transaction_fees_needed);
  if (surplus_fees.lt(0)) { surplus_fees = Big(0); }

  return surplus_fees.toFixed(8);

}
Block.prototype.returnTransactionFeesUsableSurplus = function returnTransactionFeesUsableSurplus() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  var transaction_fees_needed = Big(this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs));
  var transaction_fees   = Big(this.returnTransactionFeesUsable());

  var surplus_fees = transaction_fees.minus(transaction_fees_needed);
  if (surplus_fees.lt(0)) { surplus_fees = Big(0); }

  return surplus_fees.toFixed(8);

}
Block.prototype.returnTransactionFeesUsableForBlockCreatorSurplus = function returnTransactionFeesUsableForBlockCreatorSurplus() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  var transaction_fees_needed = Big(this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs));
  var transaction_fees   = Big(this.returnTransactionFeesUsableForBlockCreator());

  var surplus_fees = transaction_fees.minus(transaction_fees_needed);
  if (surplus_fees.lt(0)) { surplus_fees = Big(0); }

  return surplus_fees.toFixed(8);

}
Block.prototype.returnTransactionFeesUsableForBlockCreatorSurplusForThisBlock = function returnTransactionFeesUsableForBlockCreatorSurplusForThisBlock() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  var transaction_fees_needed = Big(this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs));
  var transaction_fees   = Big(this.returnTransactionFeesUsableForBlockCreator());

console.log("Here we are: " + transaction_fees_needed.toFixed(8) + " || " + transaction_fees.toFixed(8));

  var surplus_fees = transaction_fees.minus(transaction_fees_needed);
  if (surplus_fees.lt(0)) { surplus_fees = Big(0); }

  return surplus_fees.toFixed(8);

}
Block.prototype.returnTransactionFeesUsable = function returnTransactionFeesUsable() {
  var total_fees = Big(0.0);
  for (var i = 0; i < this.transactions.length; i++) {
    var tmpfee = Big(this.transactions[i].returnFeeUsable());
    if (this.transactions[i].transaction.ft != 1) {
      if (tmpfee.gt(0)) { 
        total_fees = total_fees.plus(tmpfee); 
      }
    }
  }
  return total_fees.toFixed(8);
}
Block.prototype.returnTransactionFeesUsableForBlockCreator = function returnTransactionFeesUsableForBlockCreator() {
  var total_fees = Big(0.0);
  for (var i = 0; i < this.transactions.length; i++) {
    var tmpfee = Big(this.transactions[i].returnFeeUsableForBlockCreator(this.app, this.block.miner));
    if (this.transactions[i].transaction.ft != 1) {
      if (tmpfee.gt(0)) { 
        total_fees = total_fees.plus(tmpfee); 
      }
    }
  }
  return total_fees.toFixed(8);
}
Block.prototype.returnTransactionFeesTotal = function returnTransactionFeesTotal() {
  var total_fees = Big(0.0);
  for (var i = 0; i < this.transactions.length; i++) {
    var tmpfee = Big(this.transactions[i].returnFeeTotal());
    if (tmpfee.gt(0)) { total_fees = total_fees.plus(tmpfee); }
  }
  // needs proper bignum support
  return total_fees.toFixed(8);
}
Block.prototype.returnTransactionFeesNeededForThisBlock = function returnTransactionFeesNeededForThisBlock() {

  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  if (ts_bf == -1 || ts_fs == -1) { return Big(0).toFixed(8); }

  return this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs);

}
Block.prototype.returnTransactionFeesNeeded = function returnTransactionFeesNeeded(ts_start, ts_issue, ts_burn_fee, ts_fee_step) {

  var unixtime_original        = ts_start;
  var unixtime_current         = ts_issue;
  var milliseconds_since_block = unixtime_current - unixtime_original;
  var feesneeded = Big(ts_burn_fee).minus(Big(ts_fee_step).times(Big(milliseconds_since_block)));
  if (feesneeded.lt(0)) { feesneeded = Big(0); }

  return feesneeded.toFixed(8);

}
Block.prototype.returnTreasury = function returnTreasury() {

  //
  // we cannot convert to a float and then
  // back to a string as that can cause errors
  // in value which cascade due to floating
  // point issues.
  //
  // so make sure that the coinbase is set
  // properly and stick with it afterwards
  //
  return this.block.treasury;
}
Block.prototype.runCallbacks = function runCallbacks(confnum) {
  for (var cc = this.confirmations+1; cc <= confnum; cc++) {
    for (var ztc = 0; ztc < this.callbacks.length; ztc++) {
      this.callbacks[ztc](this, this.transactions[this.callbacksTx[ztc]], cc, this.app);
    }
  }
  this.confirmations = confnum;
}



////////////////
// Validation //
////////////////
Block.prototype.validate = function validate() {

  var block_self = this;

  ////////////////////////
  // check transactions //
  ////////////////////////
  if (block_self.block.transactions.length != block_self.transactions.length) {
   console.log("Block transactions do not match. Discarding.");
   this.app.logger.logError("Block transactions do not match. Discarding.", {message:"",err:""});
   return 0;
  }

  /////////////////////////
  // validate merkleTree //
  /////////////////////////
  if (block_self.block.transactions.length > 0) {
    var t = block_self.app.crypt.returnMerkleTree(block_self.block.transactions).root;
    if (t != block_self.block.merkle) {
      console.log("Block transaction roothash is not as expected");
      this.app.logger.logError("Block transaction roothash is not as expected", {message:"",err:""});
      return 0;
    }
  }

  ///////////////////
  // validate fees //
  ///////////////////
  if (block_self.block.transactions.length > 0) {
    if (block_self.validateTransactionFeesAdequate() == 0) {
      console.log("Block invalid: transaction fees inadequate");
      this.app.logger.logError("Block invalid: transaction fees inadequate", {message:"",err:""});
      return 0;
    }
  }

  ////////////////////////////
  // validate golden ticket //
  ////////////////////////////
  //
  // this is unncessary as we take care of it in the blockchain class
  //
  // when writing longest chain
  //
  //////////////////////////////
  // validate fee transaction //
  //////////////////////////////
  //
  // this is unnecessary as we take care of it in the blockchain class
  //
  // when writing longest chain
  //
  // must be for the surplus value calculated according to creator
  //

  ///////////////////////////
  // validate transactions //
  ///////////////////////////
  var ft_found = 0;
  var gt_found = 0;
  for (var zz = 0; zz < block_self.transactions.length; zz++) {
    if (block_self.transactions[zz].validate(block_self.app, block_self.block.paysplit_vote, block_self.block.id, block_self.returnAverageFee()) != 1) {
      console.log("Block invalid: contains invalid transaction");
      console.log(`hash: ${block_self.app.crypt.hash(JSON.stringify(block_self.transactions[zz]))}`);
      console.log(`sig: ${block_self.transactions[zz].transaction.sig}`);
      console.log(`msig: ${block_self.transactions[zz].transaction.msig}`);

      block_self.app.logger.logError("Block invalid: contains invalid transaction", {message:"",err:""});
      block_self.app.logger.logError(`hash: ${block_self.app.crypt.hash(JSON.stringify(block_self.transactions[zz]))}`, {message:"",err:""});
      block_self.app.logger.logError(`sig: ${block_self.transactions[zz].transaction.sig}`, {message:"",err:""});
      block_self.app.logger.logError(`msig: ${block_self.transactions[zz].transaction.msig}`, {message:"",err:""});
      return 0;
    }
    if (block_self.transactions[zz].isGoldenTicket() == 1) { gt_found++; }
    if (block_self.transactions[zz].isFeeTransaction() == 1) { ft_found++; }
    if (ft_found > 1) {
      console.log("Block invalid: contains multiple fee capture transactions");
      block_self.app.logger.logError("Block invalid: contains invalid transaction", {message:"",err:""});
      return 0;
    }
    if (gt_found > 1) {
      console.log("Block invalid: contains multiple golden ticket transactions");
      block_self.app.logger.logError("Block invalid: contains invalid transaction", {message:"",err:""});
      return 0;
    }
  }

  return 1;

}

Block.prototype.validateTransactionFeesAdequate = function validateTransactionFeesAdequate() {

  // validate first block
  if (this.block.prevhash == "") { return 1; }
  var tb = this.app.blockchain.returnBlockByHash(this.block.prevhash);
  if (tb == null) { return 1; }

  // otherwise calculate
  var unixtime_start = this.app.blockchain.returnUnixtime(this.block.prevhash);
  var unixtime_current = this.block.unixtime;
  var ts_bf = this.app.blockchain.returnBurnFee(this.block.prevhash);
  var ts_fs = this.app.blockchain.returnFeeStep(this.block.prevhash);

  var transaction_fees_needed = Big(this.returnTransactionFeesNeeded(unixtime_start, unixtime_current, ts_bf, ts_fs));

  var usable_transaction_fees   = Big(0.0);
  for (var i = 0; i < this.block.transactions.length; i++) {
    if (this.transactions[i].transaction.ft != 1) {
      usable_transaction_fees = usable_transaction_fees.plus(this.transactions[i].returnFeeUsable());
    }
  }
  if (transaction_fees_needed.gt(usable_transaction_fees)) { return 0; }

  return 1;

}

// make sure any fees are OK
Block.prototype.validateFeeTransaction = function validateFeeTransaction(prevblk=null) {

  if (this.app.SPVMODE == 1) { return 1; }

  // first block we receive
  if (prevblk == null && this.app.blockchain.blocks.length <= 1) {
    console.log("Previous Block is NULL -- cannot validate Golden Ticket");
    this.app.logger.logError("Previous Block is NULL -- cannot validate Golden Ticket",
      {message:"",err:""});
    return 1;
  }

  if (prevblk == null) {
    console.log("Cannot validate Fee Transaction without previous block");
    this.app.logger.logError("Cannot validate Fee Transaction without previous block",
      {message:"",err:""});
    return 0;
  }

  var ftix    = null;
  var surplusfees = Big(this.returnTransactionFeesUsableForBlockCreatorSurplusForThisBlock());

console.log("CHECKING WHEN VALIDATING FT: " + surplusfees + " is what we should have");

  // check for fee transaction
  var feetransactioncount = 0;
  for (var bli = 0; bli < this.transactions.length; bli++) {
    if (this.transactions[bli].transaction.ft != null) {
      feetransactioncount++;
      var ftixAmount = Big(this.transactions[bli].returnAmount());
      if (ftixAmount.gt(surplusfees)) {
console.log(JSON.stringify(this.transactions[bli]));
	console.log("Block invalid: fee transaction is worth too much! " + ftixAmount + " -- " + surplusfees);
        this.app.logger.logError("Block invalid: fee transaction is worth too much!",
          {message:"",err:""});
	return 0;
      }
      if (ftixAmount.lt(surplusfees)) {
console.log(JSON.stringify(this.transactions[bli]));
	console.log("Block invalid: fee transaction is worth too little! " + ftixAmount + " -- " + surplusfees);
        this.app.logger.logError("Block invalid: fee transaction is worth too much!",
          {message:"",err:""});
	return 0;
      }
    }
  }

  if (feetransactioncount > 1) {
    console.log("Block invalid: has more than one fee transaction");
    this.app.logger.logError("Block invalid: has more than one fee transaction",
      {message:"",err:""});
    return 0;
  }

  return 1;
}
Block.prototype.validateGoldenTicket = function validateGoldenTicket(prevblk=null) {

  if (this.app.SPVMODE == 1) { return 1; }

  // first block we receive
  if (prevblk == null && this.app.blockchain.blocks.length <= 1) {
    console.log("Previous Block is NULL -- cannot validate Golden Ticket");
    this.app.logger.logError("Previous Block is NULL -- cannot validate Golden Ticket",
      {message:"",err:""});
    return 1;
  }

  if (prevblk == null) {
    console.log("Cannot validate Golden Ticket without previous block");
    this.app.logger.logError("Cannot validate Golden Ticket without previous block",
      {message:"",err:""});
    return 0;
  }

  var gtix    = null;

  // check for golden ticket
  var goldenticketcount = 0;
  for (var bli = 0; bli < this.transactions.length; bli++) {
    if (this.transactions[bli].transaction.gt != null) {
      goldenticketcount++;
      gtix = new saito.goldenticket(this.app, JSON.stringify(this.transactions[bli].transaction.gt));
      if (gtix.validate(prevblk, this) == 0) {
        console.log("Block invalid: golden ticket does not validate");
        this.app.logger.logError("Block invalid: golden ticket does not validate",
         {message:"",err:""});
        return 0;
      }
    }
  }

  if (goldenticketcount > 1) {
    console.log("Block invalid: has more than one golden ticket");
    this.app.logger.logError("Block invalid: has more than one golden ticket",
      {message:"",err:""});
    return 0;
  }

  // no golden ticket
  if (gtix == null && prevblk != null) {
    // difficulty, paysplit should be unchanged
    if (this.returnPaysplit() != prevblk.returnPaysplit()) {
      console.log("Block invalid: no golden ticket yet paysplit differs");
      this.app.logger.logError("Block invalid: no golden ticket yet paysplit differs",
        {message:"",err:""});
      return 0;
    }
    if (this.returnDifficulty() != prevblk.returnDifficulty()) {
      console.log("Block invalid: no golden ticket yet difficulty differs");
      this.app.logger.logError("Block invalid: no golden ticket yet difficulty differs",
        {message:"",err:""});
      return 0;
    }

    return 1;
  }


  // validate paysplit and difficulty changes, and monetary policy
  if (prevblk != null) {

    // validate paysplit and difficulty
    if (this.returnDifficulty() != gtix.calculateDifficulty(prevblk)) {
      console.log("Block invalid: difficulty adjustment is incorrect");
      this.app.logger.logError("Block invalid: difficulty adjustment is incorrect",
        {message:"",err:""});
      return 0;
    }
    if (this.returnPaysplit() != gtix.calculatePaysplit(prevblk)) {
      console.log("Block invalid: paysplit adjustment is incorrect");
      this.app.logger.logError("Block invalid: paysplit adjustment is incorrect",
        {message:"",err:""});
      return 0;
    }

    // validate monetary policy
    if (gtix != null) {
      if (gtix.validateMonetaryPolicy(this.returnTreasury(), this.returnCoinbase(), prevblk) != 1) {
        console.log("Block invalid: monetary policy does not validate");
        this.app.logger.logError("Block invalid: monetary policy does not validate",
          {message:"",err:""});
        return 0;
      }
    }
  }

  return 1;
}
Block.prototype.validateReclaimedFunds = function validateReclaimedFunds(mycallback) {

  // lite clients exit without validating
  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) {
    mycallback(1);
    return;
  }

  var block_self = this;

  // full nodes have to check
  this.calculateReclaimedFunds(1, function(reclaimed, validates) {

    if (validates == 0) {
      console.log("validation error: failure to rebroadcast required transaction");
      mycallback(0);
      return;
    }

    if (Big(block_self.block.reclaimed).eq(reclaimed)) {
      mycallback(1);
      return;
    } else {
      mycallback(0);
      return;
    }
  });

}
Block.prototype.updateConfirmationNumberWithoutCallbacks = function updateConfirmationNumberWithoutCallbacks(confnum) {
  if (confnum > this.confirmations) {this.confirmations = confnum; }
}
//
// avg fee paid by non-rebroadcast txs
//
Block.prototype.returnAverageFee = function returnAverageFee() {

  if (this.average_fee != "") { return this.average_fee; }

  var total_fees = Big(0.0);
  var total_txs  = 0;

  for (let i = 0; i < this.transactions.length; i++) {
    if (this.transactions[i].transaction.rb == 0) { 
      total_txs++; 
      total_fees = total_fees.plus(Big(this.transactions[i].returnFeeTotal()));
    }
  }
  if (total_txs > 0) {
    this.average_fee = total_fees.div(total_txs).toFixed(8);
  } else {
    this.average_fee = "0";;
  }
  return this.average_fee;

}


