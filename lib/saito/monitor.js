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
    (this.app.blockchain.hasFullGenesisPeriod() || (this.app.blockchain.returnLatestBlockId() - this.app.blockchain.genesis_period) < 1)
  ) {
    return true;
  }
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




