var saito = require('./saito');

var app            = {};
    app.BROWSER    = 0;
    app.SPVMODE    = 0;

////////////////
// Initialize //
////////////////
app.crypto           = new saito.crypto();

process.on('message', (msg) => {

  if (msg.ping != undefined) {
    process.send({ ping : 1 });
  }

  if (msg.validateTransactions != undefined) {

console.log("child receives data <<< " + new Date().getTime());

    let data         = msg.data;
    let child        = msg.child;
    let max_children = msg.max_children;
    //let type         = msg.type;
    //let msig         = msg.msig;
    //let mhash        = msg.mhash;
    //let txmsg        = msg.txmsg;

    let obj = JSON.parse(data);

console.log("child finishes building block!");
console.log(" .... child " + child + "   : " + new Date().getTime() + " >>> " + data.length);

    for (let i = 0; i < obj.length; i++) {
    
      //
      // rebroadcast transactions
      //
      if (obj[i].type >= 3 && obj[i].type <= 5) {

        if (obj[i].txmsg == undefined) {

          console.log("transaction message signature does not verify, and there is no internal rebroadcast tx");
          process.send({ validateTransactions : 0 });
          return false;
        }

        var oldtx = new saito.transaction(obj[i].txmsg);

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

        if (!saito.crypt().verifyMessage(oldtx.returnSignatureSource(), oldtx.transaction.sig, oldtx.returnSender())) {
          console.log("transaction signature in original rebroadcast tx does not verify");
          process.send({ validateTransactions : 0 });
          return false;
        } else {
          console.log("ATR TX Validated: ");
          console.log(JSON.stringify(this.transaction));
        }

	// and validate message
        if (!app.crypto.verifyMessage(obj[i].msg, obj[i].sig, obj[i].add)) {
          console.log(`Block invalid: contains invalid transaction: ${i}`);
          process.send({ validateTransactions : 0 });
          return false;
        }

      //
      // normal transactions
      //
      } else {

        if (!app.crypto.verifyMessage(obj[i].msg, obj[i].sig, obj[i].add)) {
          console.log(`Block invalid: contains invalid transaction: ${i}`);
          process.send({ validateTransactions : 0 });
          return false;
        }

if (obj[i].mhash != "") {
        if (!app.crypto.fastVerifyMessage(obj[i].mhash, obj[i].msig, obj[i].add)) {
console.log("BAD TX: " + obj[i].txmsg + " -- " + obj[i].msig + " -- " + obj[i].add);
          console.log(`Block invalid: contains invalid msig transaction: ${i}`);
          process.send({ validateTransactions : 0 });
          return false;
        }
} else {
        if (!app.crypto.verifyMessage(obj[i].txmsg, obj[i].msig, obj[i].add)) {
console.log("BAD TX2:" + obj[i].txmsg + " -- " + obj[i].msig + " -- " + obj[i].add);
          console.log(`Block invalid: contains invalid msig transaction: ${i}`);
          process.send({ validateTransactions : 0 });
          return false;
	}
}
      }
    }

    process.send({ validateTransactions : 1 });

  }
});



