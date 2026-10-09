// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Places near the device for "coffee near me", "directions to the nearest
// pharmacy" and "how do I get to Starbucks": the closest first, as Maps
// finds them (apps/maps/src/lib/nearby.ts, whose table of kinds this
// repeats; apps/maps/src/lib/maps.test.ts checks that the two agree).
//
// A kind of place ("coffee shops") is asked of Photon by its OpenStreetMap
// tag inside a box around the device (include=osm.amenity.cafe&bbox=...),
// growing until enough are found; a name ("Starbucks", "the airport", "1
// Infinite Loop") as words, inside the same boxes, then anywhere (nearest
// first by Photon's location bias). A free-text "coffee shops" anywhere is
// what showed the owner a Peet's in Berkeley from downtown San Jose.

"use strict";

var CATEGORIES = [
    { id: "cafe", label: "coffee shops", tags: ["amenity.cafe"],
      words: /^(?:coffee|coffees|coffee ?shops?|coffee ?houses?|cafes?|cafés?|espresso(?: bars?)?|coffee places?|places? (?:to|for|with) (?:get )?coffee)$/ },
    { id: "restaurant", label: "restaurants", tags: ["amenity.restaurant", "amenity.fast_food"],
      words: /^(?:restaurants?|food|places? to eat|something to eat|somewhere to eat|(?:a )?bite to eat|dinner|lunch|breakfast|brunch|diners?)$/ },
    { id: "fast_food", label: "fast food", tags: ["amenity.fast_food"], words: /^(?:fast ?food|burgers?|burger (?:places?|joints?))$/ },
    { id: "pharmacy", label: "pharmacies", tags: ["amenity.pharmacy", "shop.chemist"], words: /^(?:pharmac(?:y|ies)|drug ?stores?|drugstores?|chemists?)$/ },
    { id: "fuel", label: "gas stations", tags: ["amenity.fuel"],
      words: /^(?:gas|gas stations?|petrol(?: stations?)?|fuel(?: stations?)?|filling stations?|service stations?)$/ },
    { id: "charging", label: "EV chargers", tags: ["amenity.charging_station"], words: /^(?:(?:ev |electric car |car )?charg(?:ers?|ing stations?|ing points?))$/ },
    { id: "atm", label: "ATMs", tags: ["amenity.atm"], words: /^(?:atms?|cash ?machines?|cashpoints?)$/ },
    { id: "bank", label: "banks", tags: ["amenity.bank"], words: /^banks?$/ },
    { id: "hospital", label: "hospitals", tags: ["amenity.hospital"], words: /^(?:hospitals?|emergency rooms?|e\.?r\.?)$/ },
    { id: "bar", label: "bars", tags: ["amenity.bar", "amenity.pub"], words: /^(?:bars?|pubs?|places? (?:to|for) (?:a )?drinks?)$/ },
    { id: "supermarket", label: "supermarkets", tags: ["shop.supermarket"], words: /^(?:supermarkets?|grocer(?:y|ies)(?: stores?)?|grocery shops?|food stores?)$/ },
    { id: "convenience", label: "convenience stores", tags: ["shop.convenience"], words: /^(?:convenience stores?|corner shops?)$/ },
    { id: "bakery", label: "bakeries", tags: ["shop.bakery"], words: /^(?:bakery|bakeries)$/ },
    { id: "parking", label: "parking", tags: ["amenity.parking"], words: /^(?:parking(?: lots?| garages?| spaces?)?|car parks?|places? to park)$/ },
    { id: "hotel", label: "hotels", tags: ["tourism.hotel", "tourism.motel"], words: /^(?:hotels?|motels?|places? to stay)$/ },
    { id: "park", label: "parks", tags: ["leisure.park"], words: /^parks?$/ },
    { id: "toilets", label: "restrooms", tags: ["amenity.toilets"], words: /^(?:toilets?|restrooms?|bathrooms?|public toilets?|loos?)$/ },
    { id: "post", label: "post offices", tags: ["amenity.post_office"], words: /^post offices?$/ },
    { id: "library", label: "libraries", tags: ["amenity.library"], words: /^(?:library|libraries)$/ },
    { id: "gym", label: "gyms", tags: ["leisure.fitness_centre"], words: /^(?:gyms?|fitness (?:centers?|centres?))$/ }
];

// "the nearest coffee shop near me" -> "coffee shop"
function clean(q) {
    return String(q || "").toLowerCase().trim()
        .replace(/[?.!]+$/, "")
        .replace(/\s+(?:near me|nearby|near here|around here|around me|close by|close to me|in the area|near my location)$/, "")
        .replace(/^(?:find|show(?: me)?|search for|look for|where(?:'s| is| are))\s+/, "")
        .replace(/^(?:an?|the|some|any)\s+/, "")
        .replace(/^(?:nearest|closest|nearby|good|best|local)\s+/, "")
        .trim();
}
function category(q) {
    var w = clean(q);
    for (var i = 0; i < CATEGORIES.length; ++i) if (CATEGORIES[i].words.test(w)) return CATEGORIES[i];
    return null;
}
// Whether the words ask for the closest of a kind ("the nearest pharmacy",
// "a coffee shop"), not a named place.
function isNearby(q) {
    var t = String(q || "").toLowerCase().trim();
    return !!category(t) || /^(?:the )?(?:nearest|closest)\s/.test(t) || /\s(?:near me|nearby|near here|around here|around me|close by)$/.test(t);
}

function box(lat, lon, km) {
    var dLat = km / 111.2, dLon = km / (111.2 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(function (v) { return v.toFixed(4); }).join(",");
}
function meters(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
}

var RADII = [2, 8, 30];

function url(base, q, me, km, lang) {
    var cat = category(q);
    var what = cat ? cat.tags.map(function (t) { return "include=osm." + t; }).join("&") : "q=" + encodeURIComponent(clean(q) || q);
    return base + "/api?" + what + (km ? "&bbox=" + box(me.lat, me.lon, km) : "") +
        "&lat=" + me.lat.toFixed(4) + "&lon=" + me.lon.toFixed(4) + "&limit=" + (km ? 20 : 10) + "&lang=" + (lang || "en");
}

// A Photon feature as the assistant shows it, with its distance from me.
function place(f, me) {
    var p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [0, 0];
    var street = [p.housenumber, p.street].filter(Boolean).join(" ");
    var name = p.name || street || p.city || "Unnamed place";
    var at = { lat: c[1], lon: c[0] };
    return {
        id: "photon:" + (p.osm_type || "") + (p.osm_id || c.join(",")),
        name: name,
        address: [p.name ? street : "", p.city || p.locality || p.district].filter(function (x, i, a) { return x && a.indexOf(x) === i && x !== name; }).join(", "),
        category: p.osm_value && p.osm_value !== "yes" ? String(p.osm_value).replace(/_/g, " ") : "",
        lat: at.lat, lon: at.lon,
        meters: me ? meters(me, at) : 0
    };
}
function sorted(features, me) {
    var out = [];
    (features || []).map(function (f) { return place(f, me); })
        .filter(function (p) { return p.category !== "vacant"; })
        .sort(function (a, b) { return a.meters - b.meters; })
        .forEach(function (p) {
            if (!out.some(function (o) { return o.name === p.name && meters(o, p) < 60; })) out.push(p);
        });
    return out;
}

// The places for q around me, closest first: [{id, name, address,
// category, lat, lon, meters}]. getJson(url) -> Promise of the reply.
function find(getJson, base, q, me, lang) {
    var cat = category(q), i = 0;
    function next() {
        var km = RADII[i++];
        return getJson(url(base, q, me, km, lang)).then(function (j) {
            var list = sorted(j.features, me);
            if (list.length >= 3 || (list.length && !cat) || i >= RADII.length) return list.length || cat ? list : anywhere();
            return next();
        });
    }
    // A name not around: anywhere, nearest first by the bias.
    function anywhere() {
        return getJson(url(base, q, me, 0, lang)).then(function (j) { return sorted(j.features, me); });
    }
    return next();
}

module.exports = { CATEGORIES: CATEGORIES, clean: clean, category: category, isNearby: isNearby, url: url, find: find, meters: meters, RADII: RADII };
