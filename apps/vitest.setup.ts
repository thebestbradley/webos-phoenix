// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Testing Library unmounts what a test rendered only by itself when the test
// API is global; ours is imported (no `globals`), so every test file gets the
// cleanup here. Without it a page stays mounted on the runtime's
// subscriptions and React can still be working once jsdom is torn down.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
