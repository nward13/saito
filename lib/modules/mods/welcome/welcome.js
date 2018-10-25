var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Welcome(app) {

  if (!(this instanceof Welcome)) { return new Welcome(app); }

  Welcome.super_.call(this);

  this.app               = app;
  this.name              = "Welcome";

  return this;

}
module.exports = Welcome;
util.inherits(Welcome, ModTemplate);









/////////////////////////
// Handle Web Requests //
/////////////////////////
Welcome.prototype.webServer = function webServer(app, expressapp) {

  var reddit_self = this;

  expressapp.get('/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
  expressapp.get('/welcome', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/welcome/:application', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });

}



/////////////////////
// Initialize HTML //
/////////////////////
Welcome.prototype.initializeHTML = function initializeHTML(app) {

  if (app.BROWSER == 0) { return; }

  if (app.options.display_adverts == 1 || app.options.display_adverts == undefined) {
    $('#disable_ads').html("Disable Ads");
    $('.advert-300-250').show();
  } else {
    $('#disable_ads').html("Enable Ads");
    $('.advert-300-250').hide();
  }

  this.updateControlPanel(app, app.blockchain.returnLatestBlock());

  $('#reset').off();
  $('#reset').on('click', function() {
    let reset_confirm = confirm("Are you sure you want to reset your wallet? You cannot retrieve your keys once you delete them")
    if (reset_confirm ){
      app.archives.resetArchives();
      app.storage.resetOptions();
      app.storage.saveOptions();
      alert("Your account has been reset");
      location.reload();
    }
  });

  $('#restore_wallet').off();
  $('#restore_wallet').on('click', function() {
    document.getElementById('file-input').addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        var contents = e.target.result;
        tmpoptions = JSON.parse(contents);
        if (tmpoptions.wallet.publickey != null) {
          app.options = JSON.parse(contents);
          app.storage.saveOptions();
          alert("Wallet Import Successful");
        } else {
          alert("This does not seem to be a valid wallet file");
        }
      };
      reader.readAsText(file);
    }, false);
    $('#file-input').trigger('click');
  });

  $('#backup_wallet').off();
  $('#backup_wallet').on('click', function() {
    var content = JSON.stringify(app.options);
    var pom = document.createElement('a');
    pom.setAttribute('type', "hidden");
    pom.setAttribute('href', 'data:application/json;utf-8,' + encodeURIComponent(content));
    pom.setAttribute('download', "saito.wallet.json");
    document.body.appendChild(pom);
    pom.click();
    pom.remove();
  });

  $('#disable_ads').off();
  $('#disable_ads').on('click', function() {
    if (app.options.display_adverts == 1) {
      $('.advert-300-250').hide();
      $(this).html("Enable Ads");
      app.options.display_adverts = 0;
      app.storage.saveOptions();
    } else {
      $('.advert-300-250').show();
      $(this).html("Disable Ads");
      app.options.display_adverts = 1;
      app.storage.saveOptions();
    }
  });

  $('#register_address').off();
  $('#register_address').on('click', function() {
    if (app.wallet.returnBalance() > 0) {
      let c = confirm("We are taking you to the Address Registration Module");
      if (c) { location.href = "/register"; }
    } else {
      let c = confirm("You need SAITO tokens to register an address. Click OK to visit our free token faucet!");
      if (c) { location.href = "/faucet?saito_app=welcome"; }
    }
  });

};



Welcome.prototype.onNewBlock  = function onNewBlock(blk) {
  if (blk.app.BROWSER == 0) { return; }
  this.updateControlPanel(blk.app, blk);
}




Welcome.prototype.updateControlPanel = function updateControlPanel(app, blk=null) {

  let saito_blocktime    = "";
  let saito_difficulty   = "";
  let saito_paysplit     = "";
  let saito_latest_block = "";

  let saito_email        = "";
  let saito_address      = "";
  let saito_balance      = "";
  let saito_fee          = "";

  if (blk == null) { 

    saito_blocktime = "29 seconds";
    saito_difficulty = 0.0;
    saito_paysplit = 0.0;
    saito_latest_block = app.blockchain.last_bid;

  } else {

    saito_blocktime = blk.block.ts;
    saito_difficulty = blk.block.difficulty;
    saito_paysplit = blk.block.paysplit;
    saito_latest_block = blk.block.id;

  }

  saito_email   = app.wallet.returnIdentifier();
  saito_address = app.wallet.returnPublicKey();
  saito_balance = app.wallet.returnBalance();
  saito_fee     = app.wallet.returnDefaultFee();;

  if (saito_email == "") {
    saito_email = '<div class="register_address" id="register_address">[register address]</div>';
  }

  $('#saito_blocktime').html(saito_blocktime);
  $('#saito_difficulty').html(saito_difficulty);
  $('#saito_paysplit').html(saito_paysplit);
  $('#saito_latest_block').html(saito_latest_block);

  $('#saito_email').html(saito_email);
  $('#saito_address').html(saito_address);
  $('#saito_balance').html(saito_balance);
  $('#saito_fee').html(saito_fee);

}


