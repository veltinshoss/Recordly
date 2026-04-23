import { fromFileUrl } from "./projectPersistence";

type ExportSourceOptions = {
	videoSourcePath?: string | null;
	videoPath?: string | null;
};

/**
 * Prefer the real local source path for export so the exporter can read the file
 * directly instead of going back through the preview media-server URL.
 */
export function resolveExportSourcePath(options: ExportSourceOptions): string | null {
	if (options.videoSourcePath) {
		return options.videoSourcePath;
	}

	if (!options.videoPath) {
		return null;
	}

	return fromFileUrl(options.videoPath);
}
