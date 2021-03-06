const fs          = require('fs');
const util        = require('util');
const path        = require('path');
const sqlite      = require('sqlite');
// const saito     = require('../../../saito');
const request     = require("request");
const ModTemplate = require('../../template');



//////////////////
// CONSTRUCTOR  //
//////////////////
function Registry(app) {

  if (!(this instanceof Registry)) { return new Registry(app); }

  Registry.super_.call(this);

  this.app             = app;

  // separate database
  this.db              = null;
  this.dir             = path.join(__dirname, "../../../data/registry.sq3");

  this.name            = "Registry";
  this.browser_active  = 0;
  this.handlesEmail    = 1;
  this.handlesDNS      = 1;
  this.emailAppName    = "Register Address";

  this.longest_chain_hash = "";
  this.longest_chain_bid  = 0;

  this.domain          = "saito";
  this.host            = "localhost"; // hardcoded
  this.port            = "12101";     // hardcoded
  // This value will change in production. Make sure in dev this value is set correctly
  // "nR2ecdN7cW91nxVaDR4uXqW35GbAdGU5abzPJ9PkE8Mn"
  // "226GV8Bz5rwNV7aNhrDybKhntsVFCtPrhd3pZ3Ayr9x33";

  //this.publickey = "28k9geGDqoEk4yHizQMoXTqMM48GzFwFAZHHFDFXqyDTe";
  // this.publickey = "24S25wxBmifBDxAVj4PgGjCNAea5BimouHvMkdMREebZb";
  this.publickey       = "226GV8Bz5rwNV7aNhrDybKhntsVFCtPrhd3pZ3Ayr9x33";
  //this.publickey       = "nR2ecdN7cW91nxVaDR4uXqW35GbAdGU5abzPJ9PkE8Mn";

  return this;

}
module.exports = Registry;
util.inherits(Registry, ModTemplate);


////////////////////
// Install Module //
////////////////////
Registry.prototype.installModule = async function installModule() {

  try {

  var registry_self = this;

  if (registry_self.app.BROWSER == 1 || registry_self.app.SPVMODE == 1) { return; }


  // we want to watch mailings FROM our key
  registry_self.app.keys.addKey(registry_self.publickey, "", "", 1, "");
  registry_self.db = await sqlite.open(this.dir);

  sql = "\
        CREATE TABLE IF NOT EXISTS mod_registry_addresses (\
                id INTEGER, \
                identifier TEXT, \
                publickey TEXT, \
                unixtime INTEGER, \
                block_id INTEGER, \
                lock_block INTEGER DEFAULT 0, \
                block_hash TEXT, \
                signature TEXT, \
                signer TEXT, \
                longest_chain INTEGER, \
                UNIQUE (identifier), \
                PRIMARY KEY(id ASC) \
        )";


  await registry_self.db.run(sql, {});

  this.insertSavedHandles();
    //
    // if we are not the main server but we are running
    // the registry module, we want to be able to track
    // DNS requests, which means running our own copy
    // of the database.
    //
  if (registry_self.app.wallet.returnPublicKey() != registry_self.publickey) {

      console.log("//");
      console.log("// FETCHING DNS INFORMATION");
      console.log("// ");

      //
      //
      var dns_master = "https://dns.saito.network";
      //
      // if (registry_self.app.options.dns != null) {
      //   for (let i = 0; i < registry_self.app.options.dns.length; i++) {
      //     if (registry_self.app.options.dns[i].domain == registry_self.domain) {
      //       if (registry_self.app.options.server != null) {
      //         if (registry_self.app.options.dns[i].host != registry_self.app.options.server.host) {
      //           var protocol = registry_self.app.options.dns[i].protocol;
      //           if (protocol == "") { protocol = "http"; }
      //           master_url = `${protocol}://${registry_self.app.options.dns[i].host}:${registry_self.app.options.dns[i].port}/registry/addresses.txt`;
      //           i = registry_self.app.options.dns.length+1;
      //         }
      //       }
      //     }
      //   }
      // }
      //
      //
      // fetch the latest DNS data from our server
      //
      // registry_self.app.logger.logInfo(`MASTER URL BEFORE REQUEST ${master_url}`)
      try {
        request.get(`${dns_master}/registry/addresses`, (error, response, body) => {
          //registry_self.app.logger.logInfo(`FETCH THE LATEST DNS DATA FROM SERVER: ${response}`)
          if (body != null && response.headers['content-type'] == 'application/json') {
            //var lines = body.split("\n");
            data = JSON.parse(body);
            for (var i = 0; i < data.length; i++) {
              this.addRecords(data[i]);
            }
          }
        });
      } catch (err) {
        console.log(err);
      }
  } else {
  }
  } catch (err) {
    console.log(err);
  }
}





////////////////
// Initialize //
////////////////
Registry.prototype.initialize = async function initialize() {

  if (this.app.BROWSER == 1) { return; }

  try {

  if (this.db == null) {
    this.db = await sqlite.open(this.dir);
  }

  } catch (err) {
    console.log(err);
  }
}


/////////////////////
// Initialize HTML //
/////////////////////
Registry.prototype.initializeHTML = async function initializeHTML() {

  if (this.app.BROWSER == 0) { return; }

  if (this.app.wallet.returnBalance() < 5) {

    let html = `<h1>HOLD ON, PARTNER...</h1>
                      <p></p>
                      It takes 5 SAITO to register an email address. (You have ${this.app.wallet.returnBalance()})
                      <p></p>
                      Please <a href="/faucet">visit our free token faucet</a> to get enough Saito.`;
    $('.main').html(html);

  }

}


/////////////////////////
// Handle Web Requests //
/////////////////////////
Registry.prototype.webServer = function webServer(app, expressapp) {

  var registry_self = this;

  expressapp.get('/registry/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/registry/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
  expressapp.get('/registry/addresses', async (req, res) => {
    let sql = "SELECT * from mod_registry_addresses WHERE longest_chain = 1";
    try {
      var rows = await registry_self.db.all(sql, {});
    } catch(err) {
      console.log(err);
    }

    if (rows != null) {
      res.setHeader('Content-Type', 'application/json');
      res.charset = 'UTF-8';
      res.write(JSON.stringify(rows));
      res.end();
    } else {
      res.status(404).send("Something went wrong");
    }
    return;
  });
  expressapp.get('/registry/confirm/:username', async function (req, res) {

    let username = req.params.username;


    let sql = "SELECT count(*) FROM mod_registry_addresses WHERE longest_chain = 1 AND identifier = $identifier";
    let params = { $identifier : username };
    let row = await registry_self.db.get(sql, params);
    if (row != null) {
      let rowcount = row.count;
      res.setHeader('Content-type', 'text/html');
      res.charset = 'UTF-8';
      if (row.count == 1) {
        res.write("1");
      } else {
        res.write("0");
      }
      res.end();
      return;
    } else {
      let rowcount = row.count;
      res.setHeader('Content-type', 'text/html');
      res.charset = 'UTF-8';
      res.write("0");
      res.end();
      return;
    }

  });

}






////////////////////////////////
// Email Client Interactivity //
////////////////////////////////
Registry.prototype.displayEmailForm = function displayEmailForm(app) {

  element_to_edit = $('#module_editable_space');

  var to_key = this.app.dns.returnPublicKey() || this.publickey

  $('#lightbox_compose_to_address').val(to_key);
  $('#lightbox_compose_payment').val(3);
  $('#lightbox_compose_fee').val(app.wallet.returnDefaultFee());
  $('.lightbox_compose_address_area').hide();
  $('.lightbox_compose_module').hide();
  $('#module_textinput').focus();

  element_to_edit_html = '<div id="module_instructions" class="module_instructions">Register a human-readable email address:<p></p><input type="text" class="module_textinput" id="module_textinput" value="" /><div class="module_textinput_details">@'+this.domain+'</div><p style="clear:both;margin-top:0px;"> </p>ASCII characters only, e.g.: yourname@'+this.domain+', etc. <p></p><div id="module_textinput_button" class="module_textinput_button" style="margin-left:0px;margin-right:0px;">register</div></div>';
  element_to_edit.html(element_to_edit_html);

  $('#module_textinput').off();
  $('#module_textinput').on('keypress', function(e) {
    if (e.which == 13 || e.keyCode == 13) {
      $('#module_textinput_button').click();
    }
  });

  $('#module_textinput_button').off();
  $('#module_textinput_button').on('click', function() {
    var identifier_to_check = $('.module_textinput').val();
    var regex=/^[0-9A-Za-z]+$/;
    if (regex.test(identifier_to_check)) {
      $('#send').click();
    } else {
      alert("Only Alphanumeric Characters Permitted");
    }
  });


}
/////////////////////
// Display Message //
/////////////////////
Registry.prototype.displayEmailMessage = function displayEmailMessage(message_id, app) {

  if (app.BROWSER == 1) {

    message_text_selector = "#" + message_id + " > .data";
    $('#lightbox_message_text').html( $(message_text_selector).html() );
    $('#lightbox_compose_to_address').val(registry_self.publickey);
    $('#lightbox_compose_payment').val(3);
    $('#lightbox_compose_fee').val(app.wallet.returnDefaultFee());

  }

}
////////////////////////
// Format Transaction //
////////////////////////
Registry.prototype.formatEmailTransaction = function formatEmailTransaction(tx, app) {
  tx.transaction.msg.module = this.name;
  tx.transaction.msg.requested_identifier  = $('#module_textinput').val().toLowerCase();
  return tx;
}









//////////////////
// Confirmation //
//////////////////
Registry.prototype.onConfirmation = async function onConfirmation(blk, tx, conf, app) {

  var registry_self = app.modules.returnModule("Registry");

  //////////////
  // BROWSERS //
  //////////////
  //
  // check if name registered
  //
  if (conf == 1) {
    if (app.BROWSER == 1) {
      if (tx.transaction.to[0].add == app.wallet.returnPublicKey()) {
        full_identifier = tx.transaction.msg.requested_identifier + "@" + app.modules.returnModule("Registry").domain;
        app.dns.fetchPublicKey(full_identifier, function(answer, publickey="") {
          if (answer == app.wallet.returnPublicKey()) {
            app.keys.addKey(app.wallet.returnPublicKey(), full_identifier, 0);
            app.keys.saveKeys();
            app.wallet.updateIdentifier(full_identifier);
          }
        });
      }
    }
  }
  if (app.BROWSER == 1) { return; }



  /////////////
  // SERVERS //
  /////////////
  //
  // register identifiers
  //
  if (conf == 0) {

    if (tx.transaction.msg != null) {

      var txmsg = tx.returnMessage();

      //
      // monitor confirmation from master server
      //
      if (txmsg.module == "Email") {

        if (tx.transaction.to[0].add != registry_self.publickey) { return; }
        // if (registry_self.publickey != app.wallet.returnPublicKey()) { return; }
        if (txmsg.sig == "") { return; }

        var sig = txmsg.sig;

        registry_self.addDomainRecord(txmsg.sig);
        return;

      }

      //
      // monitor registration requests
      //
      if (txmsg.module == "Registry") {
        registry_self.app.logger.logInfo(`Logging outcome of onConfirmation`)
        registry_self.app.logger.logInfo(`TRANSACTION TO ADD: ${tx.transaction.to[0].add}`)
        registry_self.app.logger.logInfo(`REGISTRY PUBKEY: ${registry_self.publickey}`)
        if (tx.transaction.to[0].add != registry_self.publickey) { return; }
        // if (registry_self.publickey != app.wallet.returnPublicKey()) { return; }
        if (tx.transaction.msg.requested_identifier == "") { return; }

        full_identifier = tx.transaction.msg.requested_identifier + "@" + app.modules.returnModule("Registry").domain;
        if (full_identifier.indexOf("'") > 0) { return; }
        full_identifier = full_identifier.replace(/\s/g, '');
        //registry_self.app.logger.logInfo(`IF YOU'RE PUBLIC, YOU SHOULD NOT GET HERE`)
        await registry_self.addDatabaseRecord(tx, blk, full_identifier);

      }
    }
  }
}










/////////////////////////
// Handle DNS Requests //
/////////////////////////
//
// this handles zero-free requests sent peer-to-peer across the Saito network
// from hosts to DNS providers.
//
Registry.prototype.handleDomainRequest = async function handleDomainRequest(app, message, peer, mycallback) {
  try {
    var registry_self = this;

    let identifier = message.data.identifier;
    let publickey  = message.data.publickey;

    var sql;
    var params;
    let dns_response            = {};
    dns_response.err            = "";
    dns_response.publickey      = "";
    dns_response.identifier     = "";

    var sql = identifier != null
      ? "SELECT * FROM mod_registry_addresses WHERE longest_chain = 1 AND identifier = $identifier"
      : "SELECT * FROM mod_registry_addresses WHERE publickey = $publickey";

    var params = identifier != null
      ? { $identifier : identifier }
      : { $publickey : publickey }

    let row = await registry_self.db.get(sql, params);
    if (row != null) {
      if (row.publickey != null) {
        dns_response.err        = "";
        dns_response.identifier = row.identifier;
        dns_response.publickey  = row.publickey;
        dns_response.unixtime   = row.unixtime;
        dns_response.block_id   = row.block_id;
        dns_response.block_hash = row.block_hash;
        dns_response.signer     = row.signer;
        dns_response.signature  = row.signature;
        mycallback(JSON.stringify(dns_response));
      }
    } else {
      dns_response.err = "identifier not found";
      mycallback(JSON.stringify(dns_response));
    }
  } catch (err) {}
}


Registry.prototype.onChainReorganization  = async function onChainReorganization(block_id, block_hash, lc) {

  try {

    var registry_self = this;

    //
    // browsers don't have a database tracking this stuff
    //
    if (registry_self.app.BROWSER == 1) { return; }

    if (lc == 0) {
      var sql    = "UPDATE mod_registry_addresses SET longest_chain = 0 WHERE block_id = $block_id AND block_hash = $block_hash";
      var params = { $block_id : block_id , $block_hash : block_hash }
      await registry_self.db.run(sql, params);
    }

    if (lc == 1) {
      var sql    = "UPDATE mod_registry_addresses SET longest_chain = 1 WHERE block_id = $block_id AND block_hash = $block_hash";
      var params = { $block_id : block_id , $block_hash : block_hash }
      await registry_self.db.run(sql, params);
    }

    if (lc == 1 && block_id == this.longest_chain_bid+1) {
      this.longest_chain_bid  = block_id;
      this.longest_chain_hash = block_hash;
    } else {
      var msg = "UPDATE" + "\t" + block_id + "\t" + block_hash + "\t" + lc + "\n";
      fs.appendFileSync((__dirname + "/web/addresses.txt"), msg, function(err) { if (err) { }; });
      if (lc == 1) {
        this.longest_chain_bid  = block_id;
        this.longest_chain_hash = block_hash;
      }
    }

  } catch (err) {}
}




//
// listen to EMAIL from our public server
//
Registry.prototype.shouldAffixCallbackToModule = function shouldAffixCallbackToModule(modname) {
  if (modname == this.name) { return 1; }
  if (modname == "Email") { return 1; }
  return 0;
}

/////////////////////
// addDomainRecord //
/////////////////////
//
// the master server does not run this, but child servers do
//
Registry.prototype.addRecords = async function addRecords(reg_addr) {
  try {
    var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, lock_block, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $lock_block, $block_hash, $sig, $signer, $longest_chain)";
    var params = {
      $identifier : reg_addr.identifier,
      $publickey : reg_addr.address,
      $unixtime : reg_addr.unixtime,
      $block_id : reg_addr.block_id,
      $lock_block : reg_addr.lock_block,
      $block_hash : reg_addr.block_hash,
      $sig : reg_addr.sig,
      $signer : reg_addr.signer,
      $longest_chain : 1
    }
    let row = this.db.run(sql, params);
    if (row != undefined) {
    }
  } catch(err) {
    console.log(err)
  }
}

/////////////////////
// addDomainRecord //
/////////////////////
//
// the master server does not run this, but child servers do
//
Registry.prototype.addDomainRecord = async function addDomainRecord(sigline) {

  try {

  if (this.app.BROWSER == 1) { return; }

  var registry_self = this;
  var write_to_file = sigline + "\n";
  var line = sigline.split("\t");

  if (line.length != 7) {

    if (line.length != 4) { return; }

    ////////////
    // UPDATE //
    ////////////
    var action     = line[0];
    var block_id   = line[1];
    var block_hash = line[2];
    var lc         = line[3];

    if (action == "UPDATE") {

      var sql    = "UPDATE mod_registry_addresses SET longest_chain = $lc WHERE block_id = $block_id AND block_hash = $block_hash";
      var params = { 
        $block_id : block_id,
        $block_hash : block_hash,
        $lc : lc
      }

      await registry_self.db.run(sql, params);
    }

  } else {

    ////////////
    // INSERT //
    ////////////
    var action     = line[0];
    var identifier = line[1];
    var block_id   = line[2];
    var block_hash = line[3];
    var address    = line[4];
    var unixtime   = line[5];
    var sig        = line[6];
    var signer     = line[7];

    if (signer != registry_self.publickey) {} else {

      if (action == "INSERT") {

        var msgtosign   = identifier + address + block_id + block_hash;
        var msgverifies = registry_self.app.crypto.verifyMessage(msgtosign, sig, signer);

        if (msgverifies == true) {
          var lock_block = block_id+(registry_self.app.blockchain.genesis_period + registry_self.app.blockchain.fork_guard);
          var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, lock_block, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $lock_block, $block_hash, $sig, $signer, $longest_chain)";
          var params = {
            $identifier : identifier,
            $publickey : address,
            $unixtime : unixtime,
            $block_id : block_id,
            $lock_block : lock_block,
            $block_hash : block_hash,
            $sig : sig,
            $signer : signer,
            $longest_chain : 1
          }
          fs.appendFileSync((__dirname + "/web/addresses.txt"), write_to_file, function(err) { if (err) { }; });

          await registry_self.db.run(sql, params);
        }
      }
    }
  }

  } catch (err) {}

}

Registry.prototype.insertSavedHandles = async function insertSavedHandles() {
  const keys = [
    {
      identifier: "dns@saito",
      publickey: "226GV8Bz5rwNV7aNhrDybKhntsVFCtPrhd3pZ3Ayr9x33",
    },
    {
      identifier: "apps@saito",
      publickey: "wtsVC6ktFGUoyq98NRKoMgLmwJdX6Vf9K52EEjdx1CWb",
    },
    {
      identifier: "bank@saito",
      publickey: "vvkqbFqboN3UQmyGUgrcWH8349XGnNpWqcCNRHFSp6G3",
    },
    {
      identifier: "archive@saito",
      publickey: "fwPHDCG1Z2RCP1LTm97mubfafdx72vcMun8FdfQNJ522",
    },
    {
      identifier: "forum@saito",
      publickey:"23qxgWumxDbAHAexYENkRzQGbXGBKcDNEDuRkFpqiJUMJ"
    }
  ];

  for (let i = 0; i < keys.length; i++) {
    var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $block_hash, $sig, $signer, $longest_chain)";
    var params = {
      $identifier:    keys[i].identifier,
      $publickey:     keys[i].publickey,
      $unixtime:      new Date().getTime(),
      $block_id:      0,
      $block_hash:    "",
      $sig:           this.app.crypto.signMessage(keys[i].identifier + keys[i].publickey + 0 + "", this.app.wallet.returnPrivateKey()),
      $signer:        this.app.wallet.returnPublicKey(),
      $longest_chain: 1
    };
    try {
      this.db.run(sql, params);
    } catch (err) {
      console.log(err);
    }
  }
}



///////////////////////
// addDatabaseRecord //
///////////////////////
//
// the master record does this ...
//
Registry.prototype.addDatabaseRecord = async function addDatabaseRecord(tx, blk, identifier) {

  try {

  var registry_self = this;
  var tmsql = "SELECT count(*) AS count FROM mod_registry_addresses WHERE identifier = $identifier";
  var params = { $identifier : identifier }

console.log(tmsql);

  let row = await registry_self.db.get(tmsql, params);
  if (row != null) {
    if (row.count == 0) {

      var msgtosign   = full_identifier + tx.transaction.from[0].add + blk.block.id + blk.returnHash();
      var registrysig = registry_self.app.crypto.signMessage(msgtosign, registry_self.app.wallet.returnPrivateKey());
      var sql = "INSERT OR IGNORE INTO mod_registry_addresses (identifier, publickey, unixtime, block_id, block_hash, signature, signer, longest_chain) VALUES ($identifier, $publickey, $unixtime, $block_id, $block_hash, $sig, $signer, $longest_chain)";
      var params = { $identifier : full_identifier, $publickey : tx.transaction.from[0].add, $unixtime : tx.transaction.ts , $block_id : blk.returnId(), $block_hash : blk.returnHash(), $sig : registrysig , $signer : registry_self.app.wallet.returnPublicKey(), $longest_chain : 1 };

      var sqlwrite = "INSERT" + "\t" + full_identifier + "\t" + blk.block.id + "\t" + blk.returnHash() + "\t" + tx.transaction.from[0].add + "\t" + tx.transaction.ts + "\t" + registrysig + "\t" + registry_self.app.wallet.returnPublicKey() + "\n";
      fs.appendFileSync((__dirname + "/web/addresses.txt"), sqlwrite, function(err) { if (err) { return console.log(err); } });

      registry_self.db.run(sql, params);

console.log("AM I THE SERVER REGISTERING THIS?");

      if (tx.transaction.to[0].add == registry_self.publickey && registry_self.publickey == registry_self.app.wallet.returnPublicKey()) {

console.log("YES I AM");

        var to = tx.transaction.from[0].add;
        var from = registry_self.app.wallet.returnPublicKey();
        var amount = 0.0;

        registry_self.app.logger.logInfo(`THIS IS WHERE THE TX IS BEING SENT TO: ${to}`)
        registry_self.app.logger.logInfo(`THIS IS WHERE THE TX IS BEING SENT FROM: ${from}`)

        server_email_html = 'You can now receive emails (and more!) at this address:<p></p>'+tx.transaction.msg.requested_identifier+'@'+registry_self.domain+'<p></p>To configure your browser to use this address, <div class="register_email_address_success" style="text-decoration:underline;cursor:pointer;display:inline;">please click here</div>.';

        newtx = registry_self.app.wallet.createUnsignedTransactionWithDefaultFee(to, amount);
        console.log(JSON.stringify(newtx));
        if (newtx == null) { return; }
        newtx.transaction.msg.module   = "Email";
        newtx.transaction.msg.data     = server_email_html;
        newtx.transaction.msg.title    = "Address Registration Success!";
        newtx.transaction.msg.sig      = sqlwrite;
        newtx.transaction.msg.markdown = 0;
        newtx = registry_self.app.wallet.signTransaction(newtx);
        registry_self.app.mempool.addTransaction(newtx);
      }
    } else {

      if (registry_self.publickey == registry_self.app.wallet.returnPublicKey()) {

        // identifier already registered
        to = tx.transaction.from[0].add;
        from = registry_self.app.wallet.returnPublicKey();
        amount = 0;

        server_email_html = full_identifier + ' is already registered';

        newtx = registry_self.app.wallet.createUnsignedTransactionWithDefaultFee(to, amount);
        if (newtx == null) { return; }
        newtx.transaction.msg.module = "Email";
        newtx.transaction.msg.data   = server_email_html;
        newtx.transaction.msg.title  = "Address Registration Failure!";
        newtx = registry_self.app.wallet.signTransaction(newtx);
        registry_self.app.mempool.addTransaction(newtx);

      }
    }
  };


  } catch (err) {
    console.log(err);
  }
}





