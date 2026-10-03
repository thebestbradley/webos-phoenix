// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Print Manager (com.palm.app.printmanager on webOS, here
// org.webosphoenix.printmanager): the print jobs and the printers of the
// print manager, com.palm.printmgr.
//
// - Print Jobs: what is printing (with Cancel) and what was printed, newest
//   first. A job printed to "Save as PDF" became a PDF in Documents; tap it
//   to open it. Clear Finished Jobs (app menu) forgets the finished ones;
//   their PDFs stay.
// - Printers: the printers there are, the current one checked (the print
//   dialog starts with it). Add a Printer says what a network printer needs.
//
// Prints start in the apps (Web, Email: Print in the app menu), in
// Enyo 1.0's print dialog. While a job prints it is an ongoing activity in
// the notification area (as the original Print Manager's status
// dashboard); a tap on it, or on "Saved as PDF", opens this app with
// {jobID}, and that job is shown.

import { useEffect, useRef, useState } from "react";
import { call, jobStateText, printManager, type PrintJob, type Printer } from "@phoenix/luna";
import { useLaunchParams, useLuna } from "@phoenix/luna/react";
import { AppMenu, Button, Checkmark, Dialog, Divider, FileIcon, Group, Note, Page, PageHeader, Row, Spinner, shortWhen } from "@phoenix/ui";
import { finishedJobs, jobSource, jobTitle, orderJobs } from "./jobs";

export function App() {
    const launch = useLaunchParams<{ jobID?: string }>();
    const jobs = useLuna<PrintJob[]>((cb, err) => printManager.watchJobs(cb, err), []).value ?? [];
    const [printers, setPrinters] = useState<Printer[]>([]);
    const [current, setCurrent] = useState("");
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState("");
    const shown = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        void printManager.printers().then(setPrinters).catch(() => setPrinters([]));
        void printManager.current().then((p) => setCurrent(p?.printerID ?? ""));
    }, []);
    // The job a notification was about, in view.
    useEffect(() => {
        if (launch.jobID) shown.current?.scrollIntoView({ block: "center" });
    }, [launch.jobID, jobs.length]);

    const open = (job: PrintJob) => {
        if (job.state === "Done" && job.file)
            void call("luna://com.palm.applicationManager/open", { target: job.file })
                .catch(() => setError(`Could not open ${job.file.replace(/^.*\//, "")}`));
    };
    const cancel = (job: PrintJob) => { void printManager.cancel(job.jobID).catch(() => undefined); };
    const clearFinished = () => {
        void Promise.all(finishedJobs(jobs).map((j) => printManager.remove(j.jobID).catch(() => undefined)));
    };
    const choose = (p: Printer) => {
        setCurrent(p.printerID);
        void printManager.setCurrent(p.printerID).catch(() => undefined);
    };

    const ordered = orderJobs(jobs);
    return (
        <Page>
            <PageHeader title="Print Manager" icon="icon.png" />
            <Divider caption="Print Jobs" />
            {ordered.length ? (
                <Group>
                    {ordered.map((job) => (
                        <div key={job.jobID} ref={job.jobID === launch.jobID ? shown : undefined}
                             className={job.jobID === launch.jobID ? "pm-shown" : undefined}>
                            <Row testId={"job-" + job.jobID}
                                 icon={<FileIcon kind="pdf" />}
                                 title={jobTitle(job)}
                                 subtitle={<>
                                     <span className="pm-source">{jobSource(job)} {"·"} {shortWhen(job.finished || job.created)}</span>
                                     <span className={"pm-state pm-" + job.state.toLowerCase()}>{jobStateText(job)}</span>
                                 </>}
                                 chevron={job.state === "Done" && !!job.file}
                                 onClick={job.state === "Done" && job.file ? () => open(job) : undefined}>
                                {job.state === "Printing" && (
                                    <span className="pm-printing">
                                        <Spinner label="Printing" />
                                        <Button className="pm-cancel" onClick={(e) => { e.stopPropagation(); cancel(job); }}>Cancel</Button>
                                    </span>
                                )}
                            </Row>
                        </div>
                    ))}
                </Group>
            ) : (
                <Note testId="no-jobs">No print jobs. To print, choose Print in the menu of Web or Email, then Save as PDF.</Note>
            )}
            {error && <Note>{error}</Note>}
            <Divider caption="Printers" />
            <Group>
                {printers.map((p) => (
                    <Row key={p.printerID} testId={"printer-" + p.printerID} title={p.printerName}
                         subtitle={p.printerAddress ? "Saves to " + p.printerAddress.replace(/^\/media\/internal\/?/, "") : undefined}
                         onClick={() => choose(p)}>
                        {p.printerID === current && <Checkmark />}
                    </Row>
                ))}
                <Row title="Add a Printer" chevron onClick={() => setAdding(true)} testId="add-printer" />
            </Group>
            <Dialog open={adding} title="Add a Printer" onClose={() => setAdding(false)} testId="add-printer-dialog"
                    message="Network printers (IPP Everywhere, through CUPS) come with the device's print service. This simulator has none: print with Save as PDF.">
                <Button onClick={() => setAdding(false)}>OK</Button>
            </Dialog>
            <AppMenu items={[
                { label: "Clear Finished Jobs", onSelect: clearFinished, disabled: finishedJobs(jobs).length === 0 },
            ]} />
        </Page>
    );
}
