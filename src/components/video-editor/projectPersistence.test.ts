import { describe, expect, it } from "vitest";

import { normalizeProjectEditor } from "./projectPersistence";

describe("normalizeProjectEditor", () => {
	it("preserves auto full-track clip metadata for reopened projects", () => {
		const normalized = normalizeProjectEditor({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			autoFullTrackClipId: "clip-1",
			autoFullTrackClipEndMs: 5_000,
		});

		expect(normalized.autoFullTrackClipId).toBe("clip-1");
		expect(normalized.autoFullTrackClipEndMs).toBe(5_000);
	});

	it("drops invalid auto full-track clip metadata", () => {
		const normalized = normalizeProjectEditor({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
			autoFullTrackClipId: 123 as unknown as string,
			autoFullTrackClipEndMs: Number.NaN,
		});

		expect(normalized.autoFullTrackClipId).toBeNull();
		expect(normalized.autoFullTrackClipEndMs).toBeNull();
	});
});