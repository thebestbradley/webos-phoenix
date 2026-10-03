// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor, MarkdownPreview } from "./components";

describe("MarkdownPreview", () => {
    it("reports task boxes and links instead of following them", () => {
        const onToggleTask = vi.fn();
        const onOpenLink = vi.fn();
        const { container } = render(
            <MarkdownPreview source={"- [ ] a\n- [ ] b\n\n<https://x.org>"} textSize={100} onToggleTask={onToggleTask} onOpenLink={onOpenLink} />,
        );
        fireEvent.click(container.querySelector('input[data-task="1"]')!);
        expect(onToggleTask).toHaveBeenCalledWith(1);
        fireEvent.click(container.querySelector("a")!);
        expect(onOpenLink).toHaveBeenCalledWith("https://x.org");
    });
});

describe("MarkdownEditor", () => {
    function Harness({ start }: { start: string }) {
        const [text, setText] = useState(start);
        return <MarkdownEditor value={text} onChange={setText} textSize={100} />;
    }

    it("continues a checklist on Enter and nests it on Tab", () => {
        const { container } = render(<Harness start="- [x] milk" />);
        const area = container.querySelector("textarea")!;
        area.setSelectionRange(10, 10);
        fireEvent.keyDown(area, { key: "Enter" });
        expect(area.value).toBe("- [x] milk\n- [ ] ");
        fireEvent.keyDown(area, { key: "Tab" });
        expect(area.value).toBe("- [x] milk\n    - [ ] ");
    });

    it("makes the selection bold with Ctrl+B", () => {
        const { container } = render(<Harness start="say hi" />);
        const area = container.querySelector("textarea")!;
        area.setSelectionRange(4, 6);
        fireEvent.keyDown(area, { key: "b", ctrlKey: true });
        expect(area.value).toBe("say **hi**");
        expect([area.selectionStart, area.selectionEnd]).toEqual([6, 8]);
    });
});
