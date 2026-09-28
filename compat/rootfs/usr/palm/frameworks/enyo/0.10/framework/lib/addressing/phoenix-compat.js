// Phoenix compat: AddressingPopup before its popup has opened.
//
// The address list of an AddressingPopup (Email's To/Cc/Bcc fields) lives
// in a lazily created popup: this.$.list exists only after the popup first
// opens. In current Chromium the field's contenteditable sends an input
// event with an empty value when it is focused, which reaches
// inputFilterCleared (this.$.list.cancelSearch()), and atomizing a typed
// address asks inputGetContact (this.$.list.getSelected()) - both throw
// while the list does not exist. Before the popup exists there is no
// search to cancel and nothing selected, so treat it that way.

/*global enyo */
(function () {
	var popup = enyo.AddressingPopup && enyo.AddressingPopup.prototype;
	if (!popup) {
		return;
	}
	var filterCleared = popup.inputFilterCleared, getContact = popup.inputGetContact;
	popup.inputFilterCleared = function () {
		if (!this.$.list) {
			this.$.popup.close();
			return;
		}
		return filterCleared.apply(this, arguments);
	};
	popup.inputGetContact = function () {
		return this.$.list ? getContact.apply(this, arguments) : null;
	};
})();
