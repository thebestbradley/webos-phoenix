// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open note in Agate's touch style: Edit / Preview tabs, a popup of
// formatting buttons (Aa), and a full-screen PopupMenu for the note's
// actions; its info slides up in a Drawer.

import BodyText from '@enact/agate/BodyText';
import Button from '@enact/agate/Button';
import Drawer from '@enact/agate/Drawer';
import Heading from '@enact/agate/Heading';
import Input from '@enact/agate/Input';
import LabeledIconButton from '@enact/agate/LabeledIconButton';
import Popup from '@enact/agate/Popup';
import PopupMenu from '@enact/agate/PopupMenu';
import ProgressBar from '@enact/agate/ProgressBar';
import Scroller from '@enact/agate/Scroller';
import TabGroup from '@enact/agate/TabGroup';
import {
	DEFAULT_FOLDER, codeBlock, insertLink, insertTable, isDeleted, longDate, setBlockStyle,
	taskStates, textLines, toggleInline, wordCount,
	type BlockStyle, type InlineStyle, type NotesApp, type TextState
} from '@phoenix/notes-core';
import {useEffect, useRef, useState} from 'react';

import MarkdownEditor, {type EditorHandle} from '../components/MarkdownEditor';
import MarkdownPreview from '../components/MarkdownPreview';
import {PopupButton, Spinner} from '../enact';

import css from './NoteView.module.less';

const BLOCKS: {id: BlockStyle; label: string}[] = [
	{id: 'title', label: 'Title'},
	{id: 'heading', label: 'Heading'},
	{id: 'subheading', label: 'Subheading'},
	{id: 'body', label: 'Body'},
	{id: 'bulleted', label: '• List'},
	{id: 'numbered', label: '1. List'},
	{id: 'quote', label: 'Quote'}
];

const INLINES: {id: InlineStyle; label: string}[] = [
	{id: 'bold', label: 'Bold'},
	{id: 'italic', label: 'Italic'},
	{id: 'strikethrough', label: 'Strike'},
	{id: 'code', label: 'Code'}
];

type Sheet = 'actions' | 'move' | 'info' | 'link' | 'delete' | null;

interface Props {
	app: NotesApp;
}

const NoteView = ({app}: Props) => {
	const note = app.selected;
	const editor = useRef<EditorHandle>(null);
	const [preview, setPreview] = useState(app.settings.openInPreview);
	const [formatOpen, setFormatOpen] = useState(false);
	const [sheet, setSheet] = useState<Sheet>(null);
	const [link, setLink] = useState('');

	useEffect(() => {
		setPreview(app.settings.openInPreview || (note ? isDeleted(note) : false));
	}, [note?._id]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!app.loaded) {
		return <div className={css.center}><Spinner>Loading notes…</Spinner></div>;
	}

	if (!note) {
		return (
			<div className={css.center}>
				<BodyText centered>No note selected</BodyText>
				<Button icon="edit" onClick={() => void app.newNote()}>New Note</Button>
			</div>
		);
	}

	const deleted = isDeleted(note);
	const apply = (command: (s: TextState) => TextState) => {
		setFormatOpen(false);
		if (preview) setPreview(false);
		setTimeout(() => editor.current?.apply(command), 0);
	};

	const formatPopup = () => (
		<div className={css.format}>
			<Heading size="small">Paragraph</Heading>
			<div className={css.grid}>
				{BLOCKS.map((b) => (
					<Button key={b.id} size="small" type="grid" onClick={() => apply((s) => setBlockStyle(s, b.id))}>{b.label}</Button>
				))}
				<Button size="small" type="grid" onClick={() => apply(codeBlock)}>Monostyled</Button>
			</div>
			<Heading size="small">Text</Heading>
			<div className={css.grid}>
				{INLINES.map((i) => (
					<Button key={i.id} size="small" type="grid" onClick={() => apply((s) => toggleInline(s, i.id))}>{i.label}</Button>
				))}
			</div>
		</div>
	);

	const tasks = taskStates(app.draft);
	const done = tasks.filter(Boolean).length;
	const folderChoices = [{id: DEFAULT_FOLDER, name: 'Notes'}, ...app.folders.map((f) => ({id: f._id, name: f.name}))];

	return (
		<div className={css.noteView}>
			<div className={css.toolbar}>
				<TabGroup
					className={css.modes}
					orientation="horizontal"
					tabPosition="before"
					tabs={[{title: 'Edit', icon: 'edit'}, {title: 'Preview', icon: 'detail'}]}
					selectedIndex={preview ? 1 : 0}
					onSelect={({selected}: {selected: number}) => setPreview(selected === 1)}
				/>
				<div className={css.spacer} />
				{deleted ? (
					<>
						<Button size="small" onClick={() => app.recover(note._id)}>Recover</Button>
						<Button icon="uninstall" size="small" backgroundOpacity="transparent" aria-label="Delete Now" onClick={() => setSheet('delete')} />
					</>
				) : (
					<>
						<PopupButton
							size="small"
							backgroundOpacity="transparent"
							aria-label="Format"
							direction="below left"
							open={formatOpen}
							onClick={() => setFormatOpen(!formatOpen)}
							onClose={() => setFormatOpen(false)}
							popupComponent={formatPopup}
						>
							Aa
						</PopupButton>
						<Button icon="check" size="small" backgroundOpacity="transparent" aria-label="Checklist" onClick={() => apply((s) => setBlockStyle(s, 'checklist'))} />
						<Button icon="displaycontrol" size="small" backgroundOpacity="transparent" aria-label="Table" onClick={() => apply((s) => insertTable(s))} />
						<Button icon="ellipsis" size="small" backgroundOpacity="transparent" aria-label="More" onClick={() => setSheet('actions')} />
					</>
				)}
			</div>
			<BodyText size="small" centered className={css.date}>{longDate(note.modifiedAt)}</BodyText>
			{tasks.length ? (
				<div className={css.progress}>
					<ProgressBar progress={done / tasks.length} />
					<BodyText size="small">{done} of {tasks.length} done</BodyText>
				</div>
			) : null}
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

			<PopupMenu open={sheet === 'actions'} title="Note" onClose={() => setSheet(null)}>
				<LabeledIconButton icon="send" onClick={() => { setLink(''); setSheet('link'); }}>Add Link</LabeledIconButton>
				<LabeledIconButton icon={note.pinned ? 'starhollow' : 'star'} onClick={() => { app.togglePin(note._id); setSheet(null); }}>
					{note.pinned ? 'Unpin' : 'Pin'}
				</LabeledIconButton>
				<LabeledIconButton icon="arrowrightturn" onClick={() => setSheet('move')}>Move</LabeledIconButton>
				<LabeledIconButton icon="detail" onClick={() => setSheet('info')}>Info</LabeledIconButton>
				<LabeledIconButton icon="uninstall" onClick={() => setSheet('delete')}>Delete</LabeledIconButton>
			</PopupMenu>

			<PopupMenu open={sheet === 'move'} title="Move to Folder" onClose={() => setSheet(null)}>
				{folderChoices.map((f) => (
					<LabeledIconButton
						key={f.id}
						icon="box"
						selected={note.folderId === f.id}
						onClick={() => { app.moveNote(note._id, f.id); setSheet(null); }}
					>
						{f.name}
					</LabeledIconButton>
				))}
			</PopupMenu>

			<Drawer open={sheet === 'info'} header={<Heading size="small">Note Info</Heading>}>
				<BodyText size="small">
					Folder: {app.folderName(note.folderId)}<br />
					Created: {longDate(note.createdAt)}<br />
					Modified: {longDate(note.modifiedAt)}<br />
					{wordCount(app.draft)} words, {app.draft.length} characters, {textLines(app.draft).length} lines
				</BodyText>
				<Button size="small" onClick={() => setSheet(null)}>Done</Button>
			</Drawer>

			<Popup open={sheet === 'link'} title="Add Link" centered onClose={() => setSheet(null)}>
				<BodyText size="small">Selected text becomes the link’s text.</BodyText>
				<Input
					className={css.linkInput}
					placeholder="https://"
					type="url"
					value={link}
					onChange={({value}: {value: string}) => setLink(value)}
				/>
				<div className={css.buttons}>
					<Button
						size="small"
						disabled={!link.trim()}
						onClick={() => {
							const url = link.trim();
							setSheet(null);
							apply((s) => insertLink(s, /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url));
						}}
					>
						Add
					</Button>
					<Button size="small" onClick={() => setSheet(null)}>Cancel</Button>
				</div>
			</Popup>

			<Popup open={sheet === 'delete'} title={deleted ? 'Delete this note now?' : 'Delete this note?'} centered onClose={() => setSheet(null)}>
				<BodyText size="small">
					{deleted ? 'It will be deleted immediately. You can’t undo this.' : 'It moves to Recently Deleted for 30 days.'}
				</BodyText>
				<div className={css.buttons}>
					<Button size="small" onClick={() => { setSheet(null); app.deleteNote(note._id); }}>Delete</Button>
					<Button size="small" onClick={() => setSheet(null)}>Cancel</Button>
				</div>
			</Popup>
		</div>
	);
};

export default NoteView;
