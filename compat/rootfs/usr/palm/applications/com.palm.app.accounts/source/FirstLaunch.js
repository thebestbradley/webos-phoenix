// Phoenix compat: stand-in for source/FirstLaunch.js.
//
// depends.js lists this file but it is missing from the Open webOS release
// of the Accounts app, so Enyo logs "Error loading script" at startup.
// Nothing in the app refers to what it defined (the app's first-launch
// flow lives in the Enyo accounts library, $enyo-lib/accounts/
// entry-first-launch.js), so an empty file is enough.
