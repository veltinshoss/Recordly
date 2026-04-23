import { describe, expect, it } from "vitest";

import { resolveExportSourcePath } from "./exportSourcePath";

describe("resolveExportSourcePath", () => {
	it("prefers the loaded local source path over a preview media-server URL", () => {
		expect(
			resolveExportSourcePath({
				videoSourcePath: "C:\\Users\\Admin\\Videos\\recording.mp4",
				videoPath:
					"http://127.0.0.1:42637/video?path=C%3A%5CUsers%5CAdmin%5CVideos%5Crecording.mp4",
			}),
		).toBe("C:\\Users\\Admin\\Videos\\recording.mp4");
	});

	it("falls back to a decoded local file path when only a file URL is available", () => {
		expect(
			resolveExportSourcePath({
				videoPath: "file:///Users/test/Videos/capture.mp4",
			}),
		).toBe("/Users/test/Videos/capture.mp4");
	});

	it("leaves a non-file URL untouched when no local source path is known", () => {
		expect(
			resolveExportSourcePath({
				videoPath: "http://127.0.0.1:42637/video?path=%2Ftmp%2Fcapture.mp4",
			}),
		).toBe("http://127.0.0.1:42637/video?path=%2Ftmp%2Fcapture.mp4");
	});

	it("returns null when no export source is available", () => {
		expect(resolveExportSourcePath({})).toBeNull();
	});
});
