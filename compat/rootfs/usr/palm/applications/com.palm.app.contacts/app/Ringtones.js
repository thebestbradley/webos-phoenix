// Phoenix compat: stand-in for app/Ringtones.js.
//
// depends.js lists this file but it is missing from the Open webOS release
// of Contacts, so Enyo logs "Error loading script" at startup. It held the
// TouchPad-era ringtone picker view; nothing in the released app creates
// that view (ContactsApp's pane has no "ringtones" view and no control is
// wired to Edit.ringtoneClick), so an empty file is enough.
