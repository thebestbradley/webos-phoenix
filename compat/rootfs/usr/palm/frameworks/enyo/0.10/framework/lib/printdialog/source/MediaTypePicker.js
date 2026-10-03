// Phoenix compat: the print dialog's paper type picker.
//
// Enyo 1.0 as Palm released it ships lib/printdialog/source/
// MediaTypePicker.js empty, while PrinterOptions creates a
// "MediaTypePicker" for the Paper Type row, so opening a printer's options
// failed on the unknown kind. This is the picker written after its sibling
// MediaSizePicker.js: a ListSelector of the paper types the printer reports
// (printers/getCapabilities mediaType: Plain, Special, Photo), with the
// dialog's own strings, Plain first.

/*global enyo, PrintDialogString */
enyo.kind({
	name: "MediaTypePicker",
	kind: enyo.ListSelector,
	label: "",

	itemsChanged: function() {
		var strings = {
			Plain: PrintDialogString.load("PLAIN"),
			Photo: PrintDialogString.load("PHOTO"),
			Transparency: PrintDialogString.load("TRANSPARENCY")
		};
		var types = this.items || [];
		this.items = [];
		for (var i = 0; i < types.length; i++) {
			if (strings[types[i]]) {
				this.items.push({caption: strings[types[i]], value: types[i]});
			}
		}
		this.inherited(arguments);
		if (this.items.length > 0) {
			this.setValue(this.items[0].value);
		}
	}
});
