// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open folder's notes in Apple Notes' date sections, or search results
// across all notes (a VirtualList), with filter toggles.

import BodyText from '@enact/agate/BodyText';
import Button from '@enact/agate/Button';
import Heading from '@enact/agate/Heading';
import Icon from '@enact/agate/Icon';
import Input from '@enact/agate/Input';
import Item from '@enact/agate/Item';
import RadioItem from '@enact/agate/RadioItem';
import Scroller from '@enact/agate/Scroller';
import SwitchItem from '@enact/agate/SwitchItem';
import ToggleButton from '@enact/agate/ToggleButton';
import VirtualList from '@enact/agate/VirtualList';
import ri from '@enact/ui/resolution';
import {
	RECENTLY_DELETED, daysLeft, shortDate, summarize,
	type Feature, type Note, type NotesApp, type SortOrder
} from '@phoenix/notes-core';
import {useState} from 'react';

import {PopupButton} from '../enact';

import css from './NoteList.module.less';

const FILTERS: {id: Feature; label: string}[] = [
	{id: 'checklist', label: 'Checklists'},
	{id: 'table', label: 'Tables'},
	{id: 'link', label: 'Links'},
	{id: 'code', label: 'Code'}
];

const SORTS: {id: SortOrder; label: string}[] = [
	{id: 'modified', label: 'Date Edited'},
	{id: 'created', label: 'Date Created'},
	{id: 'title', label: 'Title'}
];

interface Props {
	app: NotesApp;
	onEmptyDeleted: () => void;
	onFolderMenu?: () => void;
}

const NoteList = ({app, onEmptyDeleted, onFolderMenu}: Props) => {
	const [viewOpen, setViewOpen] = useState(false);
	const now = Date.now();
	const inDeleted = app.folderId === RECENTLY_DELETED;

	const row = (n: Note, extra: object = {}, context?: string) => {
		const {title, preview} = summarize(n.body);
		const when = inDeleted ? `${daysLeft(n, now)} days` : shortDate(n.modifiedAt, now);
		return (
			<Item
				key={n._id}
				{...extra}
				className={app.selected?._id === n._id ? css.selected : undefined}
				label={`${when}   ${context || preview}`}
				slotAfter={n.pinned ? <Icon size="small">star</Icon> : null}
				onClick={() => app.select(n._id)}
			>
				{title}
			</Item>
		);
	};

	const toggleFilter = (f: Feature) => {
		app.setFilters(app.filters.includes(f) ? app.filters.filter((x) => x !== f) : [...app.filters, f]);
	};

	const viewOptions = () => (
		<div className={css.viewOptions}>
			<Heading size="small">Sort By</Heading>
			{SORTS.map((s) => (
				<RadioItem key={s.id} selected={app.settings.sort === s.id} onToggle={() => app.updateSettings({sort: s.id})}>
					{s.label}
				</RadioItem>
			))}
			<SwitchItem selected={app.settings.groupByDate} onToggle={() => app.updateSettings({groupByDate: !app.settings.groupByDate})}>
				Group by Date
			</SwitchItem>
		</div>
	);

	let body;
	if (app.searching) {
		body = app.matches.length ? (
			<VirtualList
				className={css.list}
				dataSize={app.matches.length}
				itemSize={ri.scale(114)}
				itemRenderer={({index, ...rest}: {index: number}) => row(app.matches[index].note, rest, app.matches[index].context)}
			/>
		) : (
			<BodyText centered className={css.empty}>No Results</BodyText>
		);
	} else if (app.count === 0) {
		body = <BodyText centered className={css.empty}>No Notes</BodyText>;
	} else {
		body = (
			<Scroller className={css.list}>
				{app.sections.map((s) => (
					<section key={s.title || 'notes'}>
						{s.title ? <Heading size="small" className={css.section}>{s.title}</Heading> : null}
						{s.notes.map((n) => row(n))}
					</section>
				))}
				{inDeleted ? (
					<BodyText size="small" centered className={css.hint}>
						Notes are kept here for 30 days, then deleted.
					</BodyText>
				) : null}
			</Scroller>
		);
	}

	return (
		<div className={css.noteList}>
			<div className={css.header}>
				<div className={css.titles}>
					<Heading size="large" className={css.title}>{app.searching ? 'Search' : app.folderName(app.folderId)}</Heading>
					<BodyText size="small" className={css.subtitle}>
						{app.searching ? `${app.matches.length} found in All Notes` : `${app.count} ${app.count === 1 ? 'note' : 'notes'}`}
					</BodyText>
				</div>
				{onFolderMenu ? (
					<Button icon="ellipsis" size="small" backgroundOpacity="transparent" aria-label="Folder Options" onClick={onFolderMenu} />
				) : null}
				<PopupButton
					icon="controls"
					size="small"
					backgroundOpacity="transparent"
					aria-label="View Options"
					direction="below left"
					open={viewOpen}
					onClick={() => setViewOpen(!viewOpen)}
					onClose={() => setViewOpen(false)}
					popupComponent={viewOptions}
				/>
				{inDeleted ? (
					<Button size="small" disabled={app.count === 0} onClick={onEmptyDeleted}>Delete All</Button>
				) : (
					<Button icon="edit" size="small" backgroundOpacity="transparent" aria-label="New Note" onClick={() => void app.newNote()} />
				)}
			</div>
			<Input
				className={css.search}
				size="small"
				iconBefore="search"
				placeholder="Search"
				value={app.query}
				dismissOnEnter
				onChange={({value}: {value: string}) => app.setQuery(value)}
			/>
			<div className={css.filters}>
				{FILTERS.map((f) => (
					<ToggleButton
						key={f.id}
						size="small"
						selected={app.filters.includes(f.id)}
						onToggle={() => toggleFilter(f.id)}
						toggleOnLabel={f.label}
						toggleOffLabel={f.label}
					/>
				))}
			</div>
			{body}
		</div>
	);
};

export default NoteList;
