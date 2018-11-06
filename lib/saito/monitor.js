'use strict';

/**
 * Monitor Constructor
 * @param {*} app
 */
function Monitor(app) {

  if (!(this instanceof Monitor)) {
    return new Monitor(app);
  }

  this.app                = app || {};

  return this;

}
module.exports = Monitor;


/**
 * returns mempool_is_bundling field
 * @returns {boolean} mempool_is_bundling
 */
Monitor.prototype.canMempoolBundleBlock = function canMempoolBundleBlock() {

  if (
    this.app.mempool.bundling_active == false &&
    this.app.mempool.processing_active == false &&
    this.app.mempool.clearing_active == false &&
    this.app.mempool.blocks.length == 0 &&
    this.app.storage.loading_active == false &&
    this.app.blockchain.indexing_active == false &&
    (this.app.blockchain.hasFullGenesisPeriod() || 
      ((this.app.blockchain.returnLatestBlockId()-this.app.blockchain.lowest_acceptable_bid) <= this.app.blockchain.genesis_period))
  ) {
    return true;
  }

console.log( this.app.mempool.bundling_active );
console.log( this.app.mempool.processing_active );
console.log( this.app.mempool.clearing_active );
console.log( this.app.mempool.blocks.length );
console.log( this.app.storage.loading_active ); 
console.log( this.app.blockchain.indexing_active );
console.log( this.app.blockchain.hasFullGenesisPeriod() );
console.log( (this.app.blockchain.returnLatestBlockId()-this.app.blockchain.lowest_acceptable_bid) <= this.app.blockchain.genesis_period );


  return false;

}



/**
 * returns mempool_is_bundling field
 * @returns {boolean} mempool_is_bundling
 */
Monitor.prototype.canBlockchainAddBlockToBlockchain = function canBlockchainAddBlockToBlockchain() {
  if (
    this.app.mempool.blocks.length > 0 &&
    this.app.blockchain.indexing_active == false
  ) {
    return true;
  }
  return false;
}




