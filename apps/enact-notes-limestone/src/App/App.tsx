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
import {DEFAULT_SETTINGS, useNotesApp} from '@phoenix/notes-core';
import {useEffect, useState} from 'react';

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
	const [folders, setFolders] = useState(wide);
	useEffect(() => {
		const onResize = () => setWide(window.innerWidth >= WIDE);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);
	const selectedId = app.selected?._id;
	useEffect(() => {
		if (selectedId && !wide) setFolders(false);
	}, [selectedId, wide]);
	const noteShown = wide || !folders;
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const close = () => { setDialog(null); setProblem(null); };

	onSkin(app.settings.skin || 'neutral');

	const folderInput = dialog && (dialog.kind === 'newFolder' || dialog.kind === 'rename') ? dialog : null;

	return (
		<Row className={css.app}>
			{fullscreen ? null : (
				<>
					{folders ? <Cell size={wide ? '24%' : '40%'} className={css.column}>
						<Sidebar
							app={app}
							onSettings={() => setDialog({kind: 'settings'})}
							onNewFolder={() => setDialog({kind: 'newFolder'})}
							onRenameFolder={(id) => setDialog({kind: 'rename', id})}
							onDeleteFolder={(id) => setDialog({kind: 'deleteFolder', id})}
						/>
					</Cell> : null}
					<Cell size={noteShown ? (folders ? '30%' : '38%') : undefined} className={css.column}>
						<NoteList
							app={app}
							foldersShown={folders}
							onToggleFolders={() => setFolders(!folders)}
							onEmptyDeleted={() => setDialog({kind: 'emptyDeleted'})}
						/>
					</Cell>
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

export default App;
