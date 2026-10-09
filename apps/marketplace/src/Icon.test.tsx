// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Marketplace's icons: the addresses in order, then the app's initial;
// never an empty square.

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { colourOf, Icon, initialOf } from "./Icon";

describe("Marketplace icons", () => {
    it("tries the app's own icon, then the catalog's, then shows its initial", () => {
        const { container, rerender } = render(<Icon src={["/usr/palm/applications/box/icon.png", "http://catalog/v1/icons/copy/box-0"]} title="Box" />);
        const img = () => container.querySelector("img");
        expect(img()!.getAttribute("src")).toBe("/usr/palm/applications/box/icon.png");
        fireEvent.error(img()!);
        expect(img()!.getAttribute("src")).toBe("http://catalog/v1/icons/copy/box-0");
        fireEvent.error(img()!);
        expect(img()).toBeNull();
        expect(container.querySelector(".mk-icon")!.getAttribute("data-icon")).toBe("initial");
        expect(container.textContent).toBe("B");
        // New addresses: tried again from the first.
        rerender(<Icon src={["/usr/palm/applications/box/icon-2.png"]} title="Box" />);
        expect(img()!.getAttribute("src")).toBe("/usr/palm/applications/box/icon-2.png");
    });

    it("skips addresses that are not there, and has an initial for no address at all", () => {
        const { container } = render(<Icon src={[undefined, "", "http://catalog/x.png"]} title="Maps" />);
        expect(container.querySelector("img")!.getAttribute("src")).toBe("http://catalog/x.png");
        const none = render(<Icon src="" title="  quickoffice" />);
        expect(none.container.textContent).toBe("Q");
        expect(initialOf("")).toBe("?");
        expect(colourOf("Tailscale")).toBe(colourOf("Tailscale"));
    });
});
