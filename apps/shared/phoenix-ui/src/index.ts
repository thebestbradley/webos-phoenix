// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/ui: React components with the classic webOS look. Import
// "@phoenix/ui/styles.css" once in the app's entry point.

export { Page, PageHeader, Group, Row, Divider, Note, ErrorText, Checkmark, cx, iconSrcSet } from "./layout";
export type { PageProps, PageHeaderProps, GroupProps, RowProps } from "./layout";
export { ToggleButton, Slider, Button, Spinner, TextField, CheckBox } from "./controls";
export type { ToggleButtonProps, SliderProps, ButtonProps, ButtonVariant, TextFieldProps, CheckBoxProps } from "./controls";
export { PopupMenu, ListSelector, Picker, Drawer, DividerDrawer, Dialog, DRAWER_OPEN_MS, DRAWER_CLOSE_MS, DIALOG_SLIDE_MS } from "./popups";
export { motion, motionScale } from "./motion";
export type { Option, PopupMenuProps, ListSelectorProps, PickerProps, DrawerProps, DialogProps } from "./popups";
export { icons, art, srcSet, cssImage } from "./assets";
export { Dialpad, DialButton, BackspaceButton, ToolBar, RadioToolGroup, ToolButton, Avatar, DIALPAD_KEYS, phoneArt } from "./telephony";
export type { DialpadProps, DialButtonProps, ToolOption, RadioToolGroupProps, ToolButtonProps } from "./telephony";
export { BackProvider, useBack } from "./back";
export { FileIcon } from "./fileicon";
export type { FileIconKind } from "./fileicon";
export { AppMenu, useAppMenuToggle } from "./appmenu";
export type { AppMenuItem, AppMenuProps } from "./appmenu";
export { formatNumber, dialable, formatDuration, formatTime, daysAgo, dayLabel, shortWhen } from "./format";
export { Glyph, Toolbar, ToolSpacer, IconToolButton, GroupedToolButtons, formatSeconds } from "./media";
export type { GlyphName, ToolbarProps, IconToolButtonProps, GroupedToolButtonsProps } from "./media";
export { PrintDialog } from "./print";
export type { PrintDialogProps, PrintDialogPrinter } from "./print";
export { SlidingPanes, GrabButton, PaneHeader, PaneToolbar, Swipeable, ContextMenu, useMultiView, useLongPress,
         MULTI_VIEW_MIN_WIDTH, LIST_PANE_WIDTH, LONG_PRESS_MS } from "./panes";
export type { SlidingPanesProps, PaneView, ContextMenuItem } from "./panes";
