// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings in Limestone's PopupTabLayout (the webOS TV settings popup):
// Appearance, Notes, and About (which lists the Enact components used).

import BodyText from '@enact/limestone/BodyText';
import CheckboxItem from '@enact/limestone/CheckboxItem';
import {Chip, Chips} from '@enact/limestone/Chips';
import Dropdown from '@enact/limestone/Dropdown';
import Heading from '@enact/limestone/Heading';
import {Header} from '@enact/limestone/Panels';
import {TabPanel, TabPanels} from '@enact/limestone/PopupTabLayout';
import RadioItem from '@enact/limestone/RadioItem';
import Slider from '@enact/limestone/Slider';
import SwitchItem from '@enact/limestone/SwitchItem';
import type {NewNoteStyle, NotesApp, SortOrder} from '@phoenix/notes-core';

import limestonePackage from '@enact/limestone/package.json';
import corePackage from '@enact/core/package.json';

import {PopupTabLayout, Tab} from '../enact';

import css from './SettingsPopup.module.less';

const SKINS = [{id: 'neutral', label: 'Neutral (dark)'}, {id: 'light', label: 'Light'}];
const SORTS: {id: SortOrder; label: string}[] = [
	{id: 'modified', label: 'Date Edited'},
	{id: 'created', label: 'Date Created'},
	{id: 'title', label: 'Title'}
];
const STARTS: {id: NewNoteStyle; label: string}[] = [
	{id: 'title', label: 'Title'},
	{id: 'heading', label: 'Heading'},
	{id: 'body', label: 'Body'}
];

// Everything from Enact this app draws with, for the About tab.
const USED = [
	'ThemeDecorator', 'Panel', 'Header', 'Item', 'Heading', 'BodyText', 'Icon', 'Button',
	'TooltipDecorator', 'ContextualMenuDecorator', 'InputField', 'Input (popup)', 'Chips',
	'Scroller', 'VirtualList', 'Popup', 'Alert', 'RadioItem', 'CheckboxItem', 'SwitchItem',
	'Dropdown', 'Slider', 'Spinner', 'PopupTabLayout', 'ui/Layout', 'ui/resolution',
	'webos/LS2Request', 'spotlight'
];

interface Props {
	app: NotesApp;
	open: boolean;
	onClose: () => void;
}

const SettingsPopup = ({app, open, onClose}: Props) => {
	const s = app.settings;
	return (
		<PopupTabLayout open={open} onClose={onClose}>
			<Tab title="Appearance" icon="picture">
				<TabPanels>
					<TabPanel>
						<Header type="compact" title="Appearance" />
						<Heading size="tiny">Skin</Heading>
						{SKINS.map((k) => (
							<RadioItem key={k.id} selected={(s.skin || 'neutral') === k.id} onToggle={() => app.updateSettings({skin: k.id})}>
								{k.label}
							</RadioItem>
						))}
						<Heading size="tiny">Text Size: {s.textSize}%</Heading>
						<Slider
							className={css.slider}
							min={80}
							max={150}
							step={10}
							value={s.textSize}
							onChange={({value}: {value: number}) => app.updateSettings({textSize: value})}
						/>
						<SwitchItem selected={s.openInPreview} onToggle={() => app.updateSettings({openInPreview: !s.openInPreview})}>
							Open Notes in Preview
						</SwitchItem>
					</TabPanel>
				</TabPanels>
			</Tab>
			<Tab title="Notes" icon="list">
				<TabPanels>
					<TabPanel>
						<Header type="compact" title="Notes" />
						<Dropdown
							title="Sort Notes By"
							size="small"
							selected={SORTS.findIndex((x) => x.id === s.sort)}
							onSelect={({selected}: {selected: number}) => app.updateSettings({sort: SORTS[selected].id})}
						>
							{SORTS.map((x) => x.label)}
						</Dropdown>
						<CheckboxItem selected={s.groupByDate} onToggle={() => app.updateSettings({groupByDate: !s.groupByDate})}>
							Group Notes by Date
						</CheckboxItem>
						<Heading size="tiny">New Notes Start With</Heading>
						{STARTS.map((x) => (
							<RadioItem key={x.id} selected={s.newNoteStyle === x.id} onToggle={() => app.updateSettings({newNoteStyle: x.id})}>
								{x.label}
							</RadioItem>
						))}
					</TabPanel>
				</TabPanels>
			</Tab>
			<Tab title="About" icon="info">
				<TabPanels>
					<TabPanel>
						<Header type="compact" title="About" subtitle={`Enact ${corePackage.version} · Limestone ${limestonePackage.version}`} />
						<BodyText size="small">
							A demo of LG’s Enact framework with its Limestone theme, the look of current webOS TVs,
							in webOS Phoenix. Notes are plain Markdown and are shared with the Agate demo.
						</BodyText>
						<Heading size="tiny">Enact components in this app</Heading>
						<Chips>
							{USED.map((u) => <Chip key={u} id={u}>{u}</Chip>)}
						</Chips>
					</TabPanel>
				</TabPanels>
			</Tab>
		</PopupTabLayout>
	);
};

export default SettingsPopup;
