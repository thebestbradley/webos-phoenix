// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// notes-core's Markdown preview in this theme's colours and type; links
// open in the browser.

import {MarkdownPreview as Preview, type MarkdownPreviewProps} from '@phoenix/notes-core';

import {openLink} from '../luna';

import css from './MarkdownPreview.module.less';

const MarkdownPreview = (props: Omit<MarkdownPreviewProps, 'className' | 'onOpenLink'>) => (
	<Preview {...props} className={css.preview} onOpenLink={openLink} />
);

export default MarkdownPreview;
