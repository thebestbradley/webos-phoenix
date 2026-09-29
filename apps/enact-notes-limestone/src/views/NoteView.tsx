// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open note: Apple Notes' toolbar (Aa styles, checklist, table, link,
// pin, move, info, delete), then the Markdown source or its preview.

import Alert from '@enact/limestone/Alert';
import BodyText from '@enact/limestone/BodyText';
import Button from '@enact/limestone/Button';
import Heading from '@enact/limestone/Heading';
import {InputPopup} from '@enact/limestone/Input';
import {Header, Panel} from '@enact/limestone/Panels';
import Popup from '@enact/limestone/Popup';
import RadioItem from '@enact/limestone/RadioItem';
import Scroller from '@enact/limestone/Scroller';
import {
	DEFAULT_FOLDER, codeBlock, insertLink, insertTable, isDeleted, longDate, setBlockStyle,
	textLines, toggleInline, wordCount,
	type BlockStyle, type InlineStyle, type NotesApp, type TextState
} from '@phoenix/notes-core';
import {useEffect, useRef, useState} from 'react';

import MarkdownEditor, {type EditorHandle} from '../components/MarkdownEditor';
import {MenuButton, Spinner} from '../enact';
import MarkdownPreview from '../components/MarkdownPreview';

import css from './NoteView.module.less';

const BLOCKS: {id: BlockStyle; label: string}[] = [
	{id: 'title', label: 'Title'},
	{id: 'heading', label: 'Heading'},
	{id: 'subheading', label: 'Subheading'},
	{id: 'body', label: 'Body'},
	{id: 'bulleted', label: '• Bulleted List'},
	{id: 'numbered', label: '1. Numbered List'},
	{id: 'quote', label: '| Block Quote'}
];

const INLINES: {id: InlineStyle; label: string}[] = [
	{id: 'bold', label: 'Bold'},
	{id: 'italic', label: 'Italic'},
	{id: 'strikethrough', label: 'Strikethrough'},
	{id: 'code', label: 'Code'}
];

interface Props {
	app: NotesApp;
	fullscreen: boolean;
	onToggleFullscreen: () => void;
}

const NoteView = ({app, fullscreen, onToggleFullscreen}: Props) => {
	const note = app.selected;
	const editor = useRef<EditorHandle>(null);
	const [preview, setPreview] = useState(app.settings.openInPreview);
	const [popup, setPopup] = useState<'move' | 'info' | 'link' | 'delete' | null>(null);

	// Each note opens in the mode chosen in Settings.
	useEffect(() => {
		setPreview(app.settings.openInPreview || (note ? isDeleted(note) : false));
	}, [note?._id]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!app.loaded) {
		return (
			<Panel className={css.noteView}>
				<div className={css.center}><Spinner>Loading notes…</Spinner></div>
			</Panel>
		);
	}

	if (!note) {
		return (
			<Panel className={css.noteView}>
				<Header type="mini" noCloseButton noBackButton slotBefore={fullscreenButton(fullscreen, onToggleFullscreen)} />
				<div className={css.content}><div className={css.center}>
					<BodyText centered>No note selected</BodyText>
					<Button icon="edit" onClick={() => void app.newNote()}>New Note</Button>
				</div></div>
			</Panel>
		);
	}

	const deleted = isDeleted(note);
	const apply = (command: (s: TextState) => TextState) => {
		if (preview) setPreview(false);
		// The editor mounts on the next render when coming from the preview.
		setTimeout(() => editor.current?.apply(command), 0);
	};

	const formatMenu = [
		...BLOCKS.map((b) => ({key: b.id, children: b.label, onClick: () => apply((s) => setBlockStyle(s, b.id))})),
		{key: 'mono', children: 'Monostyled', onClick: () => apply(codeBlock)},
		...INLINES.map((i) => ({key: i.id, children: i.label, onClick: () => apply((s) => toggleInline(s, i.id))}))
	];

	const folderChoices = [{id: DEFAULT_FOLDER, name: 'Notes'}, ...app.folders.map((f) => ({id: f._id, name: f.name}))];
	const lines = textLines(app.draft);

	return (
		<Panel className={css.noteView}>
			<Header
				type="mini"
				noCloseButton
				noBackButton
				slotBefore={fullscreenButton(fullscreen, onToggleFullscreen)}
				slotAfter={deleted ? (
					<>
						<Button size="small" onClick={() => app.recover(note._id)}>Recover</Button>
						<Button icon="trash" size="small" backgroundOpacity="transparent" tooltipText="Delete Now" aria-label="Delete Now" onClick={() => setPopup('delete')} />
					</>
				) : (
					<>
						<MenuButton size="small" backgroundOpacity="transparent" direction="below" menuItems={formatMenu} tooltipText="Format" aria-label="Format">
							Aa
						</MenuButton>
						<Button icon="check" size="small" backgroundOpacity="transparent" tooltipText="Checklist" aria-label="Checklist" onClick={() => apply((s) => setBlockStyle(s, 'checklist'))} />
						<Button icon="index" size="small" backgroundOpacity="transparent" tooltipText="Table" aria-label="Table" onClick={() => apply((s) => insertTable(s))} />
						<Button
							icon={preview ? 'edit' : 'show'}
							size="small"
							backgroundOpacity="transparent"
							tooltipText={preview ? 'Edit Markdown' : 'Preview'} aria-label={preview ? 'Edit Markdown' : 'Preview'}
							onClick={() => setPreview(!preview)}
						/>
						<MenuButton
							icon="verticalellipsis"
							size="small"
							backgroundOpacity="transparent"
							tooltipText="More" aria-label="More"
							direction="below"
							menuItems={[
								{key: 'link', children: 'Add Link…', onClick: () => setPopup('link')},
								{key: 'pin', children: note.pinned ? 'Unpin Note' : 'Pin Note', onClick: () => app.togglePin(note._id)},
								{key: 'move', children: 'Move to Folder…', onClick: () => setPopup('move')},
								{key: 'info', children: 'Note Info', onClick: () => setPopup('info')},
								{key: 'delete', children: 'Delete Note', onClick: () => setPopup('delete')}
							]}
						/>
					</>
				)}
			/>
			<div className={css.content}>
			<BodyText size="small" centered className={css.date}>{longDate(note.modifiedAt)}</BodyText>
			{deleted ? (
				<BodyText size="small" centered className={css.banner}>
					This note is in Recently Deleted. Recover it to edit it.
				</BodyText>
			) : null}
			<div className={css.body}>
				{preview ? (
					<Scroller className={css.scroller}>
						<MarkdownPreview source={app.draft} textSize={app.settings.textSize} onToggleTask={deleted ? undefined : app.toggleTask} />
					</Scroller>
				) : (
					<MarkdownEditor
						ref={editor}
						value={app.draft}
						onChange={app.setDraft}
						textSize={app.settings.textSize}
						placeholder="Start typing. Markdown works: # Title, **bold**, - [ ] task"
					/>
				)}
			</div>
			</div>

			<Popup open={popup === 'move'} onClose={() => setPopup(null)} position="center">
				<Heading size="small">Move to Folder</Heading>
				{folderChoices.map((f) => (
					<RadioItem key={f.id} selected={note.folderId === f.id} onToggle={() => { app.moveNote(note._id, f.id); setPopup(null); }}>
						{f.name}
					</RadioItem>
				))}
			</Popup>

			<Popup open={popup === 'info'} onClose={() => setPopup(null)} position="center">
				<Heading size="small">Note Info</Heading>
				<BodyText size="small">
					Folder: {app.folderName(note.folderId)}<br />
					Created: {longDate(note.createdAt)}<br />
					Modified: {longDate(note.modifiedAt)}<br />
					{wordCount(app.draft)} words, {app.draft.length} characters, {lines.length} lines
				</BodyText>
				<Button size="small" onClick={() => setPopup(null)}>Done</Button>
			</Popup>

			<InputPopup
				open={popup === 'link'}
				popupType="overlay"
				title="Add Link"
				subtitle="Selected text becomes the link's text."
				placeholder="https://"
				type="url"
				onClose={() => setPopup(null)}
				onComplete={({value}: {value: string}) => {
					setPopup(null);
					const url = value.trim();
					if (url) apply((s) => insertLink(s, /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url));
				}}
			/>

			<Alert
				open={popup === 'delete'}
				type="overlay"
				title={deleted ? 'Delete this note now?' : 'Delete this note?'}
				onClose={() => setPopup(null)}
				buttons={[
					<Button key="delete" size="small" onClick={() => { setPopup(null); app.deleteNote(note._id); }}>Delete</Button>,
					<Button key="cancel" size="small" onClick={() => setPopup(null)}>Cancel</Button>
				]}
			>
				{deleted ? 'It will be deleted immediately. You can’t undo this.' : 'It moves to Recently Deleted for 30 days.'}
			</Alert>
		</Panel>
	);
};

function fullscreenButton (fullscreen: boolean, onToggle: () => void) {
	return (
		<Button
			icon={fullscreen ? 'exitfullscreen' : 'fullscreen'}
			size="small"
			backgroundOpacity="transparent"
			tooltipText={fullscreen ? 'Show Folders and Notes' : 'Hide Folders and Notes'} aria-label={fullscreen ? 'Show Folders and Notes' : 'Hide Folders and Notes'}
			onClick={onToggle}
		/>
	);
}

export default NoteView;
