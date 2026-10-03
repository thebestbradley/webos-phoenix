// Phoenix compat: the print dialog's print quality picker.
//
// Enyo 1.0 as Palm released it ships lib/printdialog/source/
// PrintQualityPicker.js empty, while PrinterOptions creates a
// "PrintQualityPicker" for the Print Quality row (and reads its items in
// create), so opening a printer's options failed on the unknown kind.
// PrinterOptions hands it the printer's whole capabilities
// (qualityPicker.setItems(caps)); the qualities are caps.printQuality
// (Draft, Normal, Best, the values PrintDialog documents), shown with the
// dialog's own strings, Normal chosen when the printer has it.

/*global enyo, PrintDialogString */
enyo.kind({
	name: "PrintQualityPicker",
	kind: enyo.ListSelector,
	label: "",

	itemsChanged: function() {
		var strings = {
			Draft: PrintDialogString.load("DRAFT"),
			Normal: PrintDialogString.load("NORMAL"),
			Best: PrintDialogString.load("BEST")
		};
		var caps = this.items || {};
		var qualities = enyo.isArray(caps) ? caps : (caps.printQuality || []);
		this.items = [];
		for (var i = 0; i < qualities.length; i++) {
			if (strings[qualities[i]]) {
				this.items.push({caption: strings[qualities[i]], value: qualities[i]});
			}
		}
		this.inherited(arguments);
		if (this.items.length > 0) {
			this.setValue(qualities.indexOf("Normal") >= 0 ? "Normal" : this.items[0].value);
		}
	}
});
