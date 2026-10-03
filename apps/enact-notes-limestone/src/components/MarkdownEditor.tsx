// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// notes-core's Markdown editor in this theme's colours and type.

import {MarkdownEditor as Editor, type EditorHandle, type MarkdownEditorProps} from '@phoenix/notes-core';
import {forwardRef} from 'react';

import css from './MarkdownEditor.module.less';

export type {EditorHandle};

const MarkdownEditor = forwardRef<EditorHandle, Omit<MarkdownEditorProps, 'className'>>((props, ref) => (
	<Editor {...props} ref={ref} className={css.editor} />
));

MarkdownEditor.displayName = 'MarkdownEditor';

export default MarkdownEditor;
