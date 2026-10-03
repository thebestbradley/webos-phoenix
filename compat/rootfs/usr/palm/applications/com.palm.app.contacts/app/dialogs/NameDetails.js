// Phoenix compat: stand-in for app/dialogs/NameDetails.js.
//
// depends.js lists this file but it is missing from the Open webOS release
// of Contacts, so Enyo logs "Error loading script" at startup. The released
// Edit view shows the name details (prefix, first, middle, last, suffix)
// inline (Edit.openNameDetails/closeNameDetails) and never creates a
// NameDetails dialog, so an empty file is enough.
