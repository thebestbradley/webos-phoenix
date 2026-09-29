// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Enact's TypeScript definitions are generated from its JSDoc, and those
// for Enact 5.6 / Limestone 1.11 have a few mistakes. The components are
// re-exported here with the props they really take, so the rest of the app
// type-checks strictly:
//   - Spinner: `component` is marked required (it is internal).
//   - ContextualMenuDecorator: `popupComponent` is marked required (it is
//     the decorator's config, not a prop).
//   - PopupTabLayout: `onClose` (Popup's) is left out; Tab's `tabKey` is
//     marked required (PopupTabLayout sets it).
//   - ui/Layout Row: children are typed as Cell instances, not elements.

import ButtonBase from '@enact/limestone/Button';
import ContextualMenuDecorator from '@enact/limestone/ContextualMenuDecorator';
import PopupTabLayoutBase, {Tab as TabBase} from '@enact/limestone/PopupTabLayout';
import SpinnerBase from '@enact/limestone/Spinner';
import {Row as RowBase} from '@enact/ui/Layout';
import type {ComponentType, ReactNode} from 'react';

type Props<C> = C extends ComponentType<infer P> ? P : never;
type Loosen<C, K extends string, Extra = object> =
	ComponentType<Omit<Props<C>, K> & Partial<Pick<Props<C>, Extract<K, keyof Props<C>>>> & Extra>;
type Replace<C, K extends string, With> = ComponentType<Omit<Props<C>, K> & With>;

export const Spinner = SpinnerBase as unknown as Loosen<typeof SpinnerBase, 'component'>;

const MenuButtonBase = ContextualMenuDecorator(ButtonBase);
export const MenuButton = MenuButtonBase as unknown as Loosen<typeof MenuButtonBase, 'popupComponent'>;

export const PopupTabLayout = PopupTabLayoutBase as unknown as Loosen<typeof PopupTabLayoutBase, never, {onClose?: () => void}>;
export const Tab = TabBase as unknown as Loosen<typeof TabBase, 'tabKey'>;

export const Row = RowBase as unknown as Replace<typeof RowBase, 'children', {children?: ReactNode}>;
