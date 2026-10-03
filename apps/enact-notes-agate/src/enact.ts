// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Enact's TypeScript definitions are generated from its JSDoc, and those
// for Enact 5.6 / Agate 3.3 have a few mistakes. The components are
// re-exported here with the props they really take, so the rest of the app
// type-checks strictly.

import ButtonBase from '@enact/agate/Button';
import ContextualPopupDecorator from '@enact/agate/ContextualPopupDecorator';
import DropdownBase from '@enact/agate/Dropdown';
import {TabbedPanels as TabbedPanelsBase} from '@enact/agate/Panels';
import SliderButtonBase from '@enact/agate/SliderButton';
import SpinnerBase from '@enact/agate/Spinner';
import ThemeDecoratorBase from '@enact/agate/ThemeDecorator';
import {Row as RowBase} from '@enact/ui/Layout';
import type {ComponentType, ReactNode} from 'react';

type Props<C> = C extends ComponentType<infer P> ? P : never;
type Loosen<C, K extends string, Extra = object> =
	ComponentType<Omit<Props<C>, K> & Partial<Pick<Props<C>, Extract<K, keyof Props<C>>>> & Extra>;
type Replace<C, K extends string, With> = ComponentType<Omit<Props<C>, K> & With>;

// Spinner: `component` is marked required (it is internal).
export const Spinner = SpinnerBase as unknown as Loosen<typeof SpinnerBase, 'component'>;

// A Button that opens a ContextualPopup.
export const PopupButton = ContextualPopupDecorator(ButtonBase);

// ui/Layout Row: children are typed as Cell instances, not elements.
export const Row = RowBase as unknown as Replace<typeof RowBase, 'children', {children?: ReactNode}>;

// Dropdown: `selected` (the chosen item's index) is typed as a boolean.
export const Dropdown = DropdownBase as unknown as Replace<typeof DropdownBase, 'selected' | 'onSelect', {
	selected?: number;
	onSelect?: (ev: {selected: number; data: string}) => void;
}>;

// SliderButton: `progressBarComponent` (internal) is marked required.
export const SliderButton = SliderButtonBase as unknown as Loosen<typeof SliderButtonBase, 'progressBarComponent'>;

// TabbedPanels: `onSelect` is merged with the DOM's onSelect event handler.
export const TabbedPanels = TabbedPanelsBase as unknown as Replace<typeof TabbedPanelsBase, 'onSelect', {
	onSelect?: (ev: {index: number}) => void;
}>;

// ThemeDecorator: Skinnable's `skinVariants` is left out of its props.
export const ThemeDecorator = <P extends object>(config: object, App: ComponentType<P>) =>
	ThemeDecoratorBase(config, App) as unknown as ComponentType<P & {skin?: string; accent?: string; highlight?: string; skinVariants?: string}>;
