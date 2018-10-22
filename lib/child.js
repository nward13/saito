var saito = require('./saito');

var app            = {};
    app.BROWSER    = 0;
    app.SPVMODE    = 0;

////////////////
// Initialize //
////////////////
app.crypto           = new saito.crypto();

process.on('message', (msg) => {

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

        if (!saito.crypt().verifyMessage(oldtx.returnSignatureSource(app), oldtx.transaction.sig, oldtx.returnSender())) {
          console.log("transaction signature in original rebroadcast tx does not verify");
          process.send({ validateTransactions : 0 });
          return false;
        } else {
          console.log("ATR TX Validated: ");
          console.log(JSON.stringify(this.transaction));
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

      }
    }

    process.send({ validateTransactions : 1 });

  }
});



