// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings, a tab of its own as in Agate's car-dashboard apps: Agate's
// skins with day and night, accent and highlight colours (ColorPicker),
// text size on an ArcSlider, and the notes options.

import ArcSlider from '@enact/agate/ArcSlider';
import BodyText from '@enact/agate/BodyText';
import CheckboxItem from '@enact/agate/CheckboxItem';
import ColorPicker from '@enact/agate/ColorPicker';
import Heading from '@enact/agate/Heading';
import RadioItem from '@enact/agate/RadioItem';
import Scroller from '@enact/agate/Scroller';
import SwitchItem from '@enact/agate/SwitchItem';
import type {NewNoteStyle, NotesApp, SortOrder} from '@phoenix/notes-core';

import agatePackage from '@enact/agate/package.json';
import corePackage from '@enact/core/package.json';

import {Dropdown, SliderButton} from '../enact';
import {SKIN_COLORS, SKINS} from '../skins';

import css from './Settings.module.less';

const SORTS: {id: SortOrder; label: string}[] = [
	{id: 'modified', label: 'Edited'},
	{id: 'created', label: 'Created'},
	{id: 'title', label: 'Title'}
];
const STARTS: {id: NewNoteStyle; label: string}[] = [
	{id: 'title', label: 'Title'},
	{id: 'heading', label: 'Heading'},
	{id: 'body', label: 'Body'}
];

// Everything from Enact this app draws with.
const USED = [
	'ThemeDecorator', 'TabbedPanels', 'Panel', 'Heading', 'BodyText', 'Item', 'Icon', 'Button',
	'LabeledIconButton', 'ToggleButton', 'TabGroup', 'ContextualPopupDecorator', 'PopupMenu',
	'Popup', 'Drawer', 'Input', 'Scroller', 'VirtualList', 'ProgressBar', 'Spinner', 'RadioItem',
	'CheckboxItem', 'SwitchItem', 'Dropdown', 'SliderButton', 'ArcSlider', 'ColorPicker',
	'ui/Layout', 'ui/resolution', 'webos/LS2Request', 'spotlight'
];

interface Props {
	app: NotesApp;
}

const Settings = ({app}: Props) => {
	const s = app.settings;
	const skin = SKINS.find((k) => k.id === s.skin) ?? SKINS[0];
	const colors = SKIN_COLORS[skin.id];
	const accent = (s.extra.accent as string) || colors.accent;
	const highlight = (s.extra.highlight as string) || colors.highlight;
	const sortIndex = SORTS.findIndex((x) => x.id === s.sort);

	return (
		<Scroller className={css.settings}>
			<div className={css.columns}>
				<section>
					<Heading size="small" showLine>Appearance</Heading>
					<Dropdown
						title="Skin"
						selected={SKINS.indexOf(skin)}
						onSelect={({selected}: {selected: number}) => app.updateSettings({skin: SKINS[selected].id, extra: {accent: '', highlight: ''}})}
					>
						{SKINS.map((k) => k.label)}
					</Dropdown>
					<SwitchItem
						disabled={!skin.night}
						selected={!!s.extra.night && skin.night}
						onToggle={() => app.updateSettings({extra: {night: !s.extra.night}})}
					>
						Night Mode
					</SwitchItem>
					<div className={css.colors}>
						<div>
							<BodyText size="small">Accent</BodyText>
							<ColorPicker value={accent} onChange={({value}: {value: string}) => app.updateSettings({extra: {accent: value}})} />
						</div>
						<div>
							<BodyText size="small">Highlight</BodyText>
							<ColorPicker value={highlight} onChange={({value}: {value: string}) => app.updateSettings({extra: {highlight: value}})} />
						</div>
					</div>
					<Heading size="small" showLine>Text Size</Heading>
					<div className={css.arc}>
						<ArcSlider
							min={80}
							max={150}
							step={10}
							value={s.textSize}
							onChange={({value}: {value: number}) => app.updateSettings({textSize: value})}
							slotCenter={<BodyText centered>{s.textSize}%</BodyText>}
						/>
					</div>
				</section>
				<section>
					<Heading size="small" showLine>Notes</Heading>
					<BodyText size="small">Sort by</BodyText>
					<SliderButton
						value={sortIndex < 0 ? 0 : sortIndex}
						onChange={({value}: {value: number}) => app.updateSettings({sort: SORTS[value].id})}
					>
						{SORTS.map((x) => x.label)}
					</SliderButton>
					<CheckboxItem selected={s.groupByDate} onToggle={() => app.updateSettings({groupByDate: !s.groupByDate})}>
						Group Notes by Date
					</CheckboxItem>
					<SwitchItem selected={s.openInPreview} onToggle={() => app.updateSettings({openInPreview: !s.openInPreview})}>
						Open Notes in Preview
					</SwitchItem>
					<Heading size="small" showLine>New Notes Start With</Heading>
					{STARTS.map((x) => (
						<RadioItem key={x.id} selected={s.newNoteStyle === x.id} onToggle={() => app.updateSettings({newNoteStyle: x.id})}>
							{x.label}
						</RadioItem>
					))}
					<Heading size="small" showLine>About</Heading>
					<BodyText size="small">
						A demo of LG’s Enact framework ({corePackage.version}) with its Agate theme ({agatePackage.version}),
						made for car dashboards and touch screens. Notes are plain Markdown and are shared with the
						Limestone demo.
					</BodyText>
					<BodyText size="small" className={css.used}>Enact components in this app: {USED.join(', ')}.</BodyText>
				</section>
			</div>
		</Scroller>
	);
};

export default Settings;
