// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Folders, as Apple Notes' sidebar: All Notes, Notes, your folders and
// Recently Deleted, with counts.

import Button from '@enact/limestone/Button';
import Heading from '@enact/limestone/Heading';
import Icon from '@enact/limestone/Icon';
import Item from '@enact/limestone/Item';
import {Header, Panel} from '@enact/limestone/Panels';
import Scroller from '@enact/limestone/Scroller';
import {ALL_NOTES, DEFAULT_FOLDER, RECENTLY_DELETED, type NotesApp} from '@phoenix/notes-core';

import {MenuButton} from '../enact';

import css from './Sidebar.module.less';

interface Props {
	app: NotesApp;
	onSettings: () => void;
	onNewFolder: () => void;
	onRenameFolder: (id: string) => void;
	onDeleteFolder: (id: string) => void;
}

const Sidebar = ({app, onSettings, onNewFolder, onRenameFolder, onDeleteFolder}: Props) => {
	const row = (id: string, icon: string, title: string, menu?: boolean) => (
		<Item
			key={id}
			className={app.folderId === id ? css.selected : undefined}
			onClick={() => app.openFolder(id)}
			slotBefore={<Icon size="small">{icon}</Icon>}
			slotAfter={
				<div className={css.after}>
					<span className={css.count}>{app.counts[id] ?? 0}</span>
					{menu ? (
						<MenuButton
							icon="verticalellipsis"
							size="small"
							backgroundOpacity="transparent"
							aria-label={`${title} options`}
							direction="below"
							onClick={(ev: React.MouseEvent) => ev.stopPropagation()}
							menuItems={[
								{key: 'rename', children: 'Rename Folder', onClick: () => onRenameFolder(id)},
								{key: 'delete', children: 'Delete Folder', onClick: () => onDeleteFolder(id)}
							]}
						/>
					) : null}
				</div>
			}
		>
			{title}
		</Item>
	);

	return (
		<Panel className={css.sidebar}>
			<Header
				type="compact"
				title="Folders"
				noCloseButton
				noBackButton
				slotAfter={
					<Button icon="gear" size="small" backgroundOpacity="transparent" tooltipText="Settings" aria-label="Settings" onClick={onSettings} />
				}
			/>
			<div className={css.content}>
			<Scroller className={css.scroller}>
				<Heading size="tiny" className={css.section}>webOS Phoenix</Heading>
				{row(ALL_NOTES, 'list', 'All Notes')}
				{row(DEFAULT_FOLDER, 'folder', 'Notes')}
				{app.folders
					.slice()
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((f) => row(f._id, 'folder', f.name, true))}
				{row(RECENTLY_DELETED, 'trash', 'Recently Deleted')}
			</Scroller>
			<Button icon="plus" size="small" className={css.newFolder} onClick={onNewFolder}>
				New Folder
			</Button>
			</div>
		</Panel>
	);
};

export default Sidebar;
