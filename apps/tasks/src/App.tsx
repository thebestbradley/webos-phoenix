// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tasks: to-do lists with due dates, priorities, notes and reminders, after
// the Tasks app of webOS 1.x, drawn in the webOS 2.x/3.x style.
//
// - Lists: Today, Upcoming and Overdue gather tasks from every list; below
//   them the user's lists (Inbox first, which cannot be deleted), grouped
//   by account when some sync with one (Synergy). Add a list from the
//   command menu; rename or delete it from the header menu.
// - Tasks: open tasks first, by due date and priority; tick one to
//   complete it (struck through), tap it to edit it. "Add a task" at the
//   top adds one at once (due today in Today, tomorrow in Upcoming). The
//   check button in the command menu hides completed tasks.
// - Tablet cards show the lists on the left and the tasks (or the task
//   being edited) on the right; phone cards show one at a time, and the
//   back gesture goes back.
//
// Launch params (TasksLaunchParams): {taskId, fromReminder?} opens a task,
// {text} starts a new one (Just Type's "New Task"), {reminder: taskId} is
// the reminder activity firing: the app posts a notification and stays
// where it is.

import { useEffect, useMemo, useRef, useState } from "react";
import { db, dueText, PRIORITY, tasks, type Task, type TaskInput, type TaskList, type TasksLaunchParams } from "@phoenix/luna";
import { useLaunchParams } from "@phoenix/luna/react";
import {
    BackProvider, Button, CheckBox, cx, Dialog, Divider, ErrorText, Glyph, Group, IconToolButton, PageHeader, PopupMenu, Row, Spinner,
    TextField, Toolbar, ToolSpacer, useBack, type Option,
} from "@phoenix/ui";
import { Editor } from "./Editor";
import { useLists, useNow, useTasks, useWide } from "./lib/hooks";
import {
    countTasks, defaultDue, isOverdue, launchText, loadPrefs, priorityMarks, savePrefs, selectionTitle, visibleTasks, VIEWS,
    type Prefs, type Selection,
} from "./lib/views";

type Sheet = { kind: "new-list" } | { kind: "rename-list"; list: TaskList } | { kind: "delete-list"; list: TaskList } | null;

const errorText = (e: unknown) => (e as { errorText?: string }).errorText ?? (e instanceof Error ? e.message : String(e));

function newTask(summary: string, sel: Selection | null, inboxId: string, lists: readonly TaskList[], now: number): TaskInput {
    const listId = sel?.kind === "list" ? sel.listId : inboxId;
    const due = sel ? defaultDue(sel, now) : null;
    return {
        summary, notes: "", due, allDay: due !== null, completed: false, priority: PRIORITY.none,
        listId, accountId: lists.find((l) => l._id === listId)?.accountId ?? "", remind: null,
    };
}

function TaskRow({ task, listName, now, onOpen, onToggle }: {
    task: Task; listName?: string; now: number; onOpen: () => void; onToggle: (v: boolean) => void;
}) {
    const marks = priorityMarks(task.priority);
    const late = isOverdue(task, now);
    const sub = [
        task.due && <span key="due" className={cx("tk-due", late && "late")}>{dueText(task, now)}</span>,
        listName && <span key="list">{listName}</span>,
        task.remind && task.remind > now && !task.completed && <span key="rem" className="tk-bell" aria-label="Reminder">&#x23F0;</span>,
        task.notes && <span key="notes" className="tk-notes-mark">{task.notes.split("\n")[0]}</span>,
    ].filter(Boolean);
    return (
        <div className={cx("pui-row", "tappable", "tk-task", task.completed && "completed")} role="button" tabIndex={0}
             data-testid={`task-${task.summary}`} onClick={onOpen}
             onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(); } }}>
            <div className="pui-row-icon">
                <CheckBox checked={task.completed} label={`Complete ${task.summary}`} testId={`check-${task.summary}`} onChange={onToggle} />
            </div>
            <div className="pui-row-body">
                <div className="pui-row-title">
                    {marks && <span className={cx("tk-prio", `p${marks.length}`)}>{marks}</span>}
                    <span className="tk-summary-text">{task.summary}</span>
                </div>
                {sub.length > 0 && <div className="pui-row-subtitle tk-sub">{sub}</div>}
            </div>
        </div>
    );
}

function ListNameDialog({ title, initial, action, onSubmit, onClose }: {
    title: string; initial: string; action: string; onSubmit: (name: string) => Promise<void>; onClose: () => void;
}) {
    const [name, setName] = useState(initial);
    const [error, setError] = useState("");
    const submit = async () => {
        const n = name.trim();
        if (!n) { setError("Give the list a name."); return; }
        try {
            await onSubmit(n);
            onClose();
        } catch (e) {
            setError(errorText(e));
        }
    };
    return (
        <Dialog open title={title} onClose={onClose} testId="list-dialog">
            <TextField value={name} onChange={(v) => { setName(v); setError(""); }} onSubmit={submit} autoFocus testId="list-name" />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="tk-dialog-buttons">
                <Button variant="affirmative" data-testid="list-ok" onClick={submit}>{action}</Button>
                <Button onClick={onClose}>Cancel</Button>
            </div>
        </Dialog>
    );
}

function TasksApp() {
    const lists = useLists();
    const all = useTasks();
    const now = useNow();
    const wide = useWide();
    const launch = useLaunchParams<TasksLaunchParams>();
    const [sel, setSel] = useState<Selection | null>(null);
    const [screen, setScreen] = useState<"lists" | "tasks">("lists");
    const [editing, setEditing] = useState<{ task: TaskInput; fromReminder?: boolean } | null>(null);
    const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
    const [sheet, setSheet] = useState<Sheet>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [quick, setQuick] = useState("");
    const [toast, setToast] = useState("");
    const [accounts, setAccounts] = useState<Record<string, string>>({});
    const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const handled = useRef<object | null>(null);

    const inbox = lists?.find((l) => l.isDefault) ?? lists?.[0];
    const current: Selection | null = sel ?? (inbox?._id ? { kind: "list", listId: inbox._id } : null);
    const currentList = current?.kind === "list" ? lists?.find((l) => l._id === current.listId) : undefined;
    const counts = useMemo(() => countTasks(all ?? [], now), [all, now]);
    const shown = useMemo(() => (current && all ? visibleTasks(all, current, { hideCompleted: prefs.hideCompleted, now }) : []),
        [all, current, prefs.hideCompleted, now]);

    const say = (text: string) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2500);
    };
    const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });
    const choose = (s: Selection) => { setSel(s); setEditing(null); setScreen("tasks"); };

    // A deleted list: back to the Inbox.
    useEffect(() => {
        if (lists && sel?.kind === "list" && !lists.some((l) => l._id === sel.listId)) setSel(null);
    }, [lists, sel]);

    // Names of the accounts lists sync with (Synergy); "" is this device.
    useEffect(() => {
        db.find<{ _kind: string; _id?: string; alias?: string; username?: string; templateId?: string }>({ from: "com.palm.account:1" })
            .then((acc) => setAccounts(Object.fromEntries(acc.map((a) => [a._id ?? "", a.alias || a.username || a.templateId || "Account"]))),
                  () => {});
    }, []);

    // Launch and relaunch params.
    useEffect(() => {
        if (handled.current === launch) return;
        handled.current = launch;
        if (launch.reminder) {
            void tasks.handleReminder(launch.reminder);
        } else if (launch.taskId) {
            const fromReminder = !!launch.fromReminder;
            void tasks.get(launch.taskId).then((t) => {
                if (!t) { say("That task was deleted."); return; }
                setSel({ kind: "list", listId: t.listId });
                setScreen("tasks");
                setEditing({ task: t, fromReminder });
            });
        } else if (typeof launch.text === "string") {
            const text = launchText(launch.text);
            void tasks.ensureInbox().then((ib) => {
                setScreen("tasks");
                setEditing({ task: newTask(text, null, ib._id!, [ib], Date.now()) });
            });
        }
    }, [launch]);

    useBack(() => { setScreen("lists"); return true; }, !wide && screen === "tasks" && !editing);

    const toggle = (t: Task, v: boolean) => { void tasks.setCompleted(t, v).catch((e) => say(errorText(e))); };
    const addQuick = async () => {
        const s = quick.trim();
        if (!s || !inbox?._id || !lists) return;
        setQuick("");
        await tasks.save(newTask(s, current, inbox._id, lists, Date.now()));
    };
    const openNew = () => {
        if (!inbox?._id || !lists) return;
        setScreen("tasks");
        setEditing({ task: newTask("", current, inbox._id, lists, Date.now()) });
    };

    if (!lists || !all || !current) {
        return <div className="tk-app"><div className="tk-loading"><Spinner large /></div></div>;
    }

    // ---- Lists ---------------------------------------------------------------------------

    const byAccount = new Map<string, TaskList[]>();
    for (const l of lists) byAccount.set(l.accountId || "", [...(byAccount.get(l.accountId || "") ?? []), l]);
    const listsPane = (
        <nav className="tk-lists" aria-label="Lists" data-testid="lists-pane">
            <PageHeader icon="icon.png" title="Tasks" />
            <div className="tk-scroll">
                <Group>
                    {VIEWS.map((v) => (
                        <Row key={v.id} title={v.title} value={String(counts[v.id])} testId={`view-${v.id}`}
                             className={cx("tk-list-row", current.kind === "view" && current.view === v.id && "current", v.id === "overdue" && counts.overdue > 0 && "late")}
                             onClick={() => choose({ kind: "view", view: v.id })} />
                    ))}
                </Group>
                {[...byAccount.entries()].map(([acc, ls]) => (
                    <div key={acc}>
                        <Divider caption={acc ? (accounts[acc] ?? "Account") : byAccount.size > 1 ? "On this device" : "Lists"} />
                        <Group>
                            {ls.map((l) => (
                                <Row key={l._id} title={l.name} value={String(counts.lists[l._id!] ?? 0)} testId={`list-${l.name}`}
                                     className={cx("tk-list-row", current.kind === "list" && current.listId === l._id && "current")}
                                     onClick={() => choose({ kind: "list", listId: l._id! })} />
                            ))}
                        </Group>
                    </div>
                ))}
            </div>
            <Toolbar>
                <ToolSpacer />
                <IconToolButton icon="plus" label="New List" testId="new-list" onClick={() => setSheet({ kind: "new-list" })} />
            </Toolbar>
        </nav>
    );

    // ---- Tasks ------------------------------------------------------------------------------

    const listNames = Object.fromEntries(lists.map((l) => [l._id!, l.name]));
    const menuOptions: Option<string>[] = [
        { label: prefs.hideCompleted ? "Show Completed" : "Hide Completed", value: "hide" },
        ...(currentList ? [
            { label: "Rename List", value: "rename" },
            { label: "Delete List", value: "delete", disabled: !!currentList.isDefault },
        ] : []),
    ];
    const onMenu = (v: string) => {
        if (v === "hide") setPrefs({ hideCompleted: !prefs.hideCompleted });
        else if (v === "rename" && currentList) setSheet({ kind: "rename-list", list: currentList });
        else if (v === "delete" && currentList) setSheet({ kind: "delete-list", list: currentList });
    };
    const hiddenCount = current && all ? visibleTasks(all, current, { hideCompleted: false, now }).length - shown.length : 0;

    const tasksPane = (
        <div className="tk-main" data-testid="tasks-pane">
            <PageHeader icon={wide ? undefined : "icon.png"} title={<span data-testid="list-title">{selectionTitle(current, lists)}</span>}>
                <button type="button" className="tk-menu-button" aria-label="Menu" data-testid="menu" onClick={(e) => setMenu(e.currentTarget)}>
                    <Glyph name="menu" size={22} />
                </button>
            </PageHeader>
            {!(current.kind === "view" && current.view === "overdue") && (
                <div className="tk-quick">
                    <span className="tk-quick-plus">+</span>
                    <input value={quick} placeholder="Add a task" data-testid="quick-add" onChange={(e) => setQuick(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addQuick(); } }} />
                </div>
            )}
            <div className="tk-scroll" data-testid="task-list">
                <div className="tk-list">
                    {shown.map((t) => (
                        <TaskRow key={t._id} task={t} now={now} listName={current.kind === "view" ? listNames[t.listId] : undefined}
                                 onOpen={() => setEditing({ task: t })} onToggle={(v) => toggle(t, v)} />
                    ))}
                </div>
                {shown.length === 0 && (
                    <div className="tk-empty" data-testid="empty">
                        {hiddenCount > 0 ? `${hiddenCount} completed task${hiddenCount === 1 ? "" : "s"} hidden.`
                            : current.kind === "view" && current.view === "overdue" ? "Nothing is overdue." : "No tasks."}
                    </div>
                )}
            </div>
            {toast && <div className="tk-toast" data-testid="toast">{toast}</div>}
            <Toolbar>
                <IconToolButton icon="check" label={prefs.hideCompleted ? "Show Completed" : "Hide Completed"} depressed={prefs.hideCompleted}
                                testId="hide-completed" onClick={() => setPrefs({ hideCompleted: !prefs.hideCompleted })} />
                <ToolSpacer />
                <IconToolButton icon="plus" label="New Task" testId="new-task" onClick={openNew} />
            </Toolbar>
        </div>
    );

    const editor = editing && (
        <Editor key={editing.task._id ?? "new"} task={editing.task} lists={lists} fromReminder={editing.fromReminder}
                onClose={() => setEditing(null)}
                onSave={async (t) => { await tasks.save(t); }}
                onDelete={async (t) => { await tasks.remove(t); say("Task deleted"); }}
                onSnooze={async (t) => { await tasks.snooze(t as Task); say("Reminder in 10 minutes"); }} />
    );

    return (
        <div className={cx("tk-app", wide && "wide")}>
            {(wide || screen === "lists") && listsPane}
            {(wide || screen === "tasks") && (editor || tasksPane)}
            {!wide && screen === "lists" && toast && <div className="tk-toast" data-testid="toast">{toast}</div>}

            {menu && <PopupMenu options={menuOptions} anchor={menu} onSelect={onMenu} onClose={() => setMenu(null)} />}
            {sheet?.kind === "new-list" && (
                <ListNameDialog title="New List" initial="" action="Create" onClose={() => setSheet(null)}
                                onSubmit={async (n) => { const id = await tasks.addList(n); choose({ kind: "list", listId: id }); }} />
            )}
            {sheet?.kind === "rename-list" && (
                <ListNameDialog title="Rename List" initial={sheet.list.name} action="Rename" onClose={() => setSheet(null)}
                                onSubmit={async (n) => { await tasks.renameList(sheet.list._id!, n); }} />
            )}
            {sheet?.kind === "delete-list" && (
                <Dialog open title="Delete List" testId="delete-list-dialog" onClose={() => setSheet(null)}
                        message={`Delete "${sheet.list.name}" and its ${counts.lists[sheet.list._id!] ?? 0} open task${counts.lists[sheet.list._id!] === 1 ? "" : "s"}?`}>
                    <div className="tk-dialog-buttons">
                        <Button variant="negative" data-testid="delete-list-confirm"
                                onClick={async () => {
                                    const l = sheet.list;
                                    setSheet(null);
                                    try {
                                        await tasks.deleteList(l._id!);
                                        setSel(null);
                                        say(`Deleted ${l.name}`);
                                    } catch (e) {
                                        say(errorText(e));
                                    }
                                }}>
                            Delete
                        </Button>
                        <Button onClick={() => setSheet(null)}>Cancel</Button>
                    </div>
                </Dialog>
            )}
        </div>
    );
}

export function App() {
    return (
        <BackProvider>
            <TasksApp />
        </BackProvider>
    );
}
