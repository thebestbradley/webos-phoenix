# @phoenix/react

React hooks for the Phoenix service plugin (`@phoenix/sdk`): `useBack`,
`useAppMenu` / `<AppMenu>`, `useLaunchParams`, `useShareReceiver`,
`useJustTypeAction`, `useAssistantCommand`, `useWatch`, `usePromise`,
`useActive`, `useStageReady`, `usePhoenixTheme`, `useRefresh`.

```tsx
function App() {
    useBack(() => closeNote(), noteOpen);
    useAppMenu({ items: [{ label: "New Note", onSelect: newNote }], share: () => ({ text: note.body }) });
    return <Notes />;
}
```

Guide: [docs/APP-SDK.md](../../../docs/APP-SDK.md) (5.1). Apache-2.0.
