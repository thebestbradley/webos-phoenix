// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'package:flutter/material.dart';

import '../model.dart';
import '../settings.dart';
import 'app.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final model = NotesScope.of(context);
    final s = model.settings;
    final theme = Theme.of(context);
    void set(Settings next) => model.updateSettings(next);

    Widget header(String text) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
          child: Semantics(
            header: true,
            child: Text(text, style: theme.textTheme.titleSmall?.copyWith(color: theme.colorScheme.primary)),
          ),
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          header('Appearance'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(value: ThemeMode.system, label: Text('Automatic'), icon: Icon(Icons.brightness_auto)),
                ButtonSegment(value: ThemeMode.light, label: Text('Light'), icon: Icon(Icons.light_mode_outlined)),
                ButtonSegment(value: ThemeMode.dark, label: Text('Dark'), icon: Icon(Icons.dark_mode_outlined)),
              ],
              selected: {s.themeMode},
              onSelectionChanged: (v) => set(s.copyWith(themeMode: v.first)),
            ),
          ),
          ListTile(
            title: const Text('Colour'),
            subtitle: const Text('Material 3 builds the scheme from one colour'),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final e in seeds.entries)
                  Semantics(
                    label: e.key,
                    selected: s.skin == e.key,
                    button: true,
                    child: InkResponse(
                      onTap: () => set(s.copyWith(skin: e.key)),
                      child: CircleAvatar(
                        radius: 20,
                        backgroundColor: e.value,
                        child: s.skin == e.key ? const Icon(Icons.check, color: Colors.white) : null,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          header('Viewing'),
          ListTile(
            title: const Text('Sort Notes By'),
            trailing: DropdownButton<SortOrder>(
              value: s.sort,
              underline: const SizedBox.shrink(),
              items: const [
                DropdownMenuItem(value: SortOrder.modified, child: Text('Date Edited')),
                DropdownMenuItem(value: SortOrder.created, child: Text('Date Created')),
                DropdownMenuItem(value: SortOrder.title, child: Text('Title')),
              ],
              onChanged: (v) => set(s.copyWith(sort: v)),
            ),
          ),
          SwitchListTile(
            title: const Text('Group Notes By Date'),
            value: s.groupByDate,
            onChanged: s.sort == SortOrder.title ? null : (v) => set(s.copyWith(groupByDate: v)),
          ),
          SwitchListTile(
            title: const Text('Open Notes in Preview'),
            value: s.openInPreview,
            onChanged: (v) => set(s.copyWith(openInPreview: v)),
          ),
          header('New Notes Start With'),
          RadioGroup<NewNoteStyle>(
            groupValue: s.newNoteStyle,
            onChanged: (v) => set(s.copyWith(newNoteStyle: v)),
            child: const Column(
              children: [
                RadioListTile(value: NewNoteStyle.title, title: Text('Title')),
                RadioListTile(value: NewNoteStyle.heading, title: Text('Heading')),
                RadioListTile(value: NewNoteStyle.body, title: Text('Body')),
              ],
            ),
          ),
          header('Text Size'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Text('A', style: TextStyle(fontSize: 13)),
                Expanded(
                  child: Slider(
                    value: s.textSize.toDouble(),
                    min: 80,
                    max: 160,
                    divisions: 8,
                    label: '${s.textSize}%',
                    onChanged: (v) => set(s.copyWith(textSize: v.round())),
                  ),
                ),
                const Text('A', style: TextStyle(fontSize: 22)),
              ],
            ),
          ),
          header('About'),
          const ListTile(title: Text('Framework'), trailing: Text('Flutter 3.47 (web, CanvasKit)')),
          const ListTile(
            subtitle: Text('Your notes are shared with the other Notes demos (Enact Limestone and Agate, Ionic).'),
          ),
        ],
      ),
    );
  }
}
