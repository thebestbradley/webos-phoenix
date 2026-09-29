// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The open folder's notes in Apple Notes' date sections, or search results
// across all notes (a VirtualList), with filter chips.

import Button from '@enact/limestone/Button';
import {Chip, Chips} from '@enact/limestone/Chips';
import Heading from '@enact/limestone/Heading';
import Icon from '@enact/limestone/Icon';
import {InputField} from '@enact/limestone/Input';
import Item from '@enact/limestone/Item';
import {Header, Panel} from '@enact/limestone/Panels';
import Scroller from '@enact/limestone/Scroller';
import VirtualList from '@enact/limestone/VirtualList';
import BodyText from '@enact/limestone/BodyText';
import ri from '@enact/ui/resolution';
import {
	RECENTLY_DELETED, daysLeft, shortDate, summarize,
	type Feature, type Note, type NotesApp, type SortOrder
} from '@phoenix/notes-core';
import {useState} from 'react';

import {MenuButton} from '../enact';

import css from './NoteList.module.less';

const FILTERS: {id: Feature; label: string; icon: string}[] = [
	{id: 'checklist', label: 'Checklists', icon: 'check'},
	{id: 'table', label: 'Tables', icon: 'index'},
	{id: 'link', label: 'Links', icon: 'link'},
	{id: 'code', label: 'Code', icon: 'textinput'}
];

const SORTS: {id: SortOrder; label: string}[] = [
	{id: 'modified', label: 'Date Edited'},
	{id: 'created', label: 'Date Created'},
	{id: 'title', label: 'Title'}
];

interface Props {
	app: NotesApp;
	foldersShown: boolean;
	onToggleFolders: () => void;
	onEmptyDeleted: () => void;
}

const NoteList = ({app, foldersShown, onToggleFolders, onEmptyDeleted}: Props) => {
	const [searchOpen, setSearchOpen] = useState(false);
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
				slotAfter={n.pinned ? <Icon size="tiny">star</Icon> : null}
				onClick={() => app.select(n._id)}
			>
				{title}
			</Item>
		);
	};

	const sortMenu: {key: string; children: string; onClick: () => void}[] = SORTS.map((s) => ({
		key: s.id as string,
		children: (app.settings.sort === s.id ? '✓ ' : '') + 'Sort by ' + s.label,
		onClick: () => app.updateSettings({sort: s.id})
	})).concat([{
		key: 'group',
		children: (app.settings.groupByDate ? '✓ ' : '') + 'Group by Date',
		onClick: () => app.updateSettings({groupByDate: !app.settings.groupByDate})
	}]);

	const toggleFilter = (f: Feature) => {
		app.setFilters(app.filters.includes(f) ? app.filters.filter((x) => x !== f) : [...app.filters, f]);
	};

	let body;
	if (app.searching) {
		body = app.matches.length ? (
			<VirtualList
				className={css.list}
				dataSize={app.matches.length}
				itemSize={ri.scale(186)}
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
						{s.title ? <Heading size="tiny" className={css.section}>{s.title}</Heading> : null}
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
		<Panel className={css.noteList}>
			<Header
				type="compact"
				title={app.searching ? 'Search' : app.folderName(app.folderId)}
				subtitle={app.searching ? `${app.matches.length} found in All Notes` : `${app.count} ${app.count === 1 ? 'note' : 'notes'}`}
				noCloseButton
				noBackButton
				slotBefore={
					<Button
						icon={foldersShown ? 'arrowlargeleft' : 'folder'}
						size="small"
						backgroundOpacity="transparent"
						tooltipText={foldersShown ? 'Hide Folders' : 'Folders'} aria-label={foldersShown ? 'Hide Folders' : 'Folders'}
						onClick={onToggleFolders}
					/>
				}
				slotAfter={
					<>
						<MenuButton
							icon="filter"
							size="small"
							backgroundOpacity="transparent"
							tooltipText="View Options" aria-label="View Options"
							direction="below"
							menuItems={sortMenu}
						/>
						{inDeleted ? (
							<Button size="small" disabled={app.count === 0} onClick={onEmptyDeleted}>Delete All</Button>
						) : (
							<Button icon="edit" size="small" backgroundOpacity="transparent" tooltipText="New Note" aria-label="New Note" onClick={() => void app.newNote()} />
						)}
					</>
				}
			/>
			<div className={css.content}>
			<InputField
				className={css.search}
				size="small"
				iconBefore="search"
				placeholder="Search"
				value={app.query}
				dismissOnEnter
				onClick={() => setSearchOpen(true)}
				onChange={({value}: {value: string}) => app.setQuery(value)}
			/>
			{searchOpen || app.searching ? (
				<div className={css.chips}>
					<Chips orientation="horizontal" className={css.chipRow}>
						{FILTERS.map((f) => (
							<Chip key={f.id} id={f.id} icon={f.icon} checked={app.filters.includes(f.id)} onClick={() => toggleFilter(f.id)}>
								{f.label}
							</Chip>
						))}
					</Chips>
					<Button
						size="small"
						backgroundOpacity="transparent"
						onClick={() => { app.setQuery(''); app.setFilters([]); setSearchOpen(false); }}
					>
						Cancel
					</Button>
				</div>
			) : null}
			{body}
			</div>
		</Panel>
	);
};

export default NoteList;
