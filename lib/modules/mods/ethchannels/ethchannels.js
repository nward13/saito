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
const channelsContract = new web3.eth.Contract(contractAbi, '0x8994743c6631F2b4bfC9a97e17fb39A28b0502e1');


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
  this.contractAddr = '0x8994743c6631F2b4bfC9a97e17fb39A28b0502e1';

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

  this.channelFromYouString = "Channel opened from you";
  this.paymentFromYouString = "Your latest payment sent";
  this.requestRecievedString = "Eth Channel Request Recieved"

  return this;
}
module.exports = EthChannels;
util.inherits(EthChannels, ModTemplate);


ModTemplate.prototype.initialize = function initialize(app) {
  
  var ec_self = app.modules.returnModule("EthChannels");

  // If we have previously saved outgoing channels, load them
  if (ec_self.app.options.outgoingChannels !== undefined)
    ec_self.outgoingChannels = ec_self.app.options.outgoingChannels;

  // If we have previously saved incoming channels, load them
  if (ec_self.app.options.incomingChannels !== undefined) 
    ec_self.incomingChannels = ec_self.app.options.incomingChannels;

};


//////////////////
// Confirmation //
//////////////////
EthChannels.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {

  var ec_self = app.modules.returnModule("EthChannels");

  // on the first confirmation
  if (conf === 0) {

    // if transaction is to us...
    if (tx.transaction.to[0].add === app.wallet.returnPublicKey()) {

      var txmsg = tx.returnMessage();

      // if this is an original request to open a new payment channel 
      // (from channel recipient to channel sender), then we are channel sender
      // and this is an outgoing channel for us
      if (txmsg.request === ec_self.openRequestString) {

        // Check that the tx contains a valid Eth address. This is checked in the
        // email form as well, but this is an extra precaution against lost Eth
        // and a check for tx's originated separately from the email form
        if (!ec_self.isValidEthAddress(txmsg.data.recipientEthAddr))
          return false;

        // Get channel recipient's saito address from the tx
        var peerSaitoAddr = tx.transaction.from[0].add;

        // If the channel already exists, only send the email
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

      }

      // If the channel has just been opened (tx from channel sender to 
      // channel recipient), then we are the channel recipient and this
      // is an incoming channel for us
      if (txmsg.request === ec_self.channelOpenedString) {

        // Check that the tx contains a valid Eth address. This is checked in the
        // email form as well, but this is an extra precaution against lost Eth
        // and a check for tx's originated separately from the email form
        if (!ec_self.isValidEthAddress(txmsg.data.senderEthAddr)) {
          return false;
        }

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
            ec_self.recipientOpenConfirmEmail(tx, app, ec_self.incomingChannels[channelId]);
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

          // Query the Channels contract to make sure the channel is still open
          return ec_self.isChannelOpen(
            txmsg.data.senderEthAddr,
            ec_self.incomingChannels[channelId].myEthAddr,
            openBlock,
            web3.utils.toWei(txmsg.data.deposit.toString(), 'ether')
          )
        }).then(channelOpen => {
          
          // If the channel is not open, return false
          // If getOpenBlock() returns 0 (no ChannelOpened events found
          // between sender and recipient), the channel key will be
          // uninitialized and the statement will execute
          if (!channelOpen) {
            return false;
          } else {
            // Now we know that channel has been opened, so we finish creating it in our module
            ec_self.incomingChannels[channelId].peerEthAddr = txmsg.data.senderEthAddr;
            ec_self.incomingChannels[channelId].deposit = Number(web3.utils.toWei(txmsg.data.deposit.toString(), 'ether'));
            ec_self.incomingChannels[channelId].peerBal = Number(web3.utils.toWei(txmsg.data.deposit.toString(), 'ether'));
            ec_self.incomingChannels[channelId].myBal = 0;
            ec_self.incomingChannels[channelId].openBlock = openBlock;

            // Save the new state
            ec_self.saveIncomingChannels();

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

        // Pull data from transaction
        var sig = txmsg.data.sig;
        var amt = Number(web3.utils.toWei(txmsg.data.amt.toString(), 'ether'));
        var peerSaitoAddr = tx.transaction.from[0].add;

        // Check that the tx contains a signature of the expected form. 
        // This is checked in the email form as well
        if (!ec_self.isExpectedSigForm(sig))
          return false;

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

        // Check that the signature is valid
        return ec_self.verifySig(
          ec_self.incomingChannels[channelId].peerEthAddr, 
          ec_self.incomingChannels[channelId].myEthAddr, 
          ec_self.incomingChannels[channelId].openBlock,
          amt, 
          sig
        ).then(result => {

          // If the signature is not verified, return false
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
      
      var txmsg = tx.returnMessage();

      // if this is an original request to open a new payment channel 
      // (from channel recipient to channel sender), then we are channel recipient
      // and this is an incoming channel for us. This tx is from us, but
      // we want to initialize a channel with the Eth address we gave to 
      // avoid our counterparty tricking us into a payment channel with
      // a different Eth address. This could be done in the formatEmailTransaction
      // callback, but we want to make module usable by non-email users
      if (txmsg.request === ec_self.openRequestString) {

        // Check that the tx contains a valid Eth address. This is checked in the
        // email form as well, but this is an extra precaution against lost Eth
        // and a check for tx's originated separately from the email form
        if (!ec_self.isValidEthAddress(txmsg.data.recipientEthAddr))
          return false;

        // Grab counterparty's Saito address from tx
        var peerSaitoAddr = tx.transaction.to[0].add;

        // If we already have an incoming channel from them, don't 
        // initialize, but send us the email
        if (ec_self.incomingExists(peerSaitoAddr)) {
          return false;
        }

        // Now we know channel does not exist yet, so we create it
        var newChannel = {};
        newChannel.peerSaitoAddr = peerSaitoAddr;
        newChannel.myEthAddr = txmsg.data.recipientEthAddr;
        ec_self.incomingChannels.push(newChannel);

        // Save the new state
        ec_self.saveIncomingChannels();

      }

      // If the channel opened tx is from us, we are the channel sender
      // and this is an outgoing channel for us
      if (txmsg.request === ec_self.channelOpenedString) {

        // Check that the tx contains a valid Eth address. This is checked in the
        // email form as well, but this is an extra precaution against lost Eth
        // and a check for tx's originated separately from the email form
        if (!ec_self.isValidEthAddress(txmsg.data.senderEthAddr))
          return false;

        var peerSaitoAddr = tx.transaction.to[0].add;
        var channelId;

        // We should have a partially initialized channel with them, with
        // only peerSaitoAddr and peerEthAddr defined
        if (ec_self.outgoingExists(peerSaitoAddr)) {
          // If the channel exists, check if there is a deposit defined yet
          // if no deposit, this is a new tx, so change channel state

          // Grab the index of the channel in out outgoingChannels array
          channelId = ec_self.getOutgoingIndex(peerSaitoAddr);

          // If the deposit is already defined, this is a repeat tx,
          // so we don't want to change our channel state
          if (ec_self.outgoingChannels[channelId].deposit > 0) {
            ec_self.senderOpenConfirmEmail(tx, app, ec_self.outgoingChannels[channelId]);
            return false;
          }
        } else {
          // If the channel does not exist yet, this is an unrequested channel.
          // This will fail on the channel recipient's end, so we want to
          // so we don't want to initialize
          return false;
        }

        // Filter Ethereum events to get the openBlock of the channel
        // on the Ethereum blockchain
        var openBlock;
        return ec_self.getOpenBlock(
          txmsg.data.senderEthAddr,
          txmsg.data.recipientEthAddr
        ).then(OB => {
          openBlock = OB;

          // Confirm that the channel is still open
          ec_self.isChannelOpen(
            txmsg.data.senderEthAddr,
            txmsg.data.recipientEthAddr,
            openBlock,
            web3.utils.toWei(txmsg.data.deposit.toString(), 'ether')
          ).then(channelOpen => {

            // If the channel is not open, don't alter state
            // If getOpenBlock() returns 0, the channel deposit will be
            // uninitialized and this statement will execute
            if (!channelOpen) {
              return false;
            } else {

              // Now we know that channel has been opened, so we finish creating it in our module
              // var channelId = ec_self.getOutgoingIndex(tx.transaction.to[0].add);
              ec_self.outgoingChannels[channelId].deposit = Number(web3.utils.toWei(txmsg.data.deposit.toString(), 'ether'));
              ec_self.outgoingChannels[channelId].myEthAddr = txmsg.data.senderEthAddr;
              ec_self.outgoingChannels[channelId].myBal = Number(web3.utils.toWei(txmsg.data.deposit.toString(), 'ether'));
              ec_self.outgoingChannels[channelId].peerBal = 0;
              ec_self.outgoingChannels[channelId].openBlock = openBlock;

              // Save the new state
              ec_self.saveOutgoingChannels();

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

        // Grab data from the tx
        var sig = txmsg.data.sig;
        var amt = Number(web3.utils.toWei(txmsg.data.amt.toString(), 'ether'));
        var peerSaitoAddr = tx.transaction.to[0].add;

        // Check that the tx contains a signature of the expected form. 
        // This is checked in the email form as well
        if (!ec_self.isExpectedSigForm(sig))
          return false;

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
          // If the signature is invalid, do not alter state, but email
          // sender that they sent an invalid sig. Can't do this in email
          // form because it's async, but should also add length checks
          // and some other basic checks to the form
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
    + '<p>You have received a request to open an Ethereum payment channel to '
    + app.modules.returnModule("Email").formatAuthor(tx.transaction.from[0].add, app)
    + ' with a suggested deposit amount of ' + txmsg.data.requestedDeposit
    + ' ETH.' + ' To open this channel, specify your own Ethereum address and '
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
    + '<div><strong>openChannel(<br>&emsp;' + '<span class="channel_recipient_eth_addr">\''
    + txmsg.data.recipientEthAddr + '\'</span>' + ',<br>&emsp;{ value: ' + '<span id="deposit"></span>' + ' }<br>)'
    + '</strong></div>' + '<br>'
    +'This can be done using Geth or Remix. The contract can be found at Rinkeby address '
    +'<a href="https://rinkeby.etherscan.io/address/0x8994743c6631f2b4bfc9a97e17fb39a28b0502e1" target="_blank">'
    + this.contractAddr + '</a>. '
    + 'Click the button below after the openChannel() transaction is confirmed.'
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
  msg.title    = this.requestRecievedString;
  msg.data     = emailBody;
  msg.markdown = 0;  // 0 = display as HTML
                    // 1 = display as markdown

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveTransaction(tx);
}

EthChannels.prototype.recipientOpenConfirmEmail = function recipientOpenConfirmEmail(tx, app, channel) {
  // Send an email to channel recipient confirming that a channel has been opened

  var txmsg = tx.returnMessage();

  var emailBody = '<div class="recipient_open_confirm">'
    +'<p>A payment channel has been opened from '
    +app.modules.returnModule("Email").formatAuthor(channel.peerSaitoAddr, app) 
    +' to you. The channel information is as follows:</p>'
    + this.channelInfoHtml(channel, toSender=false)
    +'<p>You will receive a confirmation email for every new payment '
    +'that you receive.</p>'
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
  app.archives.saveTransaction(tx);
}

EthChannels.prototype.senderOpenConfirmEmail = function senderOpenConfirmEmail(tx, app, channel) {
  // Send an email to the channel sender confirming that channel has been opened

  var txmsg = tx.returnMessage();

  var emailBody = '<div class="sender_open_confirm">'
  +'<div>'
    +'<p>You have opened a payment channel to ' 
    + app.modules.returnModule("Email").formatAuthor(tx.transaction.to[0].add, app)
    +'. The channel information is as follows:</p>'  
    + this.channelInfoHtml(channel, toSender=true)
    + this.signatureHtml()
  +'</div><br>'
  
  +'</div>'

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.from[0].add;
  msg.from = tx.transaction.to[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = this.channelFromYouString;
  msg.data = emailBody;
  msg.markdown = 0; 

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveTransaction(tx);
}


EthChannels.prototype.senderPaymentConfirmEmail = function senderPaymentConfirmEmail(tx, app, channel) {
  // Send an email to channel sender confirming that a valid payment was sent
  // to the channel recipient
  
  var txmsg = tx.returnMessage();

  var emailBody = '<div class="sender_payment_confirm">'
    +'<div>'
      +'<p>You have sent an EthChannels payment to ' + 
      app.modules.returnModule("Email").formatAuthor(tx.transaction.to[0].add, app)
      +'. The current channel information is as follows:</p>'  
      + this.channelInfoHtml(channel, toSender=true)
    +'</div><br>'
    + this.signatureHtml()
  +'</div>';

  msg = {};
  msg.id = tx.transaction.id;
  msg.to = tx.transaction.from[0].add;
  msg.from = tx.transaction.to[0].add;
  msg.time = tx.transaction.ts;
  msg.module = txmsg.module;
  msg.title = this.paymentFromYouString;
  msg.data = emailBody;
  msg.markdown = 0;

  app.modules.returnModule("Email").attachMessage(msg, app);
  app.archives.saveTransaction(tx);
}

EthChannels.prototype.recipientPaymentConfirmEmail = function recipientPaymentConfirmEmail(tx, app, channel) {
  // Send an email to the channel recipient confirming that a valid payment
  // signature was sent to them
  
  var txmsg = tx.returnMessage();

  var emailBody = '<div class="recipient_payment_confirm">'
    +'<div>'
      +'<p>An EthChannels payment has been sent to you from '
      + app.modules.returnModule("Email").formatAuthor(tx.transaction.from[0].add, app)
      + '. The current channel information is as follows:</p>'
      + this.channelInfoHtml(channel, toSender=false)
      +'<p>You will receive a confirmation email for every new payment '
      +'that you receive.</p>'
      +'<h1><u>Close Channel</u></h1>'
      +'<p><strong>Note: </strong>No matter which payment confirmation email you close the channel from, it will always be closed with the latest signature (which corresponds to the highest payment for you).</p>'
      +'<input type="button" id="close_channel" value="CLOSE CHANNEL WITH CURRENT BALANCE" />'
    +'</div>'
    +'<div id="close_channel_page_2" style="display:none">'
      +'<p>Please use your Eth address, ' + channel.myEthAddr
      +', to send the following transaction to the payment channels contract on the Rinkeby testnet:'
      +'<div><strong>closeChannel(<br>&emsp;\'' + channel.peerEthAddr + '\',<br>&emsp;' + channel.openBlock
      + ',<br>&emsp;' + channel.myBal + ',<br>&emsp;\'' + channel.lastSig + '\'<br>)</strong></div>'
      +'<br>'
      +'This can be done using Geth or Remix. The contract can be found at Rinkeby address '
      +'<a href="https://rinkeby.etherscan.io/address/0x8994743c6631f2b4bfc9a97e17fb39a28b0502e1" target="_blank">'
      + this.contractAddr + '</a>. '
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
  app.archives.saveTransaction(tx);
}


EthChannels.prototype.senderConfirmCloseEmail = function senderConfirmCloseEmail(tx, app, channel) {
  // Send an email to the channel sender confirming that the channel was closed

  var txmsg= tx.returnMessage();

  var emailBody = '<div>'
    +'<p>Your payment channel to ' 
    + app.modules.returnModule("Email").formatAuthor(tx.transaction.from[0].add, app)
    +' has been closed and successfully paid out. The final channel information is as follows:</p>'
    +'<ul>' 
        +'<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Recipient Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Recipient\'s final channel balance: ' 
          + web3.utils.fromWei(channel.peerBal.toString(), 'ether') + ' ETH ('
          + channel.peerBal + ' Wei)' + '</li>'
        +'<li>Your final channel balance: ' 
          + web3.utils.fromWei(channel.myBal.toString(), 'ether') + ' ETH (' 
          + channel.myBal + ' Wei)' + '</li>'
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
  app.archives.saveTransaction(tx);
}


EthChannels.prototype.recipientConfirmCloseEmail = function recipientConfirmCloseEmail(tx, app, channel) {
  // Send an email to the channel recipient confirming that the channel \
  // was closed
  
  var txmsg= tx.returnMessage();

  var emailBody = '<div>'
    +'<p>Your payment channel from '
    + app.modules.returnModule("Email").formatAuthor(tx.transaction.from[0].add, app)
    +' has been closed and successfully paid out. The final channel information is as follows:</p>'
    +'<ul>' 
        +'<li>Your Eth address: ' + channel.myEthAddr + '</li>'
        +'<li>Sender Eth Address: ' + channel.peerEthAddr + '</li>'
        +'<li>Open Block: ' + channel.openBlock + '</li>'
        +'<li>Deposit Amount: ' + channel.deposit + '</li>'
        +'<li>Sender\'s final channel balance: ' 
          + web3.utils.fromWei(channel.peerBal.toString(), 'ether') + ' ETH ('
          + channel.peerBal + ' Wei)' + '</li>'
        +'<li>Your final channel balance: ' 
          + web3.utils.fromWei(channel.myBal.toString(), 'ether') + ' ETH ('
          + channel.myBal + ' Wei)' + '</li>'
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
  app.archives.saveTransaction(tx);
}


EthChannels.prototype.channelInfoHtml = function channelInfoHtml(channel, toSender=true) {

  var html = '<div class="channel_info">'
    + '<ul>' 
      + '<li>Your Eth address: ' + '<strong>' + channel.myEthAddr + '</strong>'
        + (toSender ? '' : '<br>**You must verify that you have the private key for this address**')
      + '</li>'
      + '<li>' + (toSender ? 'Recipient' : 'Sender') + ' Eth Address: ' 
        + channel.peerEthAddr + '</li>'
      + '<li>Open Block: ' + channel.openBlock + '</li>'
      + '<li>Deposit Amount: ' 
        + web3.utils.fromWei(channel.deposit.toString(), 'ether') + ' ETH ('
        + channel.deposit + ' Wei)' + '</li>'
      + '<li>' + (toSender ? 'Recipient\'s' : 'Sender\'s') + ' current channel balance: ' 
        + web3.utils.fromWei(channel.peerBal.toString(), 'ether') + ' ETH ('
        + channel.peerBal + ' Wei)' + '</li>'
      + '<li>Your current channel balance: ' 
        + web3.utils.fromWei(channel.myBal.toString(), 'ether') + ' ETH ('
        + channel.myBal + ' Wei)' + '</li>'
      + (channel.lastSig ? '<li>Most recent payment signature: ' + channel.lastSig + '</li>' : '')
    + '</ul>'
  + '</div>'

  return html;
}


EthChannels.prototype.signatureHtml = function signatureHtml() {
  var html = '<div>'
      +'<h1><u>Send a Payment</u></h1>'
      +'<p><strong>Note:</strong> The payment amount should be the cumulative channel '
      + 'payment, not the additional payment.</p>'
      +'<form class="payment_form">'
        +'Payment Amount: '
        +'<input type="number" id="amt" name="amt"><span>ETH</span><br>'
      +'</form>'
      +'<input type="button" id="create_sig" value="CREATE SIGNATURE" />'
    +'</div>'
    +'<div class="sig_page_2" style="display:none;">'
      +'<p>Please sign the following message using Geth, Web3, or an equivalent ECDSA implementation:</p>'
      +'<strong><p id="msg_to_sign"></p></strong>'
      +'<p>If you would like to reproduce this message yourself, it is the '
      +'Solidity Sha3 hash of the channel key and the payment amount (in Wei). '
      +'The channel key is the Solidity Sha3 hash of the sender Eth address, recipient Eth address, '
      +'and the open block (hashed as a uint32). To prevent arbitrary re-use of the signature, ' 
      +'the message should be signed with the prefix '
      +'\"\\x19Ethereum Signed Message:\\n32\", which Geth and equivalent implementations prepend by default.</p>'
      +'<p>Enter the resulting signature below:</p>'
      +'<input type="text" id="sig" name="sig"><br><br>'
      +'<input type="button" id="submit_sig" value="SEND PAYMENT SIGNATURE" />'
    +'</div>'

  return html;
}


/////////////////////
// Email Callbacks //
/////////////////////
//
//

// Display the initial email form
EthChannels.prototype.displayEmailForm = function displayEmailForm(app) {

  var ec_self = app.modules.returnModule("EthChannels");
  
  $('#module_editable_space').html(
    '<div id="module_instructions" class="module_instructions">'
      +'<h3>Welcome to the EthChannels Module</h3>'
      +'<p>To request a payment channel, add the requested channel sender\'s Saito address to the '
      +'\'FROM\' field of the email, fill in the fields below, and click SEND.</p>'
      +'<form class="channel_request_form">'
        +'Your public Ethereum address:<br>'
        +'<input type="text" name="recipientEthAddr" id="requester_eth_addr"><br>'
        +'Deposit amount requested:<br>'
        +'<input type="number" name="requestedDeposit"><span>ETH</span><br>'
      +'</form>'
    +'</div>'
  );

  // Validate eth address input
  $('#requester_eth_addr').change(function() {
    if (!ec_self.isValidEthAddress(this.value)) 
      alert("You have entered an invalid Ethereum address.");
  });
}


// Format the initial email transaction
EthChannels.prototype.formatEmailTransaction = function formatEmailTransaction(tx, app) {
  var ec_self = app.modules.returnModule("EthChannels");

  // Pull form data
  var formData = $('form').serializeArray();
  var txData = {recipientEthAddr:formData[0].value, requestedDeposit:formData[1].value};

  // Complete and return tx
  tx.transaction.msg.module = ec_self.name;
  tx.transaction.msg.data = txData;
  tx.transaction.msg.title = "Eth Channel Request";
  tx.transaction.msg.request = ec_self.openRequestString;
  
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


ModTemplate.prototype.attachEmailEvents = function attachEmailEvents(app) {

  var ec_self = app.modules.returnModule("EthChannels");
  var amt = null;
  var msgToSign = '';


  $('#open_channel').off().on('click', function() {
    // Pull form data
    var openData = $('#open_form').serializeArray();
    var senderEthAddr = openData[0].value;

    // Check that user input a valid Eth address
    if (!ec_self.isValidEthAddress(senderEthAddr)) {
      alert("You have entered an invalid Ethereum address.");
      return false;
    }

    // Fill the secondary form telling the user how to format the Ethereum tx
    $('#channel_sender_eth_addr').text(senderEthAddr);
    $('#deposit').text(Number(web3.utils.toWei(openData[1].value.toString(), 'ether')) + ' Wei');

    // Hide the initial form and show the Ethereum tx form
    $('#open_channel_body').hide().siblings('div').show();
  });


// ** Signature should be keccak256(channel_key, amt_to_pay_recipient)
  $('#create_sig').off().on('click', function() {
    // Grab data from the html
    amt = $('#amt').val();
    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    // Get the index of the channel in our outgoingChannels array
    var channelId = ec_self.getOutgoingIndex(peerSaitoAddr);

    // If user tries to send a payment amount that is not >= the channel
    // recipient's current channel balance, it should not be used to close
    // the channel anyway, so we don't want to sign it or send it. Likely, 
    // this means the user misunderstood the cumulative nature of the 
    // payment amount (each payment represents the channel recipient's 
    // new channel balance, not the amount to add to the current balance)
    if (web3.utils.toWei(amt.toString(), 'ether') < ec_self.outgoingChannels[channelId].peerBal) {
      alert('Payment amount represents the channel recipient\'s new balance. ' 
        + 'A signature cannot deduct from the recipient\'s balance. ' 
        + 'Therefore, payment amount must be greater than the recipient\'s current balance of '
        + web3.utils.fromWei(ec_self.outgoingChannels[channelId].peerBal.toString(), 'ether')
        + ' Eth.')
      return false;
    }

    // Get the message for the user to sign
    msgToSign = ec_self.getMsgToSign(
      ec_self.outgoingChannels[channelId].myEthAddr, 
      ec_self.outgoingChannels[channelId].peerEthAddr,
      ec_self.outgoingChannels[channelId].openBlock,
      web3.utils.toWei(amt.toString(), 'ether')
    );
    $('#msg_to_sign').text(msgToSign);
    $('.sig_page_2').show().siblings('div').hide();
    
  });


  $('#close_channel').off().on('click', function() {

    $('#close_channel_page_2').show().siblings('div').hide();

  });



  $('#submit_sig').off().on('click', function() {
    // Grab data from the html
    var sig = $('#sig').val();
    var peerSaitoAddr = $('.lightbox_message_from_address').html();
    $('.sig_page_2').show().siblings('div').hide();

    // Check that the signature matches the expected format
    if (!ec_self.isExpectedSigForm(sig)) {
      alert('Signature does not match the expected form.');
      return false;
    }

    var txData = {sig:sig, amt:amt};

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );

    if (newtx === null) {
      console.log("newtx is null. Inputs:");
      console.log("app.wallet.returnPublicKey(): ", ec_self.app.wallet.returnPublicKey());
      console.log("app.wallet.returnDefaultFee(): ", ec_self.app.wallet.returnDefaultFee());
      console.log("Wallet Available: ", ec_self.app.wallet.returnBalance());

      // Most likely reason for createUnsignedTransaction() returning null
      // is that we don't have enough funds to cover the tx cost. If that's
      // the case, alert the user
      if (ec_self.app.wallet.returnBalance() < ec_self.app.wallet.returnDefaultFee()) {
        alert('You need a saito balance greater than the default fee to send an EthChannels transaction. '
          + 'The current default fee is ' + ec_self.app.wallet.returnDefaultFee() +'. '
          + 'Please visit the Saito Token Faucet.');
      }

      return false;
    }

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

    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    var channelId = ec_self.getOutgoingIndex(peerSaitoAddr);

    var openData = $('#open_form').serializeArray();
    
    var txData = {
                    senderEthAddr:openData[0].value,
                    recipientEthAddr:ec_self.outgoingChannels[channelId].peerEthAddr, 
                    deposit:openData[1].value
                  };

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );

    if (newtx === null) {
      console.log("newtx is null. Inputs:");
      console.log("app.wallet.returnPublicKey(): ", ec_self.app.wallet.returnPublicKey());
      console.log("app.wallet.returnDefaultFee(): ", ec_self.app.wallet.returnDefaultFee());
      console.log("Wallet Available: ", ec_self.app.wallet.returnBalance());

      // Most likely reason for createUnsignedTransaction() returning null
      // is that we don't have enough funds to cover the tx cost. If that's
      // the case, alert the user
      if (ec_self.app.wallet.returnBalance() < ec_self.app.wallet.returnDefaultFee()) {
        alert('You need a saito balance greater than the default fee to send an EthChannels transaction. '
          + 'The current default fee is ' + ec_self.app.wallet.returnDefaultFee() +'. '
          + 'Please visit the Saito Token Faucet.');
      }

      return false;
    }
    
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


  $('#close_tx_submitted').off().on('click', function() {
    
    var peerSaitoAddr = $('.lightbox_message_from_address').html();

    var newtx = ec_self.app.wallet.createUnsignedTransaction(
      ec_self.app.wallet.returnPublicKey(), 
      0.0, 
      ec_self.app.wallet.returnDefaultFee()
    );

    if (newtx === null) {
      console.log("newtx is null. Inputs:");
      console.log("app.wallet.returnPublicKey(): ", ec_self.app.wallet.returnPublicKey());
      console.log("app.wallet.returnDefaultFee(): ", ec_self.app.wallet.returnDefaultFee());
      console.log("Wallet Available: ", ec_self.app.wallet.returnBalance());

      // Most likely reason for createUnsignedTransaction() returning null
      // is that we don't have enough funds to cover the tx cost. If that's
      // the case, alert the user
      if (ec_self.app.wallet.returnBalance() < ec_self.app.wallet.returnDefaultFee()) {
        alert('You need a saito balance greater than the default fee to send an EthChannels transaction. '
          + 'The current default fee is ' + ec_self.app.wallet.returnDefaultFee() +'. '
          + 'Please visit the Saito Token Faucet.');
      }

      return false;
    }
    
    newtx.transaction.msg.module = ec_self.name;
    newtx.transaction.to[0].add = peerSaitoAddr;
    newtx.transaction.msg.request = ec_self.channelClosedString;
    newtx.transaction.msg.title = "Eth Channel Closed";
    newtx = ec_self.app.wallet.signTransaction(newtx);

    ec_self.app.mempool.addTransaction(newtx, 1);

    $('close_channel_page_2').hide().siblings('div').show();
    ec_self.app.modules.returnModule("Email").showBrowserAlert("Channel Close Tx Sent");
    ec_self.app.modules.returnModule("Email").closeMessage();
  });


  if ($('#mail-module-label').html() === ec_self.channelFromYouString 
    || $('#mail-module-label').html() === ec_self.paymentFromYouString) 
  {
      $('.sig_page_2').hide().siblings('div').show();
  }
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
    {type: 'uint32', value: new BN(openBlock.toString())}
  );

  // Get the msg for the user to sign - keccak256(channelKey, amt)
  // Note that transfer amount is hashed as a uint72
  var msgToSign = web3Utils.soliditySha3(
    {type: 'bytes32', value: key},
    {type: 'uint72', value: new BN(amt.toString())}
  );

  return msgToSign;
}


// Verify that the signature can be used to close the channel
EthChannels.prototype.verifySig = function verifySig(sender, recipient, openBlock, amt, sig) {

  // Call the Channels contract verifySignature function
  return channelsContract.methods.verifySignature(sender, recipient, openBlock, amt.toString(), sig).call()
    .then((result) => { 
      
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

          if (events.length) {
            // Return the blockNumber at which the most recent ChannelCreated
            // event matching the sender and recipient addresses was emitted
            resolve((events[events.length - 1].blockNumber).toString());  
          } else {
            // If no events were found, resolve promise and return 0
            resolve(0);
          }
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

      if (deposit === 0) {
        return false;
      }

      return result.toString() === deposit.toString();
    })
    .catch((error) => {
      console.log("Error from isChannelOpen(): ", error);
      return false;
    });

}


// Checks that given address is a valid Ethereum address
EthChannels.prototype.isValidEthAddress = function isValidEthAddress(addr) {

  // If the given address is valid, check the address checksum too
  if (web3.utils.isAddress(addr)) {

    // If address is an upper or lowercase Ethereum address, convert it to
    // a checksum address
    var checksumAddr = web3.utils.toChecksumAddress(addr);

    // Return a bool indicating whether the address checksum is valid
    return web3.utils.checkAddressChecksum(checksumAddr);
  }
  
  return false;
}


EthChannels.prototype.isExpectedSigForm = function isExpectedSigForm(sig) {
  // Actually verifying that the signature can be used to close the channel
  // via a contract call is an async process, but we can check that the sig
  // fits the form we expect

  // Signature must be valid hexadecimal string
  // Convert hexadecimal string to integer (base 16)
  var sigAsInt = new BN(sig.slice(2), 16);
  // Convert back to hexadecimal string (0x prefix will be omitted) and
  // check that it matches the original sig
  if (sigAsInt.toString(16).toLowerCase() !== sig.slice(2).toLowerCase())
    return false;

  // Signature must begin with 0x prefix
  if (sig.slice(0, 2).toLowerCase() !== '0x')
    return false;

  // Signature must be 66 bytes long (65 byte signature + 1 byte prefix)
  if (Buffer.byteLength(sig, 'hex') !== 66)
    return false;

  // Last byte of signature must match a valid v value (00, 01, 1b (27), or 1c (28))
  var v = sig.slice(-2).toLowerCase();
  if (v === '00' || v === '01' || v === '1b' || v === '1c') {
    return true;
  } else {
    return false;
  }

}
