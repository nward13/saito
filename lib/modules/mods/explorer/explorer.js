var saito       = require('../../../saito');
var ModTemplate = require('../../template');
var util        = require('util');
var fs          = require('fs');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Explorer(app) {

  if (!(this instanceof Explorer)) { return new Explorer(app); }
  Explorer.super_.call(this);

  this.app             = app;
  this.name            = "Explorer";

  return this;

}
module.exports = Explorer;
util.inherits(Explorer, ModTemplate);










////////////////////
// Install Module //
////////////////////
Explorer.prototype.installModule = async function installModule() {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  var explorer_self = this;

  try {
    var sqlite = require('sqlite');
    this.db = await sqlite.open('./data/vip.sq3');
    var sql = "CREATE TABLE IF NOT EXISTS mod_vip (id INTEGER, address TEXT, amt TEXT, bid INTEGER, tid INTEGER, sid INTEGER, bhash TEXT, lc INTEGER, rebroadcast INTEGER, PRIMARY KEY (id ASC))";
console.log("SQL: " + sql);
    let res = await this.db.run(sql, {});
  } catch (err) {}

}
Explorer.prototype.initialize = async function initialize() {

  if (this.app.BROWSER == 1 || this.app.SPVMODE == 1) { return; }

  if (this.db == null) {
    try {
      var sqlite = require('sqlite');
      this.db = await sqlite.open('./data/vip.sq3');
    } catch (err) {}
  }

}



Explorer.prototype.onChainReorganization = async function onChainReorganization(block_id, block_hash, lc) {
  var explorer_self = this;
  if (explorer_self.app.BROWSER == 1 || explorer_self.app.SPVMODE == 1) { return; }
  var sql    = "UPDATE mod_vip SET lc = $lc WHERE bhash = $bhash";
  var params = { $lc : lc , $bhash : block_hash }
  try {
    let res = await explorer_self.db.run(sql, params);
  } catch (err) {}
}





Explorer.prototype.onNewBlock = async function onNewBlock(blk, lc) {

  try {

    var explorer_self = blk.app.modules.returnModule("Explorer");

    if (explorer_self.app.BROWSER == 1 || explorer_self.app.SPVMODE == 1) { return; }

    for (let i = 0; i < blk.transactions.length; i++) {
      if (blk.transactions[i].transaction.type >= 3) {
        for (let ii = 0; ii < blk.transactions[i].transaction.to.length; ii++) {
          if (blk.transactions[i].transaction.to[ii].type == 4) {
            let sql = "INSERT INTO mod_vip (address, amt, bid, tid, sid, bhash, lc, rebroadcast) VALUES ($address, $amt, $bid, $tid, $sid, $bhash, $lc, $rebroadcast)";    
            let params = {
              $address : blk.transactions[i].transaction.to[ii].add,
              $amt : blk.transactions[i].transaction.to[ii].amt,
              $bid : blk.block.id,
              $tid : blk.transactions[i].transaction.id,
              $sid : ii,
              $bhash : blk.returnHash(),
              $lc : lc,
              $rebroadcast : 0
            }
	    let rows = await this.db.run(sql, params);
	  }
        }
      }
    }
  
    return;
  } catch (err) {

  }
console.log("EXPLORER 5");

}













/////////////////////////
// Handle Web Requests //
/////////////////////////
Explorer.prototype.printVIP = async function printVIP(res) {

  var html_table = '<html><body>VIP Transaction Table<p></p>';
      html_table +=`<table>
		      <tr>
			<th>address</th>
			<th>amount</th>
			<th>id</th>
			<th>hash</th>
			<th>longest?</th>
		      </tr>
		   `;

  let sql    = "SELECT * FROM mod_vip WHERE bid >= $bid";
  let params = { $bid : this.app.blockchain.genesis_bid };
  let rows = await this.db.all(sql, params);

  for (let i = 0; i < rows.length; i++) {

    let row = rows[i];

    var db_id    = row.id;
    var bid = row.bid;
    var tid = row.tid;
    var sid = row.sid;
    var bhash = row.bhash;
    var rebroadcast = row.rebroadcast;
    var lc = row.lc;
    var address = row.address;
    var amt = row.amt;

    html_table += `<tr><td>${address}</td><td>${amt}</td><td>${bid}/${tid}/${sid}</td><td>${bhash}</td><td>${lc}</td></tr>`;

  }

  html_table += '</table></body><html>';

  res.setHeader('Content-type', 'text/html');
  res.charset = 'UTF-8';
  res.write(html_table);
  res.end();
  return;

}
Explorer.prototype.webServer = function webServer(app, expressapp) {

  var explorer_self = this;

  ///////////////////
  // web resources //
  ///////////////////
  expressapp.get('/explorer/', function (req, res) {
    //rewrite indexHTML page
    fs.writeFileSync((__dirname + "/web/index.html"), explorer_self.returnIndexHTML(app), function(err) {
      if (err) {
        return console.log(err);
      }
    });
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/explorer/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
  expressapp.get('/explorer/vip', function (req, res) {
    explorer_self.printVIP(res);
  });
  expressapp.get('/explorer/block', function (req, res) {

    hash = req.query.hash;

    if (hash == null) {

      res.setHeader('Content-type', 'text/html');
      res.charset = 'UTF-8';
      res.write("NO BLOCK FOUND1: ");
      res.end();
      return;

    } else {

      if (hash != null) {

        let blk = explorer_self.app.storage.loadSingleBlockFromDiskWithCallback(hash, function (blk) {
	  if (blk == null) {
            res.setHeader('Content-type', 'text/html');
            res.charset = 'UTF-8';
            res.write("NO BLOCK FOUND1: ");
            res.end();
            return;
	  } else {
            res.setHeader('Content-type', 'text/html');
            res.charset = 'UTF-8';
            res.write(explorer_self.returnBlockHTML(app, blk));
            res.end();
            return;
	  }
        });
      }
    }
  });
  expressapp.get('/explorer/transaction', function (req, res) {

    tid = req.query.tid;
    hash = req.query.bhash;
    if (tid == null && hash == null) {

      res.setHeader('Content-type', 'text/html');
      res.charset = 'UTF-8';
      res.write("NO TRANSACTION FOUND: ");
      res.end();
      return;

    } else {
   
      sql    = "SELECT * FROM blocks WHERE $id1 >= min_tx_id AND $id2 <= max_tx_id AND longest_chain = 1";
      params = { $id1 : tid , $id2 : tid }; 

      if (hash != null && tid != null) {
        sql    = "SELECT * FROM blocks WHERE hash = $hash AND $id1 >= min_tx_id AND $id2 <= max_tx_id";
        params = { $hash : hash , $id1 : tid , $id2 : tid }; 
      }
      app.storage.queryDatabase(sql, params, function(err, row) {

  	if (row == null) {

          res.setHeader('Content-type', 'text/html');
          res.charset = 'UTF-8';
          res.write("NO TRANSACTION FOUND: ");
          res.end();
          return;

	} else {

	  var db_id    = row.id;
	  var block_id = row.block_id;
	  var bhash    = row.hash;

          let blk = explorer_self.app.storage.loadSingleBlockFromDiskWithCallback(bhash, function (blk) {
            if (blk == null) {
              res.setHeader('Content-type', 'text/html');
              res.charset = 'UTF-8';
              res.write("NO BLOCK FOUND1: ");
              res.end();
              return;
            } else {
              res.setHeader('Content-type', 'text/html');
              res.charset = 'UTF-8';
              res.write(explorer_self.returnTransactionHTML(blk, tid));
              res.end();
              return;
            }
	  });
        }
      });
    }
  });

}






/////////////////////
// Main Index Page //
/////////////////////
Explorer.prototype.returnIndexHTML = function returnIndexHTML(app) {

return '<html> \
<head> \
  <meta charset="utf-8"> \
  <meta http-equiv="X-UA-Compatible" content="IE=edge"> \
  <meta name="viewport" content="width=device-width, initial-scale=1"> \
  <meta name="description" content=""> \
  <meta name="author" content=""> \
  <title>Saito Network: Blockchain Explorer</title> \
  <link rel="stylesheet" type="text/css" href="/explorer/style.css" /> \
</head> \
<body> \
\
    <div class="header"> \
      <a href="/" style="text-decoration:none;color:inherits"> \
        <img src="/img/saito_logo_black.png" style="width:35px;margin-top:5px;margin-left:25px;margin-right:10px;float:left;" /> \
        <div style="font-family:Georgia;padding-top:0px;font-size:1.2em;color:#444;">saito</div> \
      </a> \
    </div> \
\
    <div class="main"> \
      Server Address: '+this.app.wallet.returnPublicKey()+' \
      <br /> \
      Balance: '+this.app.wallet.returnBalance()+ ' \
      <p></p> \
      Search for Block (by hash): \
      <p></p> \
      <form method="get" action="/explorer/block"><input type="text" name="hash" class="hash_search_input" /><br /><input type="submit" class="hash_search_submit" value="search" /></form> \
      <p></p> \
      <u>Recent Blocks:</u> \
      <p></p> \
      '+this.listBlocks()+' \
    </div> \
\
</body> \
</html>';

}
Explorer.prototype.listBlocks = function listBlocks() {

  var explorer_self = this;

  var html  = '<table class="blockchain_table">';
  html += '<tr><th></th><th>id</th><th>block hash</th><th>previous block</th></tr>';
  for (var mb = explorer_self.app.blockchain.blocks.length-1; mb >= 0 && mb > explorer_self.app.blockchain.blocks.length-200; mb--) {
    html += '<tr>';
    var longestchainhash = explorer_self.app.blockchain.index.hash[explorer_self.app.blockchain.lc];
    if (longestchainhash == explorer_self.app.blockchain.blocks[mb].returnHash()) {
      html += '<td>*</td><td><a href="/explorer/block?hash='+explorer_self.app.blockchain.blocks[mb].returnHash('hex')+'">'+explorer_self.app.blockchain.blocks[mb].block.id+'</a></td><td><a href="/explorer/block?hash='+explorer_self.app.blockchain.blocks[mb].returnHash('hex')+'">'+explorer_self.app.blockchain.blocks[mb].returnHash()+'</a></td><td>'+explorer_self.app.blockchain.blocks[mb].block.prevhash.substring(0,25)+'...</td>';
    } else {
      html += '<td></td><td><a href="/explorer/block?hash='+explorer_self.app.blockchain.blocks[mb].returnHash('hex')+'">'+explorer_self.app.blockchain.blocks[mb].block.id+'</td><td><a href="/explorer/block?bid='+explorer_self.app.blockchain.blocks[mb].block.id+'">'+explorer_self.app.blockchain.blocks[mb].returnHash()+'</a></td><td>'+explorer_self.app.blockchain.blocks[mb].block.prevhash.substring(0,25)+'...</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}


////////////////////////
// Single Block Page  //
////////////////////////
Explorer.prototype.returnBlockHTML = function returnBlockHTML(app, blk) { 

returnHTML = '<html> \
<head> \
  <meta charset="utf-8"> \
  <meta http-equiv="X-UA-Compatible" content="IE=edge"> \
  <meta name="viewport" content="width=device-width, initial-scale=1"> \
  <meta name="description" content=""> \
  <meta name="author" content=""> \
  <title>Saito Network: Blockchain Explorer: Block</title> \
  <link rel="stylesheet" type="text/css" href="/explorer/style.css" /> \
</head> \
<body> \
\
    <div class="header"> \
      <a href="/" style="text-decoration:none;color:inherits"> \
        <img src="/img/saito_logo_black.png" style="width:35px;margin-top:5px;margin-left:25px;margin-right:10px;float:left;" /> \
        <div style="font-family:Georgia;padding-top:0px;font-size:1.2em;color:#444;">saito</div> \
      </a> \
    </div> \
\
    <div class="main"> \
	<b>Block Explorer:</b> \
	<p></p> \
      '+this.listTransactions(blk)+' \
    </div> \
\
</body> \
</html>';

  return returnHTML;

}
Explorer.prototype.listTransactions = function listTransactions(blk) {

  var explorer_self = this;

  var html  = '<table class="block_table">';
  html += '<tr><td>id</td><td>'+blk.block.id+'</td></tr>';
  html += '<tr><td>hash</td><td>'+blk.returnHash('hex')+'</td></tr>';
  //html += '<tr><td>unixtime</td><td>'+blk.block.unixtime+'</td></tr>';
  //html += '<tr><td>previous block</td><td><a href="/explorer/block?bid='+blk.block.id+'">'+blk.block.prevhash+'</a></td></tr>';
  //html += '<tr><td>creator</td><td><a href="/explorer/address?add='+blk.block.miner+'">'+blk.block.miner+'</a></td></tr>';
  //html += '<tr><td>burn fee</td><td>'+blk.block.burn_fee+'</td></tr>';
  //html += '<tr><td>fee step</td><td>'+blk.block.fee_step+'</td></tr>';
  //html += '<tr><td>difficulty</td><td>'+blk.block.difficulty+'</td></tr>';
  //html += '<tr><td>treasury</td><td>'+blk.block.treasury+'</td></tr>';
  //html += '<tr><td>coinbase</td><td>'+blk.block.coinbase+'</td></tr>';
  html += '</table>';

  if (blk.block.txsjson.length > 0) {

    html += '<p></p>';

    html += '<b>Bundled Transactions:</b>';
    html += '<p></p>';

    html += '<table class="block_transactions_table">';
    html += '<tr>';
    html += '<th>id</th>';
    html += '<th>sender</th>';
    html += '<th>fee</th>';
    html += '<th>type</th>';
    html += '</tr>';

    for (var mt = 0; mt < blk.transactions.length; mt++) {
      var tmptx = blk.transactions[mt];

      html += '<tr>';
      html += '<td><a href="/explorer/transaction?bhash='+blk.returnHash()+'&tid='+tmptx.transaction.id+'">'+tmptx.transaction.id+'</a></td>';
      html += '<td><a href="/explorer/transaction?bhash='+blk.returnHash()+'&tid='+tmptx.transaction.id+'">'+tmptx.transaction.from[0].add+'</a></td>';
      html += '<td>'+tmptx.returnFeesTotal(blk.app)+'</td>';
      html += '<td>'+tmptx.transaction.type+'</td>';
      html += '</tr>';
    }
    html += '</table>';
  }
  return html;
}




//////////////////////////////
// Single Transaction Page  //
//////////////////////////////
Explorer.prototype.returnTransactionHTML = function returnTransactionHTML(blk, txid) {
 
  var tmptx;

  for (var x = 0; x < blk.transactions.length; x++) {
    if (blk.transactions[x].transaction.id == txid) {
      tmptx = blk.transactions[x];
    }
  }

returnHTML = '<html> \
<head> \
  <meta charset="utf-8"> \
  <meta http-equiv="X-UA-Compatible" content="IE=edge"> \
  <meta name="viewport" content="width=device-width, initial-scale=1"> \
  <meta name="description" content=""> \
  <meta name="author" content=""> \
  <title>Saito Network: Blockchain Explorer: Transaction</title> \
  <link rel="stylesheet" type="text/css" href="/explorer/style.css" /> \
</head> \
<body> \
\
    <div class="header"> \
      <a href="/" style="text-decoration:none;color:inherits"> \
        <img src="/img/saito_logo_black.png" style="width:35px;margin-top:5px;margin-left:25px;margin-right:10px;float:left;" /> \
        <div style="font-family:Georgia;padding-top:0px;font-size:1.2em;color:#444;">saito</div> \
      </a> \
    </div> \
\
    <div class="main"> \
	<b>Transaction Explorer:</b> \
	<p></p><pre> \
      '+JSON.stringify(tmptx, null, 4)+ ' \
    </pre></div> \
\
</body> \
</html>';

  return returnHTML;

}







