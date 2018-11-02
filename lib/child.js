const saito    = require('./saito');

var app            = {};
    app.BROWSER    = 0;
    app.SPVMODE    = 0;

////////////////
// Initialize //
////////////////
app.crypto           = new saito.crypto();

process.on('message', (msg) => {

  //
  // validating transaction sigs
  //
  if (msg.validateTransactions != undefined) {

    let data         = msg.data;
    let child        = msg.child;

console.log(" .... chd rec " + child + "  : " + new Date().getTime() + " >>> " + data.length);
    let obj = JSON.parse(data);
console.log(" .... chd obj" + child + "   : " + new Date().getTime() + " >>> " + data.length);

    for (let i = 0; i < obj.length; i++) {
    
      //
      // rebroadcast transactions
      //
      if (obj[i].type >= 3 && obj[i].type <= 5) {

console.log("\n\n\n--------------------------\nREBROADCAST TX:");
console.log(obj[i].txmsg);
console.log(data);
console.log("\n");

        if (obj[i].txmsg == undefined) {
          console.log("transaction message signature does not verify, and there is no internal rebroadcast tx");
          process.send({ validateTransactions : 0 });
          return false;
        }

	//
	// these transactions have explicit transactions within transactions
	// and have already been rebroadcast once.
	//
        let txobj = JSON.parse(obj[i].txmsg);

        var oldtx = new saito.transaction(txobj.tx);

console.log("HERE IS THE CREATED TX");
console.log(JSON.stringify(oldtx));

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
          //
          // all but the first (source of funds) txs will be new for VIP
          // and thus must have bhash reset to nothing
          //
          for (let vi = 0; vi < oldtx.transaction.to.length; vi++) {
            oldtx.transaction.to[vi].bid = 0;
            oldtx.transaction.to[vi].tid = 0;
            oldtx.transaction.to[vi].sid = vi;
            oldtx.transaction.to[vi].bhash = "";
          }
        }
  	console.log("THIS IS OUR DATA: ");
        console.log(oldtx);
        if (!saito.crypto().verifyMessage(oldtx.returnSignatureSource(app), oldtx.transaction.sig, oldtx.returnSender())) {
	  if (obj[i].txmsg === "{}" && (obj[i].type == 4 || obj[i].type <= 5)) {

	    //
	    // these transactions don't have TXs within TXs, so we just validate and check 
	    // on original submission. Note the lack of TX within TX. We must keep this as
	    // transaction validation function only accepts 4&5 types if they are signed
	    // by app.GENESIS_PUBLICKEY and DO NOT HAVE A MESSAGE.
	    // 
	    console.log("transaction signature does not verify, but we are new VIP or GoldenChunk transaction");

	  } else {
            console.log("transaction signature in original rebroadcast tx does not verify");
            process.send({ validateTransactions : 0 });
            return false;
	  }
        } else {
          console.log("ATR TX Validated: ");
        }

      } else {

        if (!app.crypto.verifyMessage(obj[i].msg, obj[i].sig, obj[i].add)) {
          console.log(`Block invalid: contains invalid transaction: ${i}`);
          process.send({ validateTransactions : 0 });
          return false;
        }
      }
    }

    process.send({ validateTransactions : 1 });
  }


});



