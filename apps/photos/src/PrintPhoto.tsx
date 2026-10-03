// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Print (the viewer's app menu): the picture on a page of its own, as the
// webOS Photos app printed with Enyo's ImagePrintJob, through the print
// manager (com.palm.printmgr). The printer, copies and paper size are asked
// in @phoenix/ui's PrintDialog; with "Save as PDF" the page becomes a PDF in
// Documents, and the Print Manager lists the job.

import { useEffect, useState } from "react";
import { PAPER_SIZES, printManager, type MediaItem } from "@phoenix/luna";
import { PrintDialog, type PrintDialogPrinter } from "@phoenix/ui";

const SIZES = ["Photo_4x6", "Photo_5x7", "US_Letter", "ISO_A4"].map((v) => ({ label: PAPER_SIZES[v], value: v }));

export function PrintPhoto({ item, onClose, onDone }: { item: MediaItem; onClose: () => void; onDone: (text: string) => void }) {
    const [printers, setPrinters] = useState<PrintDialogPrinter[] | null>(null);
    const [printerId, setPrinterId] = useState("");
    const [copies, setCopies] = useState(1);
    const [size, setSize] = useState("Photo_4x6");
    const [progress, setProgress] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let gone = false;
        void Promise.all([printManager.printers(), printManager.current()]).then(([list, current]) => {
            if (gone) return;
            setPrinters(list.map((p) => ({ id: p.printerID, name: p.printerName })));
            setPrinterId(current?.printerID ?? list[0]?.printerID ?? "");
        }, () => { if (!gone) setPrinters([]); });
        return () => { gone = true; };
    }, []);

    const print = async () => {
        setError(null);
        setProgress("Image 1 of 1");
        try {
            await printManager.setCurrent(printerId).catch(() => undefined);
            const job = await printManager.printImages({ printerID: printerId, paths: [item.file_path], appName: "Photos",
                                                         description: item.title ?? "Photo", numCopies: copies, mediaSize: size });
            if (job.state !== "Done") throw new Error(job.errorText || "Unable to process print job.");
            onDone(job.file ? "Saved as " + job.file.replace(/^.*\//, "") : "Printed");
        } catch (e) {
            setProgress(null);
            setError((e as Error).message || "Unable to process print job.");
        }
    };

    return (
        <PrintDialog open printers={printers} printerId={printerId} onPrinter={setPrinterId}
                     copies={copies} onCopies={setCopies} sizes={SIZES} size={size} onSize={setSize}
                     progress={progress} error={error} onPrint={() => void print()} onCancel={onClose} />
    );
}
