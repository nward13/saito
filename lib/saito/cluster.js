// no 'use strick' as we need to delete from hashmaps
const path     = require('path');
const saito    = require('../saito');
const Big      = require('big.js');
const os       = require('os');
const fs       = require('fs-extra')

/**
 * Cluster Contructor
 * @param {*} app
 */
function Cluster(app) {

  if (!(this instanceof Cluster)) { return new Cluster(app); }

  this.app = app;

  this.enable_clustering  = 1;
  this.number_of_clusters = 3;
  this.child_forks        = [];
  this.children_validated = 0;
  this.fork_counter       = 0;

  this.validating_txs     = 0;
  this.validating_timer   = 20;

  this.tx_to_validate     = 0;
  this.tx_validated       = 0;

  return this;

}
module.exports = Cluster;







Cluster.prototype.validateTransactions = async function validateTransactions(blk) {

  //
  // this code calls clusterValidate directly.
  // 
  // that function mirrors what happens in the child.js class
  // changes to one must be committed to the other.
  //
  if (this.enable_clustering == 0) {
    for (let i = 0; i < blk.transactions.length; i++) {
      if (!blk.transactions[i].clusterValidate(blk.app)) {
        console.log(`Block invalid: contains invalid transaction: ${i}`);
        this.app.logger.logError("Block invalid: contains invalid transaction: " + i, {message:"",err:""});
        return 0;
      }
    }
    return 1;
  }

  var cluster_self = this;

  this.validating_txs    = 1;
  this.tx_to_validate    = this.child_forks.length;
  this.tx_validated      = 0;

  let sigjson = [this.tx_to_validate];
  let blksjson = [this.tx_to_validate];

  for (let m = 0; m < this.tx_to_validate; m++) {
    sigjson[m] = [];
  }


console.log(" .... pre strgify: " + new Date().getTime());
  for (let t = 0, f = 0, idx = 0; t < blk.transactions.length; t++, f++) {
    if (f == this.tx_to_validate) { idx++; f = 0; }
    sigjson[f][idx]       = {}
    sigjson[f][idx].msg   = blk.transactions[t].returnSignatureSource(this.app);
    sigjson[f][idx].sig   = blk.transactions[t].transaction.sig;
    sigjson[f][idx].add   = blk.transactions[t].transaction.from[0].add;
    sigjson[f][idx].type  = blk.transactions[t].transaction.type;
    sigjson[f][idx].mhash = blk.transactions[t].transaction.mhash;
    sigjson[f][idx].txmsg = "";
    if (sigjson[f][idx].type >= 3) {
      sigjson[f][idx].txmsg  = this.app.crypto.fastSerialize(blk.transactions[t].transaction.msg);
    }
  }
console.log(" .... pst strgify: " + new Date().getTime());


  for (let f = 0; f < this.child_forks.length; f++) {
    this.tx_validators_max++;
    this.child_forks[f].send({ validateTransactions: 1 , data : this.app.crypto.fastSerialize(sigjson[f]) , child : f });
  }

  var promise = new Promise(function(resolve, reject) {
    setTimeout(() => {
      cluster_self.validateTransactionsCount(resolve, 0);
    }, cluster_self.validating_timer);
  });

  return promise;

}
Cluster.prototype.validateTransactionsCount = function validateTransactionsCount(resolve, num) {

  var cluster_self = this;

  if (this.validating_txs == -1) {
    resolve(0);
    return;
  }

  if (this.tx_to_validate == this.tx_validated) {
    resolve(1);
  } else {
    setTimeout(() => { cluster_self.validateTransactionsCount(resolve, num+1); }, cluster_self.validating_timer);
  }

}



////////////////
// Initialize //
////////////////
Cluster.prototype.initialize = async function initialize() {

  var cluster_self = this;

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) {
    this.enable_clustering = 0;
    return;
  }

  if (this.enable_clustering == 0) { return; }

  var number_of_forks = require('os').cpus().length-1;
  if (this.number_of_clusters <= number_of_forks) {
    number_of_forks = this.number_of_clusters;
  }
  if (number_of_forks <= 0) { number_of_forks = 1; }

  const { fork } = require('child_process');

  for (var f = 0; f < number_of_forks; f++) {

    var forked = fork(path.join(__dirname, '../child.js'));
    forked.on('message', (msg) => {

      if (msg.validateTransactions != undefined) {
        if (msg.validateTransactions == 1) {
	  cluster_self.tx_validated++;
        }
        if (msg.validateTransactions == 0) {
	  cluster_self.validating_txs = -1;
        }
      }

    });
    this.child_forks.push(forked);
  }

}







