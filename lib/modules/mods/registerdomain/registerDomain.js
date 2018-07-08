function RegisterDomain(app) {

  if (!(this instanceof Registry)) { return new Registry(app); }

  Registry.super_.call(this);

  this.app             = app;

  // separate database
  this.db              = null;

  this.name            = "RegisterDomain";
  this.browser_active  = 0;
  this.handlesEmail    = 1;
  this.handlesDNS      = 1;
  this.emailAppName    = "Register Address";

  this.domain          = "saito";
  this.host            = "localhost"; // hardcoded
  this.port            = "12101";     // hardcoded

  this.publickey       = "226GV8Bz5rwNV7aNhrDybKhntsVFCtPrhd3pZ3Ayr9x33";

  return this;
}

module.exports = RegisterDomain;
util.inherits(RegisterDomain, ModTemplate);


////////////////////////////////
// Email Client Interactivity //
////////////////////////////////
RegisterDomain.prototype.displayEmailForm = function displayEmailForm(app) {

  element_to_edit = $('#module_editable_space');

  $('#lightbox_compose_to_address').val(this.publickey);
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