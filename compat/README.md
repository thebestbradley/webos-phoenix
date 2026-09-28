# compat

`rootfs/` is laid out like a webOS device filesystem and is layered over
everything else in `runtime/rootfs.json`: a file at
`compat/rootfs/usr/palm/applications/com.palm.app.contacts/app/Ringtones.js`
replaces (or supplies) that path for the simulator and the browser dev
server. Use it for fixes and missing files in the original Open webOS apps,
so the `third_party/` submodules stay unmodified. Say at the top of each file
what it fixes and why.
