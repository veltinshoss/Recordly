import { describe, expect, it } from "vitest";

import { appendSyncedAudioFilter, getAudioSyncAdjustment } from "./filters";

describe("getAudioSyncAdjustment", () => {
	it("does not speed up longer audio tracks that would advance speech", () => {
		expect(getAudioSyncAdjustment(120, 122.5)).toEqual({
			mode: "none",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: -2500,
		});
	});

	it("still stretches slightly shorter audio tracks to match the video", () => {
		expect(getAudioSyncAdjustment(120, 117)).toEqual({
			mode: "tempo",
			delayMs: 0,
			tempoRatio: 0.975,
			durationDeltaMs: 3000,
		});
	});

	it("still delays much shorter audio tracks instead of extreme tempo correction", () => {
		expect(getAudioSyncAdjustment(120, 110)).toEqual({
			mode: "delay",
			delayMs: 10000,
			tempoRatio: 1,
			durationDeltaMs: 10000,
		});
	});

	it("does not inject atempo when longer audio stays on the anchored path", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(120, 122.5));

		expect(filterParts).toEqual([
			"[1:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});

	it("still injects atempo for slightly shorter audio tracks", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(120, 117));

		expect(filterParts).toEqual([
			"[1:a]atempo=0.975000,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});

	it("anchors and pads at end when the duration delta exceeds the delay cap (long recording case)", () => {
		// Reporter case in issue #252: 10-min video with audio probed as ~8 min.
		// Previously this returned mode "delay" with delayMs 120000, prepending
		// 2 minutes of leading silence via `adelay`. That is jarring on long
		// recordings. Above the cap we anchor at the start instead.
		expect(getAudioSyncAdjustment(600, 480)).toEqual({
			mode: "pad",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: 120000,
		});
	});

	it("anchors and pads at end when delta is just over the delay cap", () => {
		// 35-second short on a 10-min recording — the earlier symptom on issue
		// #252 before the regression to ~2 min. Above the 15s cap, anchor.
		expect(getAudioSyncAdjustment(600, 565)).toEqual({
			mode: "pad",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: 35000,
		});
	});

	it("keeps the existing delay branch for moderately short audio at the cap boundary", () => {
		// Boundary: 15-second short stays in delay mode (cap is strictly >).
		expect(getAudioSyncAdjustment(120, 105)).toEqual({
			mode: "delay",
			delayMs: 15000,
			tempoRatio: 1,
			durationDeltaMs: 15000,
		});
	});

	it("emits apad with trailing silence for the pad mode instead of leading adelay", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(600, 480));

		expect(filterParts).toEqual([
			"[1:a]apad=pad_dur=120.000,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});
});
