// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes (Limestone): an Apple Notes-style app in LG's Enact framework with
// its Limestone theme. Three columns (folders, notes, the note), as Notes on
// an iPad; the note can take the whole screen.

import Alert from '@enact/limestone/Alert';
import Button from '@enact/limestone/Button';
import {InputPopup} from '@enact/limestone/Input';
import ThemeDecorator from '@enact/limestone/ThemeDecorator';
import {Cell} from '@enact/ui/Layout';
import {DEFAULT_SETTINGS, noteFromShare, shareOfNote, useNotesApp} from '@phoenix/notes-core';
import {PhoenixDecorator, useAppMenu, useBack, useJustTypeAction, useShareReceiver, useStageReady} from '@phoenix/enact';
import {useEffect, useRef, useState} from 'react';

import {Row} from '../enact';
import {luna} from '../luna';
import NoteList from '../views/NoteList';
import NoteView from '../views/NoteView';
import SettingsPopup from '../views/SettingsPopup';
import Sidebar from '../views/Sidebar';

import css from './App.module.less';

export const APP_ID = 'org.webosphoenix.enactnotes.limestone';

// Below this width the three columns do not fit Limestone's type sizes.
const WIDE = 1280;
// Below this one (a phone) one column shows at a time: the notes, the
// folders over them while open, the note while one is open; Back closes
// the folders or the note.
const NARROW = 720;

type Dialog =
	| {kind: 'newFolder'}
	| {kind: 'rename'; id: string}
	| {kind: 'deleteFolder'; id: string}
	| {kind: 'emptyDeleted'}
	| {kind: 'settings'};

const Notes = ({onSkin}: {onSkin: (skin: string) => void}) => {
	const app = useNotesApp({
		appId: APP_ID,
		luna,
		settingsKey: APP_ID + ':settings',
		defaults: {...DEFAULT_SETTINGS, skin: 'neutral'}
	});
	const [fullscreen, setFullscreen] = useState(false);
	// Folders show beside the list and the note on wide screens. On a
	// tablet they are a button away and take the note's place while open,
	// as in Notes on an iPad; opening a note puts it back.
	const [wide, setWide] = useState(() => window.innerWidth >= WIDE);
	const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
	const [folders, setFolders] = useState(wide);
	useEffect(() => {
		const onResize = () => {
			setWide(window.innerWidth >= WIDE);
			setNarrow(window.innerWidth < NARROW);
		};
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	const selectedId = app.selected?._id;
	useEffect(() => {
		if (selectedId && !wide) setFolders(false);
	}, [selectedId, wide]);
	// A folder picked on a phone: its notes, in the folders' place.
	const folderId = app.folderId;
	useEffect(() => {
		if (narrow) setFolders(false);
	}, [folderId, narrow]);
	const noteShown = narrow ? !folders && !!app.selected : wide || !folders;
	const listShown = !narrow || (!folders && !app.selected);
	// The back gesture (@phoenix/enact's useBack): the folders or the note
	// close, taken so the card stays.
	useBack(() => {
		if (folders) setFolders(false);
		else app.select(null);
		return true;
	}, narrow && (folders || !!app.selected));
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const close = () => { setDialog(null); setProblem(null); };

	onSkin(app.settings.skin || 'neutral');

	// The Phoenix service plugin: the app menu (Edit and Share first, then
	// New Note and Settings), shares received (appinfo.json shareTargets)
	// and Just Type's New Note action as new notes, once the notes are loaded.
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
	useShareReceiver((s) => newNoteWith(noteFromShare(s)));
	useJustTypeAction('newNote', newNoteWith);
	useAppMenu({
		items: [{label: 'New Note', onSelect: () => void app.newNote()}, {label: 'Settings', onSelect: () => setDialog({kind: 'settings'})}],
		share: () => (app.selected ? shareOfNote(app.draft) : null)
	});
	useStageReady(app.loaded);

	const folderInput = dialog && (dialog.kind === 'newFolder' || dialog.kind === 'rename') ? dialog : null;

	return (
		<Row className={css.app}>
			{fullscreen ? null : (
				<>
					{folders ? <Cell size={narrow ? undefined : wide ? '24%' : '40%'} className={css.column}>
						<Sidebar
							app={app}
							onSettings={() => setDialog({kind: 'settings'})}
							onNewFolder={() => setDialog({kind: 'newFolder'})}
							onRenameFolder={(id) => setDialog({kind: 'rename', id})}
							onDeleteFolder={(id) => setDialog({kind: 'deleteFolder', id})}
						/>
					</Cell> : null}
					{listShown ? <Cell size={noteShown && !narrow ? (folders ? '30%' : '38%') : undefined} className={css.column}>
						<NoteList
							app={app}
							foldersShown={folders}
							onToggleFolders={() => setFolders(!folders)}
							onEmptyDeleted={() => setDialog({kind: 'emptyDeleted'})}
						/>
					</Cell> : null}
				</>
			)}
			{noteShown ? (
				<Cell className={css.column}>
					<NoteView app={app} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen(!fullscreen)} />
				</Cell>
			) : null}

			<InputPopup
				open={!!folderInput}
				popupType="overlay"
				title={folderInput?.kind === 'rename' ? 'Rename Folder' : 'New Folder'}
				subtitle="Enter a name for this folder."
				placeholder="Name"
				value={folderInput?.kind === 'rename' ? app.folderName(folderInput.id) : undefined}
				invalid={!!problem}
				invalidMessage={problem ?? undefined}
				onClose={close}
				onComplete={async ({value}: {value: string}) => {
					const err = folderInput?.kind === 'rename'
						? await app.renameFolder(folderInput.id, value)
						: await app.createFolder(value);
					if (err) setProblem(err);
					else close();
				}}
			/>

			<Alert
				open={dialog?.kind === 'deleteFolder' || dialog?.kind === 'emptyDeleted'}
				type="overlay"
				title={dialog?.kind === 'emptyDeleted' ? 'Delete all notes in Recently Deleted?' : 'Delete this folder?'}
				onClose={close}
				buttons={[
					<Button
						key="delete"
						size="small"
						onClick={() => {
							if (dialog?.kind === 'deleteFolder') app.deleteFolder(dialog.id);
							else app.emptyRecentlyDeleted();
							close();
						}}
					>
						Delete
					</Button>,
					<Button key="cancel" size="small" onClick={close}>Cancel</Button>
				]}
			>
				{dialog?.kind === 'emptyDeleted'
					? 'They will be deleted immediately. You can’t undo this.'
					: 'Its notes move to Recently Deleted.'}
			</Alert>

			<SettingsPopup app={app} open={dialog?.kind === 'settings'} onClose={close} />
		</Row>
	);
};

// The skin is a ThemeDecorator prop, so it is lifted above the decorated app.
// On a touch screen nothing takes the focus at start (on a TV, Spotlight
// would focus the first control for the remote).
const Themed = ThemeDecorator({noAutoFocus: true}, ({onSkin, ...rest}: {onSkin: (s: string) => void}) => (
	<Notes {...rest} onSkin={onSkin} />
));

const App = () => {
	const [skin, setSkin] = useState('neutral');
	return <Themed skin={skin} onSkin={(s: string) => { if (s !== skin) setSkin(s); }} />;
};

// The Phoenix service plugin's transport (Enact's LS2Request) and design
// tokens; Limestone keeps its own fonts (Museo Sans, sized for a TV).
export default PhoenixDecorator(App, {fonts: false});
