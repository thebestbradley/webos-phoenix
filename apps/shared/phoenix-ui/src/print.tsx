// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// PrintDialog: the print dialog of Enyo 1.0 (lib/printdialog, which the
// browser and Email use) for Phoenix apps: the same steps and words in a
// Mojo dialog. It shows the printers ("Locating Printers..." until they
// are known, "No printers are currently available." when there are none),
// the chosen one with its options (Number of Copies, Size), and Cancel /
// Print; while the job runs, "Preparing to print..." and the page. The app
// does the printing (@phoenix/luna's printManager); this only asks.

import { useState } from "react";
import { Checkmark, Group, Note, Row } from "./layout";
import { Button, Spinner } from "./controls";
import { Dialog, ListSelector, type Option } from "./popups";

export interface PrintDialogPrinter {
    id: string;
    name: string;
}

export interface PrintDialogProps {
    open: boolean;
    /** null while they are being found. */
    printers: PrintDialogPrinter[] | null;
    printerId: string;
    onPrinter: (id: string) => void;
    copies: number;
    onCopies: (n: number) => void;
    /** Highest number of copies offered (Enyo's copiesRange.max). */
    maxCopies?: number;
    /** Paper sizes, when the app lets the user choose (Enyo's mediaSizeOption). */
    sizes?: Option<string>[];
    size?: string;
    onSize?: (size: string) => void;
    /** The job is running: its progress text ("Image 1 of 2"). */
    progress?: string | null;
    /** Why it did not print. */
    error?: string | null;
    onPrint: () => void;
    onCancel: () => void;
}

export function PrintDialog(p: PrintDialogProps) {
    const [choosing, setChoosing] = useState(false);
    const printer = p.printers?.find((x) => x.id === p.printerId) ?? null;
    const showList = choosing || !printer;
    const copies: Option<number>[] = Array.from({ length: p.maxCopies ?? 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
    const title = p.progress ? "Preparing to print..." : showList && p.printers?.length ? "Select a Printer" : "Print";
    return (
        <Dialog open={p.open} title={title} onClose={p.progress ? undefined : p.onCancel} testId="print-dialog">
            {p.progress ? (
                <div className="pui-print-progress">
                    <Spinner />
                    <span data-testid="print-progress">{p.progress}</span>
                </div>
            ) : showList ? (
                p.printers === null ? (
                    <div className="pui-print-progress"><Spinner /><span>Locating Printers...</span></div>
                ) : p.printers.length === 0 ? (
                    <Note>No printers are currently available.</Note>
                ) : (
                    <Group>
                        {p.printers.map((x) => (
                            <Row key={x.id} title={x.name} testId={"print-printer-" + x.id}
                                 onClick={() => { p.onPrinter(x.id); setChoosing(false); }}>
                                {x.id === p.printerId && <Checkmark />}
                            </Row>
                        ))}
                    </Group>
                )
            ) : (
                <Group>
                    <Row title={printer!.name} className="pui-print-printer" />
                    <ListSelector title="Number of Copies" value={p.copies} options={copies} onChange={p.onCopies} testId="print-copies" />
                    {p.sizes && p.sizes.length > 0 && p.onSize && (
                        <ListSelector title="Size" value={p.size ?? p.sizes[0].value} options={p.sizes} onChange={p.onSize} testId="print-size" />
                    )}
                    <Row title="Select Another Printer" chevron onClick={() => setChoosing(true)} testId="print-another" />
                </Group>
            )}
            {p.error && !p.progress && <Note testId="print-error">{p.error}</Note>}
            {!p.progress && (
                <div className="pui-print-buttons">
                    <Button onClick={p.onCancel} data-testid="print-cancel">Cancel</Button>
                    <Button variant="affirmative" disabled={!printer || showList} onClick={p.onPrint} data-testid="print-go">Print</Button>
                </div>
            )}
        </Dialog>
    );
}
