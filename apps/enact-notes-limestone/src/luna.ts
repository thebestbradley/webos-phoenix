// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Luna calls through Enact's own LS2Request (@enact/webos).

import LS2Request from '@enact/webos/LS2Request';
import {ls2Transport, type Ls2RequestLike} from '@phoenix/notes-core';

export const luna = ls2Transport(LS2Request as unknown as new () => Ls2RequestLike);

/** Opens a link in the browser (applicationManager picks the handler). */
export function openLink (url: string): void {
	void luna.call('luna://com.webos.applicationManager/open', {target: url}).catch(() => {});
}
