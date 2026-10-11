// Sample content shared by every screen (same in both directions, so the
// renders compare like for like). Names and messages are invented.
window.PHX_DATA = {
  // Synergy accounts: one person, several services.
  accounts: {
    sms: { name: "SMS", detail: "Mobile · +1 (303) 555-0135" },
    jabber: { name: "Jabber", detail: "lena.okafor@jabber.example" },
  },
  conversations: [
    { name: "Lena Okafor", initials: "LO", hue: 162, time: "9:41 AM", preview: "Pushed the card-stacking fix. Can you try it on the TouchPad?", unread: 2, via: "sms", presence: "on" },
    { name: "Marcus Reyes", initials: "MR", hue: 28, time: "9:12 AM", preview: "Tacos Thursday? I'm buying this time.", unread: 0, via: "sms" },
    { name: "Card Sharks", initials: "CS", hue: 262, time: "8:47 AM", preview: "Priya: the Pre 3 still boots. Unbelievable.", unread: 1, via: "jabber", group: true },
    { name: "Ada Palmer", initials: "AP", hue: 330, time: "Yesterday", preview: "Photo · Lily pads at the botanic garden", unread: 0, via: "jabber", presence: "away" },
    { name: "Tomás Herrera", initials: "TH", hue: 205, time: "Yesterday", preview: "Thanks for the charger, I owe you one.", unread: 0, via: "sms" },
    { name: "Priya Raman", initials: "PR", hue: 290, time: "Fri", preview: "See you at the meetup. I'll bring the TouchPad.", unread: 0, via: "jabber", presence: "on" },
    { name: "Jun Watanabe", initials: "JW", hue: 48, time: "Thu", preview: "Found a boxed Pre 3 at the flea market!", unread: 0, via: "sms" },
    { name: "Mom", initials: "M", hue: 0, time: "Wed", preview: "Call me when you land. Love you.", unread: 0, via: "sms" },
    { name: "Hana Kim", initials: "HK", hue: 190, time: "Tue", preview: "Chapter 12 is wild. No spoilers on Saturday!", unread: 0, via: "jabber", presence: "on" },
  ],
  // The open conversation with Lena: Jabber, then SMS (Synergy merges both).
  thread: [
    { kind: "day", text: "Today" },
    { from: "in", via: "jabber", text: "Morning! Did the 2.0 fork land?", time: "9:02 AM" },
    { from: "out", via: "jabber", text: "Just now. Every built-in app gets rebuilt on the new UI layer.", time: "9:04 AM" },
    { from: "in", via: "jabber", text: "On the train, the Wi-Fi keeps dropping. Switching to text.", time: "9:05 AM" },
    { kind: "switch", via: "sms" },
    { from: "in", via: "sms", text: "Can you send me tonight's card-view build?", time: "9:31 AM" },
    { from: "out", via: "sms", text: "Sending it tonight. Swipe up still feels perfect.", time: "9:33 AM" },
    { from: "in", via: "sms", text: "Pushed the card-stacking fix. Can you try it on the TouchPad?", time: "9:41 AM" },
  ],
  mailFolders: [
    { group: "Favorites", items: [
      { name: "All Inboxes", icon: "inbox", count: 12, sel: true },
      { name: "All Flagged", icon: "flag", count: 3 },
    ]},
    { group: "Work", account: "work", addr: "jordan@northwind.dev", items: [
      { name: "Inbox", icon: "inbox", count: 8 },
      { name: "Drafts", icon: "doc", count: 1 },
      { name: "Sent", icon: "send" },
      { name: "Archive", icon: "archive" },
      { name: "Trash", icon: "trash" },
    ]},
    { group: "Personal", account: "home", addr: "jordan.lee@inbox.example", items: [
      { name: "Inbox", icon: "inbox", count: 4 },
      { name: "Sent", icon: "send" },
      { name: "Trash", icon: "trash" },
    ]},
  ],
  mails: [
    { from: "Lena Okafor", initials: "LO", hue: 162, acct: "work", time: "9:41 AM", subject: "Card view: stacking and throw-to-close notes", preview: "Attached the timing curves I pulled from luna-sysmgr. The throw feels right at 280 ms, but the stack needs…", unread: true, clip: true, sel: true },
    { from: "Build Robot", initials: "BR", hue: 220, acct: "work", time: "8:05 AM", subject: "Nightly image 2026.10.11 passed", preview: "412 tests, 0 failures. Fairphone 6 and TouchPad images are ready to flash.", unread: true },
    { from: "Marcus Reyes", initials: "MR", hue: 28, acct: "home", time: "7:58 AM", subject: "Re: Tacos Thursday?", preview: "Booked a table for four at 7. Bring Priya if she's around.", unread: true },
    { from: "Priya Raman", initials: "PR", hue: 290, acct: "work", time: "Yesterday", subject: "Design review moved to 3 PM", preview: "The room clashed with the all-hands. Same link, new time. Slides are in the shared folder.", flag: true },
    { from: "Phoenix Weekly", initials: "PW", hue: 12, acct: "home", time: "Yesterday", subject: "Issue 42: Just Type, rebuilt", preview: "This week: universal search learns your contacts, a new Synergy connector, and a look back at…" },
    { from: "Tomás Herrera", initials: "TH", hue: 205, acct: "home", time: "Fri", subject: "Photos from the meetup", preview: "Twenty-three pictures, mostly of people holding TouchPads up to the light.", clip: true },
    { from: "Jun Watanabe", initials: "JW", hue: 48, acct: "home", time: "Thu", subject: "Found a boxed Pre 3", preview: "Still sealed. Twelve dollars. I may have made a noise in the market." },
  ],
  // Calendar: week of Mon 12 to Sun 18 October 2026; today is Wed 14.
  week: { title: "October 2026", range: "12 – 18 Oct", days: ["Mon 12", "Tue 13", "Wed 14", "Thu 15", "Fri 16", "Sat 17", "Sun 18"], today: 2 },
  allDay: [
    { day: 5, span: 1, cal: "home", title: "Tomás's birthday" },
    { day: 0, span: 3, cal: "work", title: "Phoenix 2.0 sprint 1" },
  ],
  events: [
    { day: 0, start: 9.5, end: 10, cal: "work", title: "Stand-up" },
    { day: 0, start: 10.25, end: 11.75, cal: "work", title: "Sprint planning", where: "Room Pre" },
    { day: 0, start: 12.5, end: 13.5, cal: "home", title: "Lunch with Marcus", where: "Tacos Chukis" },
    { day: 1, start: 9.5, end: 10, cal: "work", title: "Stand-up" },
    { day: 1, start: 14, end: 15.5, cal: "work", title: "Design review: Phoenix UI", where: "Room Veer" },
    { day: 1, start: 18, end: 19.5, cal: "home", title: "Climbing", where: "Movement gym" },
    { day: 2, start: 11, end: 11.75, cal: "work", title: "1:1 Priya" },
    { day: 2, start: 13, end: 14, cal: "home", title: "Dentist", where: "Pearl St." },
    { day: 2, start: 16, end: 17, cal: "work", title: "Email rewrite sync" },
    { day: 3, start: 9.5, end: 10, cal: "work", title: "Stand-up" },
    { day: 3, start: 13, end: 16, cal: "work", title: "Focus: Calendar panes", where: "Do not book" },
    { day: 3, start: 17.5, end: 19, cal: "home", title: "webOS meetup", where: "Boulder library" },
    { day: 4, start: 9.5, end: 10, cal: "work", title: "Stand-up" },
    { day: 4, start: 11, end: 12, cal: "work", title: "Release triage" },
    { day: 4, start: 15, end: 16, cal: "home", title: "Pick up bike" },
    { day: 5, start: 9, end: 10.5, cal: "home", title: "Farmers market" },
    { day: 5, start: 14, end: 16, cal: "home", title: "Book club", where: "Ada's place" },
    { day: 6, start: 10, end: 11.5, cal: "home", title: "Run with Jun" },
  ],
  track: { title: "Northern Static", artist: "The Lumen Pilots", album: "Night Transit", pos: "1:42", left: "-2:16", frac: 0.43, next: "Glass Harbour", nextArtist: "The Lumen Pilots" },
};
