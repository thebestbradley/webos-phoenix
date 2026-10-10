// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes (Agate): an Apple Notes-style app in LG's Enact framework with its
// Agate theme, the touch-first look made for car dashboards. The folders
// are Agate's tab rail; each shows its notes beside the open note.

import BodyText from '@enact/agate/BodyText';
import Button from '@enact/agate/Button';
import Heading from '@enact/agate/Heading';
import Input from '@enact/agate/Input';
import LabeledIconButton from '@enact/agate/LabeledIconButton';
import {Panel} from '@enact/agate/Panels';
import Popup from '@enact/agate/Popup';
import PopupMenu from '@enact/agate/PopupMenu';
import {Cell} from '@enact/ui/Layout';
import {ALL_NOTES, DEFAULT_FOLDER, DEFAULT_SETTINGS, RECENTLY_DELETED, noteFromShare, shareOfNote, useNotesApp} from '@phoenix/notes-core';
import {PhoenixDecorator, setPhoenixFonts, useAppMenu, useBack, useJustTypeAction, useShareReceiver, useStageReady} from '@phoenix/enact';
import {useEffect, useRef, useState} from 'react';

import {Row, TabbedPanels, ThemeDecorator} from '../enact';
import {luna} from '../luna';
import {SKIN_COLORS, SKINS} from '../skins';
import NoteList from '../views/NoteList';
import NoteView from '../views/NoteView';
import Settings from '../views/Settings';

import css from './App.module.less';

export const APP_ID = 'org.webosphoenix.enactnotes.agate';

const SETTINGS_TAB = 'settings';

// Below this width (a phone) the list and the note do not fit side by side:
// the tabs go across the top and one pane shows at a time, the note over
// the list while one is open; Back closes it.
const NARROW = 720;

type Dialog =
	| {kind: 'newFolder'}
	| {kind: 'rename'; id: string}
	| {kind: 'folderMenu'; id: string}
	| {kind: 'deleteFolder'; id: string}
	| {kind: 'emptyDeleted'};

export interface Theme {
	skin: string;
	night: boolean;
	accent: string;
	highlight: string;
}

const Notes = ({onTheme}: {onTheme: (t: Theme) => void}) => {
	const app = useNotesApp({
		appId: APP_ID,
		luna,
		settingsKey: APP_ID + ':settings',
		defaults: {...DEFAULT_SETTINGS, skin: 'gallium'}
	});
	const [tab, setTab] = useState<string>(ALL_NOTES);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [name, setName] = useState('');
	const [problem, setProblem] = useState<string | null>(null);
	const close = () => { setDialog(null); setProblem(null); };
	const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
	useEffect(() => {
		const onResize = () => setNarrow(window.innerWidth < NARROW);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	const noteOpen = narrow && !!app.selected;
	// The back gesture (@phoenix/enact's useBack): back to the list, taken so the card stays.
	useBack(() => { app.select(null); return true; }, noteOpen);

	// The Phoenix service plugin: the app menu (Edit and Share first, then
	// New Note), shares received (appinfo.json shareTargets) and Just
	// Type's New Note action as new notes, once the notes are loaded.
	const loaded = useRef(app.loaded);
	loaded.current = app.loaded;
	const pending = useRef<string[]>([]);
	const newNoteWith = (body: string) => {
		if (!body) return;
		if (loaded.current) void app.newNote(body);
		else pending.current.push(body);
	};
	useEffect(() => {
		if (!app.loaded) return;
		for (const body of pending.current.splice(0)) void app.newNote(body);
	}, [app.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
	useShareReceiver((s) => { setTab(ALL_NOTES); newNoteWith(noteFromShare(s)); });
	useJustTypeAction('newNote', (text) => { setTab(ALL_NOTES); newNoteWith(text); });
	useAppMenu({
		items: [{label: 'New Note', onSelect: () => void app.newNote()}, {label: 'Settings', onSelect: () => setTab(SETTINGS_TAB)}],
		share: () => (app.selected ? shareOfNote(app.draft) : null)
	});
	useStageReady(app.loaded);

	const skin = SKINS.find((k) => k.id === app.settings.skin) ?? SKINS[0];
	useEffect(() => setPhoenixFonts(skin.id === 'phoenix'), [skin.id]);
	onTheme({
		skin: skin.agate ?? skin.id,
		night: skin.night && !!app.settings.extra.night,
		accent: (app.settings.extra.accent as string) || SKIN_COLORS[skin.id].accent,
		highlight: (app.settings.extra.highlight as string) || SKIN_COLORS[skin.id].highlight
	});

	const folders = app.folders.slice().sort((a, b) => a.name.localeCompare(b.name));
	// Agate's icon font has no glyph for IconList's `trash` (3.3), so
	// Recently Deleted uses `uninstall`.
	const tabs = [
		{id: ALL_NOTES, title: 'All Notes', icon: 'apps'},
		{id: DEFAULT_FOLDER, title: 'Notes', icon: 'detail'},
		...folders.map((f) => ({id: f._id, title: f.name, icon: 'box'})),
		{id: RECENTLY_DELETED, title: 'Recently Deleted', icon: 'uninstall'},
		{id: SETTINGS_TAB, title: 'Settings', icon: 'setting'}
	];
	const index = Math.max(0, tabs.findIndex((t) => t.id === tab));
	const userFolder = folders.some((f) => f._id === tab);

	const onSelect = ({index: i}: {index: number}) => {
		const id = tabs[i].id;
		setTab(id);
		if (id !== SETTINGS_TAB) app.openFolder(id);
	};

	const nameDialog = dialog && (dialog.kind === 'newFolder' || dialog.kind === 'rename') ? dialog : null;
	const saveName = async () => {
		if (!nameDialog) return;
		const err = nameDialog.kind === 'rename' ? await app.renameFolder(nameDialog.id, name) : await app.createFolder(name);
		if (err) {
			setProblem(err);
		} else {
			if (nameDialog.kind === 'newFolder') setTab(app.folderId);
			close();
		}
	};

	return (
		<>
			<TabbedPanels
				className={css.panels}
				orientation={narrow ? 'vertical' : 'horizontal'}
				tabPosition="before"
				// Across the top of a phone: the tabs' icons only.
				tabs={tabs.map(({title, icon}) => (narrow ? {title: '', icon} : {title, icon}))}
				index={index}
				onSelect={onSelect}
				noCloseButton
				beforeTabs={narrow ? null : <Heading size="large" className={css.appTitle}>Notes</Heading>}
				afterTabs={
					<Button icon="plus" size="small" className={css.newFolder} aria-label="New Folder"
						onClick={() => { setName(''); setDialog({kind: 'newFolder'}); }}>
						{narrow ? null : 'New Folder'}
					</Button>
				}
			>
				{tabs.map((t) => (
					<Panel key={t.id} className={css.panel}>
						{t.id === SETTINGS_TAB ? (
							<Settings app={app} />
						) : narrow ? (
							<Row className={css.columns}>
								<Cell className={css.column}>
									{noteOpen ? <NoteView app={app} /> : (
										<NoteList
											app={app}
											onEmptyDeleted={() => setDialog({kind: 'emptyDeleted'})}
											onFolderMenu={userFolder ? () => setDialog({kind: 'folderMenu', id: tab}) : undefined}
										/>
									)}
								</Cell>
							</Row>
						) : (
							<Row className={css.columns}>
								<Cell size="40%" className={css.column}>
									<NoteList
										app={app}
										onEmptyDeleted={() => setDialog({kind: 'emptyDeleted'})}
										onFolderMenu={userFolder ? () => setDialog({kind: 'folderMenu', id: tab}) : undefined}
									/>
								</Cell>
								<Cell className={css.column}>
									<NoteView app={app} />
								</Cell>
							</Row>
						)}
					</Panel>
				))}
			</TabbedPanels>

			<PopupMenu open={dialog?.kind === 'folderMenu'} title={dialog?.kind === 'folderMenu' ? app.folderName(dialog.id) : ''} onClose={close}>
				<LabeledIconButton
					icon="edit"
					onClick={() => {
						if (dialog?.kind !== 'folderMenu') return;
						setName(app.folderName(dialog.id));
						setDialog({kind: 'rename', id: dialog.id});
					}}
				>
					Rename
				</LabeledIconButton>
				<LabeledIconButton icon="uninstall" onClick={() => dialog?.kind === 'folderMenu' && setDialog({kind: 'deleteFolder', id: dialog.id})}>
					Delete
				</LabeledIconButton>
			</PopupMenu>

			<Popup open={!!nameDialog} title={nameDialog?.kind === 'rename' ? 'Rename Folder' : 'New Folder'} centered onClose={close}>
				<Input
					className={css.nameInput}
					placeholder="Name"
					value={name}
					invalid={!!problem}
					invalidMessage={problem ?? undefined}
					dismissOnEnter
					onChange={({value}: {value: string}) => { setName(value); setProblem(null); }}
					onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === 'Enter') void saveName(); }}
				/>
				<div className={css.buttons}>
					<Button size="small" onClick={() => void saveName()}>Save</Button>
					<Button size="small" onClick={close}>Cancel</Button>
				</div>
			</Popup>

			<Popup
				open={dialog?.kind === 'deleteFolder' || dialog?.kind === 'emptyDeleted'}
				title={dialog?.kind === 'emptyDeleted' ? 'Delete all notes in Recently Deleted?' : 'Delete this folder?'}
				centered
				onClose={close}
			>
				<BodyText size="small">
					{dialog?.kind === 'emptyDeleted' ? 'They will be deleted immediately. You can’t undo this.' : 'Its notes move to Recently Deleted.'}
				</BodyText>
				<div className={css.buttons}>
					<Button
						size="small"
						onClick={() => {
							if (dialog?.kind === 'deleteFolder') {
								app.deleteFolder(dialog.id);
								setTab(ALL_NOTES);
							} else {
								app.emptyRecentlyDeleted();
							}
							close();
						}}
					>
						Delete
					</Button>
					<Button size="small" onClick={close}>Cancel</Button>
				</div>
			</Popup>
		</>
	);
};

// Skin, night variant and colours are ThemeDecorator props, so they are
// lifted above the decorated app. Nothing takes the focus at start (a touch
// screen, not a remote).
const Themed = ThemeDecorator({noAutoFocus: true}, ({onTheme, ...rest}: {onTheme: (t: Theme) => void}) => (
	<Notes {...rest} onTheme={onTheme} />
));

const App = () => {
	const [theme, setTheme] = useState<Theme>({skin: 'gallium', night: false, accent: SKIN_COLORS.gallium.accent, highlight: SKIN_COLORS.gallium.highlight});
	return (
		<Themed
			skin={theme.skin}
			skinVariants={theme.night ? 'night' : undefined}
			accent={theme.accent}
			highlight={theme.highlight}
			onTheme={(t: Theme) => {
				if (t.skin !== theme.skin || t.night !== theme.night || t.accent !== theme.accent || t.highlight !== theme.highlight) setTheme(t);
			}}
		/>
	);
};

// The Phoenix service plugin's transport (Enact's LS2Request) and design
// tokens; Phoenix's fonts only with the Phoenix skin (above).
export default PhoenixDecorator(App, {fonts: false});
