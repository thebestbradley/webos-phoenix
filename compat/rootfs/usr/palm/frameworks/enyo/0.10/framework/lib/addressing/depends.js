// Phoenix compat overlay: the Enyo addressing library's original depends.js
// plus phoenix-compat.js, which guards two AddressingPopup handlers that
// can run before the popup's list exists, and css/phoenix-compat.css, which
// keeps address atoms as wide as their text. Nothing else is changed.
enyo.depends(
	"$enyo/g11n/name/",
	"$enyo/g11n/phone/",
	"utils.js",
	"labels.js",
	"AccountsService.js",
	"GalService.js",
	"ReverseLookupService.js",
	"css/AddressingList.css",
	"AddressingList.js",
	"ContactAtom.js",
	"css/AtomizingInput.css",
	"AtomizingInput.js",
	"AddressListPopup.js",
	"css/AddressingPopup.css",
	"AddressingPopup.js",
	"phoenix-compat.js",
	"css/phoenix-compat.css"
);
