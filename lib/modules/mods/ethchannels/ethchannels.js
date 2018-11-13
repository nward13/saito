var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');
const Web3 = require('web3');
const web3Utils = require('web3-utils');
const BN = require('bignumber.js');
const contractAbi = require('./abi/Channels.json').abi;

// Web3 instance. Use websocket provider to allow event filtering
const web3 = new Web3(new Web3.providers.WebsocketProvider('wss://rinkeby.infura.io/ws'));

// Contract instance
const channelsContract = new web3.eth.Contract(contractAbi, '0xf5060d546df33abd988616c9cbcfe0fd0f46b78c');


//////////////////
// CONSTRUCTOR  //
//////////////////
function EthChannels(app) {

  if (!(this instanceof EthChannels)) { return new EthChannels(app); }

  EthChannels.super_.call(this);

  this.app = app;
  this.name = "EthChannels";

  this.handlesEmail = 1;
  this.emailAppName = "Ethereum Payment Channels";

  // Address of the Channels contract on the Rinkeby testnet
  this.contractAddr = '0xf5060d546df33abd988616c9cbcfe0fd0f46b78c';

  // Arrays to store active payment channels. We are the channel recipient
  // for incoming channels, and the channel sender for outgoing channels
  // Each channel is stored in the respective array as an object containing
  // the following:
  // {peerSaitoAddr:'', myEthAddr: '', peerEthAddr: '', openBlock: '', 
  //   deposit: '', peerBal: '', myBal: '', lastSig: ''}
  this.incomingChannels = [];
  this.outgoingChannels = [];

  // Transaction Request Strings
  this.openRequestString = "Eth Channel Requested";
  this.channelOpenedString = "Eth Channel Opened";
  this.channelConfirmedString = "Eth Channel Confirmed Open";
  this.paymentSentString = "Eth Channel Payment Sent";
  this.paymentConfirmedString = "Eth Channel Payment Confirmed";
  this.channelClosedString = "Eth Channel Closed";
  this.closeConfirmedString = "Eth Channel Confirmed Closed";

  return this;
}
module.exports = EthChannels;
util.inherits(EthChannels, ModTemplate);


ModTemplate.prototype.initialize = function initialize(app) {

  var ec_self = app.modules.returnModule("EthChannels");

  // If we have previously saved incoming channels, load them
  if (ec_self.app.options.incomingChannels !== undefined) 
    ec_self.incomingChannels = ec_self.app.options.incomingChannels;

  // If we have previously saved outgoing channels, load them
  if (ec_self.app.options.outgoingChannels !== undefined)
    ec_self.outgoingChannels = ec_self.app.options.outgoingChannels;

};


//////////////////
// Confirmation //
//////////////////
EthChannels.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {
  console.log("An EthChannels TX Was confirmed.")
  console.log("Here is the transaction: ", tx);
  console.log("Here is the confirmation: ", conf);
  console.log("Here is the block: ", blk);

  var ec_self = app.modules.returnModule("EthChannels");

  // on the first confirmation
  if (conf === 0) {

    // if transaction is to us...
    if (tx.transaction.to[0].add === app.wallet.returnPublicKey()) {
      console.log("Transaction is to us");

      var txmsg = tx.returnMessage();

      // if this is an original request to open a new payment channel 
      // (from channel recipient to channel sender), then we are channel sender
      // and this is an outgoing channel for us
      if (txmsg.request === ec_self.openRequestString) {
        console.log("Open Request transaction is to us");

        // Get channel recipient's saito address from the tx
        var peerSaitoAddr = tx.transaction.from[0].add;

        // If the channel already exists, only send the email
        // TODO: clear up confusion with repeat transactions
        // --> some are causing multiple channels to be opened, some
        //      are failing to send emails again after refreshing the page
        if (ec_self.outgoingExists(peerSaitoAddr)) {
          ec_self.requestChannelEmail(tx, app);
        } else {
          // If the channel does not exist yet, create it, save it, and email us
          var newChannel = {};
          newChannel.peerSaitoAddr = peerSaitoAddr;
          newChannel.peerEthAddr = txmsg.data.recipientEthAddr;
          ec_self.outgoingChannels.push(newChannel);
          ec_self.saveOutgoingChannels();
          ec_self.requestChannelEmail(tx, app);
        }
        
        console.log("outgoingChannels from onConf.openRequest: ", ec_self.outgoingChannels);
        console.log("incomingChannels from onConf.openRequest: ", ec_self.incomingChannels);

      }

      // If the channel has just been opened (tx from channel sender to 
      // channel recipient), then we are the channel recipient and this
      // is an incoming channel for us
      if (txmsg.request === ec_self.channelOpenedString) {
        console.log("Channel Opened Tx is to us");

        // Get channel sender's saito address from the tx
        var peerSaitoAddr = tx.transaction.from[0].add;

        var channelId;

        // We need to already have a partially initialized channel with them.
        // Otherwise, we did not request this channel. Un-requested channels
        // are avoided to prevent channel senders from maliciously opening
        // channels to an Eth address we don't have access to
        if (ec_self.incomingExists(peerSaitoAddr)) {
          // Get channel index
          channelId = ec_self.getIncomingIndex(peerSaitoAddr);

          // if the deposit has been initialized, we have an active
          // channel with them
          if (ec_self.incomingChannels[channelId].deposit !== undefined) {
            return false;
          }

        } else {
          return false;
        }

        // Filter Ethereum events to get the openBlock of the channel
        // on the Ethereum blockchain. The openBlock is used by the
        // Channels contract to identify the channel and prevent various
        // types of signature replay attacks.
        // Note: All contract calls or event filter calls are asynchronous
        var openBlock;
        return ec_self.getOpenBlock(
          txmsg.data.senderEthAddr,
          txmsg.data.recipientEthAddr
        ).then(OB => {
          openBlock = OB;
          console.log("Open Block from channelOpened Transaction: ", openBlock);

          // Query the Channels contract to make sure the channel is still open
          return ec_self.isChannelOpen(
            txmsg.data.senderEthAddr,
            ec_self.incomingChannels[channelId].myEthAddr,
            openBlock,
            web3.utils.toWei(txmsg.data.deposit, 'ether')
          )
        }).then(channelOpen => {
          console.log("isChannelOpen() return from channelOpened Transaction: ", channelOpen);
          
          // If the channel is not open, return false
          // TODO: handle this with a notification to the channel participants
          if (!channelOpen) {
            return false;
          } else {
            // Now we know that channel has been opened, so we finish creating it in our module
            ec_self.incomingChannels[channelId].peerEthAddr = txmsg.data.senderEthAddr;
            ec_self.incomingChannels[channelId].deposit = web3.utils.toWei(txmsg.data.deposit, 'ether');
            ec_self.incomingChannels[channelId].peerBal = web3.utils.toWei(txmsg.data.deposit, 'ether');
            ec_self.incomingChannels[channelId].myBal = 0;
            ec_self.incomingChannels[channelId].openBlock = openBlock;

            // Save the new state
            // TODO: clear up confusion with repeat transactions
            // ec_self.saveIncomingChannels();

            console.log("outgoingChannels from onConf.channelOpened: ", ec_self.outgoingChannels);
            console.log("incomingChannels from onConf.channelOpened: ", ec_self.incomingChannels);

            // Email us to confirm the opening of the channel
            ec_self.recipientOpenConfirmEmail(tx, app, ec_self.incomingChannels[channelId]);
          }
        }).catch(error => {
          console.log("Error from channelOpened transaction confirmation (to us): ", error);
          return false;
        });
     
      }

      // Payment sent to us, so this is an incoming channel for us
      if (txmsg.request === ec_self.paymentSentString) {
        console.log("The payment sent transaction was sent to us")

        // Pull data from transaction
        var sig = txmsg.data.sig;
        var amt = web3.utils.toWei(txmsg.data.amt, 'ether');
        var peerSaitoAddr = tx.transaction.from[0].add;

        // Get the index of the channel in the incomingChannels array
        var channelId = ec_self.getIncomingIndex(peerSaitoAddr);

        // If the payment amount is less than our current channel balance /
        // the last signature we recieved, we don't want to close the
        // channel with this signature, regardless of its validity
        // NOTE: amt is always the recipient's new total balance, not 
        // the additional payment amount
        if (!(amt >= ec_self.incomingChannels[channelId].myBal)) {
          return false;
        }

        // Check that the signature is  sure the signature is valid
        return ec_self.verifySig(
          ec_self.incomingChannels[channelId].peerEthAddr, 
          ec_self.incomingChannels[channelId].myEthAddr, 
          ec_self.incomingChannels[channelId].openBlock,
          amt, 
          sig
        ).then(result => {

          // If the signature is not verified, return false
          // TODO: handle this with notification to channel participants
          if (!result) {
            return false;
          } else {

            // The signature is valid, so update the channel state
            ec_self.incomingChannels[channelId].lastSig = sig;
            ec_self.incomingChannels[channelId].myBal = amt;
            ec_self.incomingChannels[channelId].peerBal = ec_self.incomingChannels[channelId].deposit - amt;

            // Save the new state
            ec_self.saveIncomingChannels();

            // Email us to notify of new payment
            ec_self.recipientPaymentConfirmEmail(tx, app, ec_self.incomingChannels[channelId]);
          }
        }).catch(error => {
          console.log("Error from paymentSent transaction confirmation (to us): ", error);
          return false;
        });

      }

      // Recipient closes the channel, so channelClosed tx is sent from
      // recipient to sender. We are channel sender, so this is an
      // outgoing channel for us
      if(txmsg.request === ec_self.channelClosedString) {
        console.log("Channel closed tx is to us");

        // Grab the index of the channel in the outogoingChannels array
        var channelId = ec_self.getOutgoingIndex(tx.transaction.from[0].add);

        // Store the channel temporarily, so that we can send confimation
        // email after deleting the channel
        var channel = ec_self.outgoingChannels[channelId];

        // Filter events from the Channels contract to confirm that the 
        // channel is closed
        return ec_self.isChannelClosed(channel.myEthAddr, channel.peerEthAddr, channel.openBlock)
          .then(result => {

            // If there are no ChannelClosed events matching our channel,
            // the channel has not been closed
            // TODO: handle this with notification to channel participants
            if (!result) {
              console.log("The channel is not closed.");
              return false;
            } else {

              // Channel has been closed, so delete it from out outgoingChannels
              ec_self.outgoingChannels.splice(channelId, 1);

              // Save the new state
              ec_self.saveOutgoingChannels();

              // Email us to confirm that the channel has been closed
              ec_self.senderConfirmCloseEmail(tx, app, channel)
            }
          }).catch(error => {
            console.log("Error from channelClosed transaction confirmation (to us): ", error);
            return false;
          }); 
      }

    }

    // if transaction is from us...
    if (tx.transaction.from[0].add === app.wallet.returnPublicKey()) {
      console.log("Transaction is from us");
      
      var txmsg = tx.returnMessage();

      // if this is an original request to open a new payment channel 
      // (from channel recipient to channel sender), then we are channel recipient
      // and this is an incoming channel for us. This tx is from us, but
      // we want to initialize a channel with the Eth address we gave to 
      // avoid our counterparty tricking us into a payment channel with
      // a different Eth address. This could be done in the formatEmailTransaction
      // callback, but we want to make module usable by non-email users
      if (txmsg.request === ec_self.openRequestString) {
        console.log("Open request tx is from us");

        // Grab counterparty's Saito address from tx
        var peerSaitoAddr = tx.transaction.to[0].add;

        // If we already have an incoming channel from them, don't 
        // initialize, but send us the email
        // TODO: clear up confusion with repeat transactions
        if (ec_self.incomingExists(peerSaitoAddr)) {
          ec_self.channelRequestedEmail(tx, app);
          return false;
        }

        // Now we know channel does not exist yet, so we create it
        var newChannel = {};
        newChannel.peerSaitoAddr = peerSaitoAddr;
        newChannel.myEthAddr = txmsg.data.recipientEthAddr;
        ec_self.incomingChannels.push(newChannel);

        // Save the new state
        // TODO: clear up confusion with repeat transactions
        // ec_self.saveIncomingChannels();

        // Email us (the channel recipient) so we know our channel was
        // successfully requested
        ec_self.channelRequestedEmail(tx, app);

      }

      // If the channel opened tx is from us, we are the channel sender
      // and this is an outgoing channel for us
      if (txmsg.request === ec_self.channelOpenedString) {
        console.log("channelOpened tx is from us");

        // Filter Ethereum events to get the openBlock of the channel
        // on the Ethereum blockchain
        var openBlock;
        return ec_self.getOpenBlock(
          txmsg.data.senderEthAddr,
          txmsg.data.recipientEthAddr
        ).then(OB => {
          openBlock = OB;
          console.log("Open Block from channel Opened transaction (from us): ", openBlock);

          // Confirm that the channel is still open
          ec_self.isChannelOpen(
            txmsg.data.senderEthAddr,
            txmsg.data.recipientEthAddr,
            openBlock,
            web3.utils.toWei(txmsg.data.deposit, 'ether')
          ).then(channelOpen => {
            console.log("isChannelOpen() result from channelOpened tx (from us): ", channelOpen);

            // If the channel is not open, don't alter state
            if (!channelOpen) {
              // TODO
              return false;
            } else {

              // Now we know that channel has been opened, so we finish creating it in our module
              var channelId = ec_self.getOutgoingIndex(tx.transaction.to[0].add);
              ec_self.outgoingChannels[channelId].deposit = web3.utils.toWei(txmsg.data.deposit, 'ether');
              ec_self.outgoingChannels[channelId].myEthAddr = txmsg.data.senderEthAddr;
              ec_self.outgoingChannels[channelId].myBal = web3.utils.toWei(txmsg.data.deposit, 'ether');
              ec_self.outgoingChannels[channelId].peerBal = 0;
              ec_self.outgoingChannels[channelId].openBlock = openBlock;

              // Save the new state
              ec_self.saveOutgoingChannels();

              console.log("outgoingChannels from onConf.channelOpened: ", ec_self.outgoingChannels);
              console.log("incomingChannels from onConf.channelOpened: ", ec_self.incomingChannels);

              // Email the channel sender to confirm the opening of the channel
              ec_self.senderOpenConfirmEmail(tx, app, ec_self.outgoingChannels[channelId]);
            }
          })
        }).catch(error => {
          console.log("Error from channelOpened transaction confirmation (from us): ", error);
          return false;
        })

      }

      if (txmsg.request === ec_self.paymentSentString) {
        // Payment sent from us, so this is an outgoing channel
        console.log("paymentSent transaction is from us");

        // Grab data from the tx
        var sig = txmsg.data.sig;
        var amt = web3.toWei(txmsg.data.amt, 'ether');
        var peerSaitoAddr = tx.transaction.to[0].add;

        // Grab the index of the channel in our outgoingChannels array
        var channelId = ec_self.getOutgoingIndex(peerSaitoAddr);

        // If the payment amount is not greater than the recipient's
        // current balance, this signature will not be redeemed, regardless
        // of its validity.
        // NOTE: amt is always the recipient's new total balance, not 
        // the additional payment amount
        if (!(amt >= ec_self.outgoingChannels[channelId].peerBal)) {
          return false;
        }

        // make sure the signature is valid
        return ec_self.verifySig(
          ec_self.outgoingChannels[channelId].myEthAddr, 
          ec_self.outgoingChannels[channelId].peerEthAddr, 
          ec_self.outgoingChannels[channelId].openBlock,
          amt, 
          sig
        ).then(result => {
          console.log("verifySig() result from payment sent tx confirmation (from us): ", result);

          // If the signature is invalid, do not alter state
          if (!result) {
            return false;
          } else {

            // Signature is valid, so update channel state
            ec_self.outgoingChannels[channelId].lastSig = sig;
            ec_self.outgoingChannels[channelId].peerBal = amt;
            ec_self.outgoingChannels[channelId].myBal = ec_self.outgoingChannels[channelId].deposit - amt;

            // Save the new state
            ec_self.saveOutgoingChannels();

            // Email us to confirm payment
            ec_self.senderPaymentConfirmEmail(tx, app, ec_self.outgoingChannels[channelId]);
          }
        }).catch(error => {
          console.log("Error from paymentSent tx confirmation (from us): ", error);
          return false;
        })

      }

      // If channelClosed transaction is from us, we are the channel
      // recipient, so this is an incoming channel for us
      if(txmsg.request === ec_self.channelClosedString) {
        console.log("Channel closed tx is from us");

        // Grab the index of the channel in our incomingChannels array
        var channelId = ec_self.getIncomingIndex(tx.transaction.to[0].add);

        // Store the channel so we can send confirmation email after
        // deleting channel from our incomingChannels
        var channel = ec_self.incomingChannels[channelId];

        // Make sure the channel is closed by filtering contract events
        return ec_self.isChannelClosed(
          channel.peerEthAddr, 
          channel.myEthAddr, 
          channel.openBlock
        ).then(result => {
          console.log("isChannelClosed() result from channelClosed tx confirmation (from us): ", result);

          // If the channel has not been closed, do not change channel state
          if (!result) {
            return false;
          } else {

            // Channel has been closed, so delete from our incomingChannels
            ec_self.incomingChannels.splice(channelId, 1);

            // Save the new state
            ec_self.saveIncomingChannels();

            // Email us to confirm that channel has been closed
            ec_self.recipientConfirmCloseEmail(tx, app, channel);
          }
        }).catch(error => {
          console.log("Error from channelClosed tx confirmation (from us): ", error);
          return false;
        });
      }
    }
  }
}


/////////////////////
// Emailers //
/////////////////////

EthChannels.prototype.requestChannelEmail = function requestChannelEmail(tx, app) {
  
  var txmsg = tx.returnMessage();

  // Create an email prompting channel sender to open the payment channel
  var emailBody = '<div id="open_channel_body">'
    + '<p>You have recieved a request to open an Ethereum payment channel with '
    + app.modules.returnModule("Email").formatAuthor(tx.transaction.from[0].add, app)
    + ' with a suggested deposit amount of ' + txmsg.data.requestedDeposit
    + ' ETH.' + 'To open this channel, specify your own Ethereum address and '
    + 'the amount you would like to deposit, then click OPEN CHANNEL.</p>' + '<br>'
    +'<form id="open_form">'
      +'Your public Ethereum address:<br>'
      +'<input type="text" name="senderAddress"><br>'
      +'Deposit amount:<br>'
      +'<input type="number" name="deposit"><span>ETH</span><br>'
    +'</form><br>'
    +'<input type="button" id="open_channel" value="OPEN CHANNEL" />'
  + '</div>'
  + '<div id="open_channel_tx" style="display:none;">'
    + '<p>Please use your Eth address, ' + '<span id="channel_sender_eth_addr"></span>, '
    + 'to send the following transaction to the payment channels contract on the Rinkeby testnet:'
    + '<div><strong>openChannel(' + '<span class="channel_recipient_eth_addr">'
    + txmsg.data.recipientEthAddr + '</span>' + ', { value: ' + '<span id="deposit"></span>' + ' })'
    + '</strong></div>' + 'Contract Address: <strong>' + this.contractAddr + '</strong><br><br>'
    + 'Click the button below after the openChannel() transaction is confirmed (>= 1 block confirmation).'
    + '</p>'
    +'<input type="button" id="open_tx_submitted" value="CLICK HERE AFTER CONFIRMATION" />'
  + '</div>';

  // and send it
  msg          = {};
  msg.id       = tx.transaction.id;
  msg.to       = this.app.wallet.returnPublicKey();
  msg.from     = tx.transaction.from[0].add;
  msg.time     = tx.transaction.ts;
  msg.module   = txmsg.module;
  msg.title    = "You have received a " + msg.module + " request";
  msg.data     = emailBody;
  msg.markdown = 0;  // 0 = display as HTML
                    // 1 = display as markdown

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.recipientOpenConfirmEmail = function recipientOpenConfirmEmail(tx, app, channel) {
  // Send an email to channel recipient confirming that a channel has been opened

  var txmsg = tx.returnMessage();

  var emailBody = '<div class="recipient_open_confirm">'
    +'<p>A payment channel has been opened from ' + channel.peerSaitoAddr
    +' to you. The channel information is as follows:</p>'
    +'<ul>' 
      +'<li>Your Eth address: ' + '<strong>'
        +channel.myEthAddr + '</strong>. '
        +'**You must verify that you have the private key for this address**'
      +'</li>'
      +'<li>Sender Eth Address: ' + channel.peerEthAddr + '</li>'
      +'<li>Open Block: ' + channel.openBlock + '</li>'
      +'<li>Deposit Amount: ' + channel.deposit + '</li>'
      +'<li>Sender\s current channel balance: ' + channel.peerBal + '</li>'
      +'<li>Your current channel balance: ' + channel.myBal + '</li>'
    +'</ul>'
    +'<p>You will recieve a confirmation email for every new payment '
    +'that you recieve.</p>'
  +'</div>'

  msg = {};
  msg.id = tx.transaction.id;
  msg.from = tx.transaction.from[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "EthChannel Opened to you";
  msg.data = emailBody;
  msg.markdown = 0; 

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.senderOpenConfirmEmail = function senderOpenConfirmEmail(tx, app, channel) {
  // Send an email to the channel sender confirming that channel has been opened

  var txmsg = tx.returnMessage();

// ** Signature should be keccak256(channel_key, amt_to_pay_recipient)


  var emailBody = '<div class="sender_open_confirm">'
    +'<div>'
      +'<p>You have opened a payment channel to ' + tx.transaction.to[0].add
      +'. The channel information is as follows:</p>'  
      +'<ul>' + '<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Recipient Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Recipient\'s current channel balance: ' + channel.peerBal + '</li>'
        +'<li>Your current channel balance: ' + channel.myBal + '</li>'
      +'</ul>'
    +'</div><br>'
    +'<div>'
      +'<h1><u>Send a Payment</u></h1>'
      +'<form class="payment_form">'
        +'Payment Amount: '
        +'<input type="number" id="amt" name="amt"><span>ETH</span><br>'
      +'</form>'
      +'<input type="button" id="create_sig" value="CREATE SIGNATURE" />'
    +'</div>'
    +'<div class="sig_page_2" style="display:none;">'
      +'<p>Please sign the following message using MetaMask, Geth, etc.:</p>'
      +'<p id="msg_to_sign"></p>'
      +'<p>Enter the resulting signature below:</p>'
      +'<input type="text" id="sig" name="sig"><br>'
      +'<input type="button" id="submit_sig" value="SEND PAYMENT SIGNATURE" />'
    +'</div>'
  +'</div>'

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.from[0].add;
  msg.from = tx.transaction.to[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "EthChannel Opened from you";
  msg.data = emailBody;
  msg.markdown = 0; 

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.senderPaymentConfirmEmail = function senderPaymentConfirmEmail(tx, app, channel) {
  // Send an email to channel sender confirming that a valid payment was sent
  // to the channel recipient
  
  var txmsg = tx.returnMessage();

  var emailBody = '<div class="sender_payment_confirm">'
    +'<div>'
      +'<p>You have sent an EthChannels payment to ' + tx.transaction.to[0].add
      +'. The current channel information is as follows:</p>'  
      +'<ul>' + '<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Recipient Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Recipient\'s current channel balance: ' + channel.peerBal + '</li>'
        +'<li>Your current channel balance: ' + channel.myBal + '</li>'
        +'<li>Most recent payment signature: ' + channel.lastSig + '</li>'
      +'</ul>'
    +'</div><br>'
    +'<div>'
      +'<h1><u>Send Another Payment</u></h1>'
      +'<p><strong>Note:</strong> The payment amount must be the cumulative channel '
      + 'payment, not the additional payment.</p>'
      +'<form class="payment_form">'
        +'Payment Amount: '
        +'<input type="number" id="amt" name="amt"><span>ETH</span><br>'
      +'</form>'
      +'<input type="button" id="create_sig" value="CREATE SIGNATURE" />'
    +'</div>'
    +'<div class="sig_page_2" style="display:none;">'
      +'<p>Please sign the following message using MetaMask, Geth, etc.:</p>'
      +'<p id="msg_to_sign"></p>'
      +'<p>Enter the resulting signature below:</p>'
      +'<input type="text" id="sig" name="sig"><br>'
      +'<input type="button" id="submit_sig" value="SEND PAYMENT SIGNATURE" />'
    +'</div>'
  +'</div>';

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.from[0].add;
  msg.from = tx.transaction.to[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "Your latest Payment Sent";
  msg.data = emailBody;
  msg.markdown = 0;

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.recipientPaymentConfirmEmail = function recipientPaymentConfirmEmail(tx, app, channel) {
  // Send an email to the channel recipient confirming that a valid payment
  // signature was sent to them
  
  var txmsg = tx.returnMessage();

  var emailBody = '<div class="recipient_payment_confirm">'
    +'<div>'
      +'<p>An EthChannels payment has been sent to you from ' + 
      +tx.transaction.from[0].add + '. The current channel information is as follows:</p>'
      +'<ul>' 
        +'<li>Your Eth address: ' + '<strong>'
          +channel.myEthAddr + '</strong>. '
          +'**You must verify that you have the private key for this address**'
        +'</li>'
        +'<li>Sender Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Sender\'s current channel balance: ' + channel.peerBal + '</li>'
        +'<li>Your current channel balance: ' + channel.myBal + '</li>'
        +'<li>Most recent payment signature: ' + channel.lastSig + '</li>'
      +'</ul>'
      +'<p>You will recieve a confirmation email for every new payment '
      +'that you recieve.</p>'
      +'<h1><u>Close Channel</u></h1>'
      +'<p><strong>Note:</strong>No matter which payment confirmation email you close the channel from, it will always be closed with the latest signature (which corresponds to the highest payment for you).</p>'
      +'<input type="button" id="close_channel" value="CLOSE CHANNEL WITH CURRENT BALNCE" />'
    +'</div>'
    +'<div id="close_channel_page_2" style="display:none">'
      +'<p>Please use your Eth address, ' + '<span id="#channel_recipient_eth_addr"></span>, '
      +'to send the following transaction to the payment channels contract on the Rinkeby testnet:'
      +'<div><strong>closeChannel({data})</strong></div>'
      +'Contract Address: <strong>' + this.contractAddr + '</strong><br><br>'
      +'Click the button below after the closeChannel() transaction is confirmed.'
      +'</p>'
      +'<input type="button" id="close_tx_submitted" value="CLICK HERE AFTER CONFIRMATION" />'
    +'</div>'
  +'</div>';

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.to[0].add;
  msg.from = tx.transaction.from[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "Your latest Payment Received";
  msg.data = emailBody;
  msg.markdown = 0;

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.senderConfirmCloseEmail = function senderConfirmCloseEmail(tx, app, channel) {
  // Send an email to the channel sender confirming that the channel was closed

  var txmsg= tx.returnMessage();

  var emailBody = '<div>'
    +'<p>Your payment channel to ' + tx.transaction.from[0].add
    +'has been closed and successfully paid out. The final channel information is as follows:</p>'
    +'<ul>' 
        +'<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Recipient Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Recipient\'s final channel balance: ' + channel.peerBal + '</li>'
        +'<li>Your final channel balance: ' + channel.myBal + '</li>'
        +'<li>Final payment signature: ' + channel.lastSig + '</li>'
      +'</ul>'
      +'<p>Thank you for using the EthChannels Module!</p>'
  +'</div>';

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.to[0].add;
  msg.from = tx.transaction.from[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "Your EthChannel has been closed.";
  msg.data = emailBody;
  msg.markdown = 0;

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}

EthChannels.prototype.recipientConfirmCloseEmail = function recipientConfirmCloseEmail(tx, app, channel) {
  // Send an email to the channel recipient confirming that the channel \
  // was closed
  
  var txmsg= tx.returnMessage();

  var emailBody = '<div>'
    +'<p>Your payment channel from ' + tx.transaction.from[0].add
    +'has been closed and successfully paid out. The final channel information is as follows:</p>'
    +'<ul>' 
        +'<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Sender Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Sender\'s final channel balance: ' + channel.peerBal + '</li>'
        +'<li>Your final channel balance: ' + channel.myBal + '</li>'
        +'<li>Final payment signature: ' + channel.lastSig + '</li>'
      +'</ul>'
      +'<p>Thank you for using the EthChannels Module!</p>'
  +'</div>';

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.from[0].add;
  msg.from = tx.transaction.to[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = "Your EthChannel has been closed.";
  msg.data = emailBody;
  msg.markdown = 0;

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveMessage(tx);
}



/////////////////////
// Email Callbacks //
/////////////////////
//
//

// Display the initial email form
EthChannels.prototype.displayEmailForm = function displayEmailForm(app) {

  $('#module_editable_space').html(
    '<div id="module_instructions" class="module_instructions">'
      +'<form class="channel_request_form">'
        +'Your public Ethereum address:<br>'
        +'<input type="text" name="recipientEthAddr"><br>'
        +'Deposit amount requested:<br>'
        +'<input type="number" name="requestedDeposit"><span>ETH</span><br>'
      +'</form>'
    +'</div>');
}


// Format the initial email transaction
EthChannels.prototype.formatEmailTransaction = function formatEmailTransaction(tx, app) {
  tx.transaction.msg.module = this.name;
  var formData = $('form').serializeArray();
  var txData = {recipientEthAddr:formData[0].value, requestedDeposit:formData[1].value};
  tx.transaction.msg.data = txData;
  tx.transaction.msg.request = this.openRequestString;
  return tx;
}

/////////////////////
// Display Message //
/////////////////////
EthChannels.prototype.displayEmailMessage = function displayEmailMessage(message_id, app) {

  if (app.BROWSER == 1) {
    message_text_selector = "#" + message_id + " > .data";
    $('#lightbox_message_text').html( $(message_text_selector).html() );
  }
}

// TODO: use .formatAuthor(author, app)
ModTemplate.prototype.attachEmailEvents = function attachEmailEvents(app) {

  var ec_self = this;
  var amt = null;

  $('#open_channel').off().on('click', function() {
    var openData = $('#open_form').serializeArray();
    $('#channel_sender_eth_addr').text(openData[0].value);
    $('#deposit').text(openData[1].value);
    $('#open_channel_body').hide().siblings('div').show();
  });


// ** Signature should be keccak256(channel_key, amt_to_pay_recipient)
  $('#create_sig').off().on('click', function() {
    amt = $('#amt').val();
    var peerSaitoAddr = $('.lightbox_message_from_address').html();
    var channelId = ec_self.getOutgoingIndex(peerSaitoAddr);
    
    // Get the message for the user to sign
    var msgToSign = ec_self.getMsgToSign(
      ec_self.outgoingChannels[channelId].myEthAddr, 
      ec_self.outgoingChannels[channelId].peerEthAddr,
      ec_self.outgoingChannels[channelId].openBlock,
      web3.utils.toWei(amt, 'ether')
    );
    $('#msg_to_sign').text(msgToSign);
    $('.sig_page_2').show().siblings('div').hide();
  });


  $('#close_channel').off().on('click', function() {
    var peerSaitoAddr = $('.lightbox_message_from_address').html();
    var channelId = ec_self.getIncomingIndex(peerSaitoAddr);
    $('#channel_recipient_eth_addr').text(ec_self.incomingChannels[channelId].myEthAddr);

    $('#close_channel_page_2').show().siblings('div').hide();
    
  });


  $('#close_tx_submitted').off().on('click', function() {
    
    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );
    
    newtx.transaction.msg.module = ec_self.name;
    newtx.transaction.to[0].add = peerSaitoAddr;
    newtx.transaction.msg.request = ec_self.channelClosedString;
    newtx.transaction.msg.title = "Eth Channel Closed";
    newtx = ec_self.app.wallet.signTransaction(newtx);

    ec_self.app.mempool.addTransaction(newtx, 1);

    $('close_channel_page_2').hide().siblings('div').show();
    ec_self.app.modules.returnModule("Email").showBrowserAlert("Channel closed");
    ec_self.app.modules.returnModule("Email").closeMessage();
  });


  $('#submit_sig').off().on('click', function() {
    var sig = $('#sig').val();
    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    var txData = {sig:sig, amt:amt};

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );

    newtx.transaction.msg.module = ec_self.name;
    newtx.transaction.to[0].add = peerSaitoAddr;
    newtx.transaction.msg.request = ec_self.paymentSentString;
    newtx.transaction.msg.title = "Eth payment signature sent";
    newtx.transaction.msg.data = txData;
    newtx = ec_self.app.wallet.signTransaction(newtx);

    ec_self.app.mempool.addTransaction(newtx, 1);

    $('.sig_page_2').hide().siblings('div').show();
    ec_self.app.modules.returnModule("Email").showBrowserAlert("Payment sent");
    ec_self.app.modules.returnModule("Email").closeMessage();

  });

  
  $('#open_tx_submitted').off().on('click', function() {

    var peerEthAddr = $('.channel_recipient_eth_addr').html();
    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    var openData = $('#open_form').serializeArray();
    
    var txData = {
                    senderEthAddr:openData[0].value,
                    recipientEthAddr:peerEthAddr, 
                    deposit:openData[1].value
                  };

    console.log("Wallet Balance before creating second tx: ", ec_self.app.wallet.returnBalance());

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );
    
    //
    // Send confirmation message
    //
    newtx.transaction.msg.module = ec_self.name;
    newtx.transaction.to[0].add = peerSaitoAddr;
    newtx.transaction.msg.request = ec_self.channelOpenedString;
    newtx.transaction.msg.title = "Eth Channel pending";
    newtx.transaction.msg.data = txData;
    newtx = ec_self.app.wallet.signTransaction(newtx);
    
    ec_self.app.mempool.addTransaction(newtx, 1);

    $('#open_channel_body').show().siblings('div').hide();
    ec_self.app.modules.returnModule("Email").showBrowserAlert("Channel Open Transaction Sent")
    ec_self.app.modules.returnModule("Email").closeMessage();

  });
};


// Get the index of the channel currently open with counterparty in
// the outgoingChannels array
EthChannels.prototype.getOutgoingIndex = function getOutgoingIndex(peerAddr) {
  for (let i = 0; i < this.outgoingChannels.length; i++) {
    if (this.outgoingChannels[i].peerSaitoAddr === peerAddr) {
      return i;
    }
  }
}

// Get the index of the channel currently open with counterparty in
// the incomingChannels array
EthChannels.prototype.getIncomingIndex = function getIncomingIndex(peerAddr) {
  for (let i = 0; i < this.incomingChannels.length; i++) {
    if (this.incomingChannels[i].peerSaitoAddr === peerAddr) {
      return i;
    }
  }
}


// Check if channel exists in outgoingChannels
// peerAddr is the channel peer's Saito Address
EthChannels.prototype.outgoingExists = function outgoingExists(peerAddr) {

  for (let i = 0; i < this.outgoingChannels.length; i++) {
    if (this.outgoingChannels[i].peerSaitoAddr === peerAddr) {
      return true;
    }
  }
  return false;
}


// Check if channel exists in incomingChannels
// peerAddr is the channel peer's Saito Address
EthChannels.prototype.incomingExists = function incomingExists(peerAddr) {
  for (let i = 0; i < this.incomingChannels.length; i++) {
    if (this.incomingChannels[i].peerSaitoAddr === peerAddr) {
      return true;
    }
  }
  return false;
}


// Save the outgoingChannels to app options
EthChannels.prototype.saveOutgoingChannels = function saveOutgoingChannels() {
  this.app.options.outgoingChannels = this.outgoingChannels;
  this.app.storage.saveOptions();
}


// Save the incoming channels to app options
EthChannels.prototype.saveIncomingChannels = function saveIncomingChannels() {
  this.app.options.incomingChannels = this.incomingChannels;
  this.app.storage.saveOptions();
}


// Create the signature to sign 'amt' over from 'sender' to 'recipient'
// sender and recipient should be ETH addresses, amt should be in Wei
EthChannels.prototype.getMsgToSign = function getMsgToSign(sender, recipient, openBlock, amt) {
  
  // Get the channel key - keccak256(sender, recipient, openBlock)
  // Note that openBlock is hashed as a uint32
  var key = web3Utils.soliditySha3(
    {type: 'address', value: sender},
    {type: 'address', value: recipient},
    {type: 'uint32', value: new BN(openBlock)}
  );

  console.log("Key: ", key);

  // Get the msg for the user to sign - keccak256(channelKey, amt)
  // Note that transfer amount is hashed as a uint72
  var msgToSign = web3Utils.soliditySha3(
    {type: 'bytes32', value: key},
    {type: 'uint72', value: new BN(amt)}
  );

  console.log("Msg:", msgToSign);

  return msgToSign;
}


// TODO: the verifySig contract function currently returns true if a signature of 
// invalid length (length << 65) is passed in. This is because of how reverts
// in view functions are handled by the EVM (basically, the call reverts but this
// revert is bubbled up as a 0 return value because it is a view function, so the
// calling function interprets this 0 return as true). This is not a direct security 
// concern, because a different internal function is used to verify that a signature
// can close a channel, but it could cause users to be tricked by an invalid signature
EthChannels.prototype.verifySig = function verifySig(sender, recipient, openBlock, amt, sig) {

  // Call the Channels contract verifySignature function
  return channelsContract.methods.verifySignature(sender, recipient, openBlock, amt, sig).call()
    .then((result) => { 
      console.log("Result from verifySig(): ", result);

      // Check signature length. This should ultimately be fixed in the contract,
      // but is a temporary fix for the issue mentioned above
      if (sig.length != 65) {
        return false;
      }
      
      // Return bool from the contract call
      return result;
    })
    .catch((error) => {
      console.log("Error from verifySig(): ", error);
      return false;
    });

}


// Filter contract events to check if a channel has been closed
EthChannels.prototype.isChannelClosed = function isChannelClosed(sender, recipient, openBlock) {
  
  return new Promise(function(resolve, reject) {
    channelsContract.getPastEvents('ChannelClosed', {
      filter: {
        _sender: sender, 
        _recipient: recipient, 
        _openBlock: openBlock
      },
      fromBlock:0, 
      toBlock:'latest'
    }, function(error, events) {

      if (error) {
        console.log("Error from isChannelClosed(): ", error);
        reject(error);
      } else {
        console.log("Events from isChannelClosed(): ", events);

        // If the returned events array contains an event that matches
        // the given parameters, then the channel has been closed
        if (events.length) {
          resolve(true);
        } else {
          // Channel has not been closed
          resolve(false);
        }
      }
    })
  });
}


// Filter Ethereum events from the contract to find the most recently opened
// channel between the two addressses. This creates some possible confusion
// if the users have opened a separate payment channel between them more
// recently than the module channel. This will be easily solved after
// MetaMask integration, because we can grab the openBlock from MetaMask
// or ask for it as an input from any non-email based interactions
// with the module
EthChannels.prototype.getOpenBlock = function getOpenBlock(sender, recipient) {
  
  return new Promise(function(resolve, reject) {
    channelsContract.getPastEvents('ChannelCreated', {
      filter: {
        _sender: sender, 
        _recipient: recipient
      },
      fromBlock: 0, 
      toBlock:'latest',
      }, function (error, events) {
        if (error) {
          console.log("Error from getOpenBlock: ", error);
          reject(error);
        } else {
          console.log("Events from getOpenBlock: ", events);

          // Return the blockNumber at which the most recent ChannelCreated
          // event matching the sender and recipient addresses was emitted
          resolve(events[events.length - 1].blockNumber);
        }
      });
  });
}


// Check that the channel is still open. Because the Channels contract
// stores payment channel structs within a mapping (key => Channel),
// every key with have a channel with default initialization values. The
// contract does not allow channels to be opened with deposit == 0 (the
// default initialization value for uint types), so if the deposit 
// matches our channel deposit and is non-zero, than the channel remains
// open
EthChannels.prototype.isChannelOpen = function isChannelOpen(sender, recipient, openBlock, deposit) {

  return channelsContract.methods.getChannelDeposit(sender, recipient, openBlock).call()
    .then((result) => {
      console.log("Deposit from isChannelOpen(): ", result.toString());

      if (deposit === 0) {
        return false
      }

      return result.toString() === deposit.toString();
    })
    .catch((error) => {
      console.log("Error from isChannelOpen(): ", error);
      return false;
    });

}


EthChannels.prototype.isValidEthAddress = function isValidEthAddress(address) {
  // Use web3 isAddress and other checksum-related functions
  // https://web3js.readthedocs.io/en/1.0/web3-utils.html?highlight=isValidAddress#isaddress
  return true;
}







