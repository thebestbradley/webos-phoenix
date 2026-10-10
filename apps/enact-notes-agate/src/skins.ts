// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Agate's skins (styles/skin.less), which have a night variant, and their
// default accent and highlight colours (ThemeDecorator's defaultColors).
// Phoenix: the Phoenix design layer (@phoenix/enact), Agate's light Carbon
// skin in the Phoenix palette, with Phoenix's fonts.

import {phoenixAgate} from '@phoenix/enact';

export const SKINS: {id: string; label: string; night: boolean; agate?: string}[] = [
	{id: 'gallium', label: 'Gallium', night: true},
	{id: 'carbon', label: 'Carbon', night: false},
	{id: 'cobalt', label: 'Cobalt', night: true},
	{id: 'copper', label: 'Copper', night: true},
	{id: 'electro', label: 'Electro', night: false},
	{id: 'silicon', label: 'Silicon', night: true},
	{id: 'titanium', label: 'Titanium', night: false},
	{id: 'phoenix', label: 'Phoenix', night: false, agate: phoenixAgate.skin}
];

export const SKIN_COLORS: Record<string, {accent: string; highlight: string}> = {
	carbon: {accent: '#8fd43a', highlight: '#6abe0b'},
	cobalt: {accent: '#8c81ff', highlight: '#ffffff'},
	copper: {accent: '#a47d66', highlight: '#ffffff'},
	electro: {accent: '#0359f0', highlight: '#ff8100'},
	gallium: {accent: '#8b7efe', highlight: '#e16253'},
	silicon: {accent: '#f1304f', highlight: '#9e00d8'},
	titanium: {accent: '#a6a6a6', highlight: '#2a48ca'},
	phoenix: {accent: phoenixAgate.accent, highlight: phoenixAgate.highlight}
};
