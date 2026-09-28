// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/ui: React components with the classic webOS look. Import
// "@phoenix/ui/styles.css" once in the app's entry point.

export { Page, PageHeader, Group, Row, Divider, Note, ErrorText, Checkmark, cx } from "./layout";
export type { PageProps, PageHeaderProps, GroupProps, RowProps } from "./layout";
export { ToggleButton, Slider, Button, Spinner, TextField } from "./controls";
export type { ToggleButtonProps, SliderProps, ButtonProps, ButtonVariant, TextFieldProps } from "./controls";
export { PopupMenu, ListSelector, Picker, Drawer, DividerDrawer, Dialog } from "./popups";
export type { Option, PopupMenuProps, ListSelectorProps, PickerProps, DrawerProps, DialogProps } from "./popups";
export { icons } from "./assets";
export { Dialpad, DialButton, BackspaceButton, ToolBar, RadioToolGroup, ToolButton, Avatar, DIALPAD_KEYS, phoneArt } from "./telephony";
export type { DialpadProps, DialButtonProps, ToolOption, RadioToolGroupProps, ToolButtonProps } from "./telephony";
export { BackProvider, useBack } from "./back";
export { formatNumber, dialable, formatDuration, formatTime, daysAgo, dayLabel, shortWhen } from "./format";
