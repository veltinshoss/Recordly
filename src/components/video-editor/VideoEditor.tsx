import {
	Check,
	CaretDown as ChevronDown,
	CaretUp as ChevronUp,
	ClosedCaptioning,
	Crop,
	Cursor,
	DownloadSimple as Download,
	FolderOpen,
	Gear,
	Pause,
	Camera as PhCameraRegular,
	Play,
	Plus,
	PuzzlePiece,
	ArrowClockwise as Redo2,
	FloppyDisk as Save,
	Scissors,
	SkipBack,
	SkipForward,
	Sparkle,
	ArrowCounterClockwise as Undo2,
	UserCircle as User,
	SpeakerLow as Volume1,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
	MagicWand as WandSparkles,
	X,
	MagnifyingGlassPlus as ZoomIn,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	calculateOutputDimensions,
	DEFAULT_MP4_CODEC,
	type ExportMp4FrameRate,
	type ExportProgress,
	FrameRenderer,
	GIF_SIZE_PRESETS,
	probeSupportedMp4Dimensions,
	type SupportedMp4Dimensions,
} from "@/lib/exporter";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	ASPECT_RATIOS,
	getAspectRatioLabel,
	getAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { ExtensionIcon } from "./ExtensionIcon";

const PhCursorFill = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Cursor weight="fill" className={props.className} />
);
const PhCamera = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<PhCameraRegular weight={props.weight ?? "regular"} className={props.className} />
);
const PhCaptions = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<ClosedCaptioning weight={props.weight ?? "regular"} className={props.className} />
);
const PhPuzzle = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<PuzzlePiece weight={props.weight ?? "regular"} className={props.className} />
);
const PhSparkle = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Sparkle weight={props.weight ?? "regular"} className={props.className} />
);
const PhSettings = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Gear weight={props.weight ?? "regular"} className={props.className} />
);

import { extensionHost } from "@/lib/extensions";
import { CropControl } from "./CropControl";
import { ExportSettingsMenu } from "./ExportSettingsMenu";
import ExtensionManager from "./ExtensionManager";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { useEditorAudioSync } from "./hooks/useEditorAudioSync";
import { useEditorCaptions } from "./hooks/useEditorCaptions";
import { useEditorCursorTelemetry } from "./hooks/useEditorCursorTelemetry";
import type { EditorHistorySnapshot } from "./hooks/useEditorHistory";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useEditorExport, type RenderConfig } from "./hooks/useEditorExport";
import { useEditorPreferences } from "./hooks/useEditorPreferences";
import { useEditorProject } from "./hooks/useEditorProject";
import { useEditorRegions } from "./hooks/useEditorRegions";
import ProjectBrowserDialog from "./ProjectBrowserDialog";
import {
	fromFileUrl,
	normalizeProjectEditor,
	resolveVideoUrl,
	toFileUrl,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import {
	APP_HEADER_ICON_BUTTON_CLASS,
	DiscordLinkButton,
	FeedbackDialog,
	openExternalLink,
	RECORDLY_ISSUES_URL,
} from "./TutorialHelp";
import TimelineEditor, { type TimelineEditorHandle } from "./timeline/TimelineEditor";
import { normalizeCursorTelemetry } from "./timeline/zoomSuggestionUtils";
import {
	type CropRegion,
	type CursorTelemetryPoint,
	type EditorEffectSection,
} from "./types";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "./videoPlayback/cursorLoopTelemetry";
import {
	calculateMp4ExportDimensions,
	calculateMp4SourceDimensions,
	getSmokeExportConfig,
	getSourceQualityBitrate,
	DEFAULT_MP4_EXPORT_FRAME_RATE,
} from "./videoEditorUtils";

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds < 0) return "0:00";
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function VideoEditor() {
	const { t } = useI18n();
	const { shortcuts, isMac } = useShortcuts();

	const smokeExportConfig = useMemo(
		() => getSmokeExportConfig(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);

	// ── Core local state ──────────────────────────────────────────────
	const [appPlatform, setAppPlatform] = useState<string>(
		typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "darwin" : "",
	);
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
	const [autoSuggestZoomsTrigger, setAutoSuggestZoomsTrigger] = useState(0);
	const [previewVersion, setPreviewVersion] = useState(0);
	const [isPreviewReady, setIsPreviewReady] = useState(false);
	const [showCropModal, setShowCropModal] = useState(false);
	const [timelineCollapsed, setTimelineCollapsed] = useState(false);

	// ── Refs ──────────────────────────────────────────────────────────
	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
	const timelineRef = useRef<TimelineEditorHandle>(null);
	const projectBrowserTriggerRef = useRef<HTMLButtonElement | null>(null);
	const projectBrowserFallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const mp4SupportRequestRef = useRef(0);
	const pendingFreshRecordingAutoSuggestTimeoutRef = useRef<number | null>(null);
	const pendingFreshRecordingAutoSuggestTelemetryCountRef = useRef(0);

	const headerLeftControlsPaddingClass = appPlatform === "darwin" ? "pl-[76px]" : "";

	// ── Stable helpers (no hook deps) ─────────────────────────────────
	const syncActiveVideoSource = useCallback(
		async (sourcePath: string, webcamPath?: string | null) => {
			if (webcamPath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath,
				});
				return;
			}
			await window.electronAPI.setCurrentVideoPath(sourcePath);
		},
		[],
	);

	const remountPreview = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((v) => v + 1);
	}, []);

	// ── Hook 1: Preferences ──────────────────────────────────────────
	const prefs = useEditorPreferences();

	// ── Hook 2: Regions ──────────────────────────────────────────────
	const regions = useEditorRegions({
		duration,
		currentTime,
		videoPath,
		setActiveEffectSection: prefs.setActiveEffectSection,
	});

	// ── Hook 3: Captions ─────────────────────────────────────────────
	const captions = useEditorCaptions({
		videoSourcePath,
		videoPath,
		webcamSourcePath: prefs.webcam.sourcePath,
		syncActiveVideoSource,
		setVideoSourcePath,
		setVideoPath,
	});

	// ── Hook 4: Cursor telemetry ─────────────────────────────────────
	const { cursorTelemetry } = useEditorCursorTelemetry({
		videoPath,
		videoSourcePath,
		pendingFreshRecordingAutoZoomPathRef: regions.pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef: regions.autoSuggestedVideoPathRef,
	});

	// ── Build/apply history snapshot (bridge regions + captions) ─────
	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions: regions.zoomRegions,
			clipRegions: regions.clipRegions,
			annotationRegions: regions.annotationRegions,
			audioRegions: regions.audioRegions,
			autoCaptions: captions.autoCaptions,
			selectedZoomId: regions.selectedZoomId,
			selectedClipId: regions.selectedClipId,
			selectedAnnotationId: regions.selectedAnnotationId,
			selectedAudioId: regions.selectedAudioId,
		};
	}, [
		regions.zoomRegions,
		regions.clipRegions,
		regions.annotationRegions,
		regions.audioRegions,
		captions.autoCaptions,
		regions.selectedZoomId,
		regions.selectedClipId,
		regions.selectedAnnotationId,
		regions.selectedAudioId,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			regions.setZoomRegions(snapshot.zoomRegions);
			regions.setClipRegions(snapshot.clipRegions);
			regions.setAnnotationRegions(snapshot.annotationRegions);
			regions.setAudioRegions(snapshot.audioRegions);
			captions.setAutoCaptions(snapshot.autoCaptions);
			regions.setSelectedZoomId(snapshot.selectedZoomId);
			regions.setSelectedClipId(snapshot.selectedClipId);
			regions.setSelectedAnnotationId(snapshot.selectedAnnotationId);
			regions.setSelectedAudioId(snapshot.selectedAudioId);
		},
		[
			regions.setZoomRegions,
			regions.setClipRegions,
			regions.setAnnotationRegions,
			regions.setAudioRegions,
			captions.setAutoCaptions,
			regions.setSelectedZoomId,
			regions.setSelectedClipId,
			regions.setSelectedAnnotationId,
			regions.setSelectedAudioId,
		],
	);

	// ── Hook 5: History ──────────────────────────────────────────────
	const history = useEditorHistory({
		buildSnapshot: buildHistorySnapshot,
		applySnapshot: applyHistorySnapshot,
	});

	// ── Hook 6: Audio sync (side-effect only) ────────────────────────
	useEditorAudioSync({
		audioRegions: regions.audioRegions,
		speedRegions: regions.effectiveSpeedRegions,
		sourceAudioFallbackPaths,
		isPlaying,
		currentTime,
		duration,
		previewVolume: prefs.previewVolume,
		mapSourceTimeToTimelineTime: regions.mapSourceTimeToTimelineTime,
	});

	// ── Dimension calculations ───────────────────────────────────────
	const [supportedMp4SourceDimensions, setSupportedMp4SourceDimensions] =
		useState<SupportedMp4Dimensions>({
			width: 1920,
			height: 1080,
			capped: false,
			encoderPath: null,
		});

	const gifOutputDimensions = useMemo(
		() =>
			calculateOutputDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				prefs.gifSizePreset,
				GIF_SIZE_PRESETS,
			),
		[prefs.gifSizePreset],
	);

	const desiredMp4SourceDimensions = useMemo(
		() =>
			calculateMp4SourceDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				prefs.aspectRatio,
			),
		[prefs.aspectRatio],
	);

	const mp4OutputDimensions = useMemo(() => {
		const baseWidth = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.width
			: desiredMp4SourceDimensions.width;
		const baseHeight = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.height
			: desiredMp4SourceDimensions.height;
		return {
			medium: calculateMp4ExportDimensions(baseWidth, baseHeight, "medium"),
			good: calculateMp4ExportDimensions(baseWidth, baseHeight, "good"),
			high: calculateMp4ExportDimensions(baseWidth, baseHeight, "high"),
			source: calculateMp4ExportDimensions(baseWidth, baseHeight, "source"),
		};
	}, [desiredMp4SourceDimensions, supportedMp4SourceDimensions]);

	const ensureSupportedMp4SourceDimensions = useCallback(
		async (frameRate: ExportMp4FrameRate) => {
			const result = await probeSupportedMp4Dimensions({
				width: desiredMp4SourceDimensions.width,
				height: desiredMp4SourceDimensions.height,
				frameRate,
				codec: DEFAULT_MP4_CODEC,
				getBitrate: getSourceQualityBitrate,
			});
			if (!result.encoderPath) {
				throw new Error(
					`Video encoding not supported on this system. Tried codec ${DEFAULT_MP4_CODEC} at ${frameRate} FPS up to ${desiredMp4SourceDimensions.width}x${desiredMp4SourceDimensions.height}.`,
				);
			}
			setSupportedMp4SourceDimensions((current) => {
				if (
					current.width === result.width &&
					current.height === result.height &&
					current.capped === result.capped &&
					current.encoderPath?.codec === result.encoderPath?.codec &&
					current.encoderPath?.hardwareAcceleration ===
						result.encoderPath?.hardwareAcceleration
				) {
					return current;
				}
				return result;
			});
			return result;
		},
		[desiredMp4SourceDimensions.height, desiredMp4SourceDimensions.width],
	);

	// Probe mp4 support when dimensions or frame rate change
	useEffect(() => {
		let cancelled = false;
		const requestId = mp4SupportRequestRef.current + 1;
		mp4SupportRequestRef.current = requestId;
		setSupportedMp4SourceDimensions({
			width: desiredMp4SourceDimensions.width,
			height: desiredMp4SourceDimensions.height,
			capped: false,
			encoderPath: null,
		});
		void ensureSupportedMp4SourceDimensions(prefs.mp4FrameRate)
			.then((result) => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) return;
				setSupportedMp4SourceDimensions(result);
			})
			.catch(() => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) return;
				setSupportedMp4SourceDimensions({
					width: desiredMp4SourceDimensions.width,
					height: desiredMp4SourceDimensions.height,
					capped: false,
					encoderPath: null,
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		desiredMp4SourceDimensions.height,
		desiredMp4SourceDimensions.width,
		ensureSupportedMp4SourceDimensions,
		prefs.mp4FrameRate,
	]);

	// ── Cursor telemetry memos ───────────────────────────────────────
	const normalizedCursorTelemetry = useMemo(() => {
		if (cursorTelemetry.length === 0) return [] as CursorTelemetryPoint[];
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return normalizeCursorTelemetry(
			cursorTelemetry,
			totalMs > 0 ? totalMs : Number.MAX_SAFE_INTEGER,
		);
	}, [cursorTelemetry, duration]);

	const displayedTimelineWindow = useMemo(() => {
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return getDisplayedTimelineWindowMs(totalMs, regions.trimRegions);
	}, [duration, regions.trimRegions]);

	const effectiveCursorTelemetry = useMemo(() => {
		if (!prefs.loopCursor) return normalizedCursorTelemetry;
		if (
			normalizedCursorTelemetry.length < 2 ||
			displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs
		) {
			return normalizedCursorTelemetry;
		}
		return buildLoopedCursorTelemetry(
			normalizedCursorTelemetry,
			displayedTimelineWindow.endMs,
			displayedTimelineWindow.startMs,
		);
	}, [prefs.loopCursor, normalizedCursorTelemetry, displayedTimelineWindow]);

	// ── captureProjectThumbnail ──────────────────────────────────────
	const captureProjectThumbnail = useCallback(async () => {
		const previewHandle = videoPlaybackRef.current;
		const previewVideo = previewHandle?.video ?? null;

		if (previewHandle && previewVideo && previewVideo.paused) {
			try {
				await previewHandle.refreshFrame();
				await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
			} catch {
				// no-op
			}
		}

		const canvas = document.createElement("canvas");
		const targetWidth = 320;
		const targetHeight = 180;
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = canvas.getContext("2d");
		if (!context) return null;
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.fillStyle = "#111113";
		context.fillRect(0, 0, targetWidth, targetHeight);

		const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
		const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
		const frameTimestampUs = Math.max(0, Math.round(currentTime * 1_000_000));

		if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
			let videoFrame: VideoFrame | null = null;
			let frameRenderer: FrameRenderer | null = null;
			try {
				videoFrame = new VideoFrame(previewVideo, { timestamp: frameTimestampUs });
				frameRenderer = new FrameRenderer({
					width: targetWidth,
					height: targetHeight,
					wallpaper: prefs.wallpaper,
					zoomRegions: regions.effectiveZoomRegions,
					showShadow: prefs.shadowIntensity > 0,
					shadowIntensity: prefs.shadowIntensity,
					backgroundBlur: prefs.backgroundBlur,
					zoomMotionBlur: prefs.zoomMotionBlur,
					connectZooms: prefs.connectZooms,
					zoomInDurationMs: prefs.zoomInDurationMs,
					zoomInOverlapMs: prefs.zoomInOverlapMs,
					zoomOutDurationMs: prefs.zoomOutDurationMs,
					connectedZoomGapMs: prefs.connectedZoomGapMs,
					connectedZoomDurationMs: prefs.connectedZoomDurationMs,
					zoomInEasing: prefs.zoomInEasing,
					zoomOutEasing: prefs.zoomOutEasing,
					connectedZoomEasing: prefs.connectedZoomEasing,
					borderRadius: prefs.borderRadius,
					padding: prefs.padding,
					cropRegion: prefs.cropRegion,
					webcam: prefs.webcam,
					webcamUrl: prefs.webcam.sourcePath ? toFileUrl(prefs.webcam.sourcePath) : null,
					videoWidth: previewVideo.videoWidth,
					videoHeight: previewVideo.videoHeight,
					annotationRegions: regions.annotationRegions,
					autoCaptions: captions.autoCaptions,
					autoCaptionSettings: captions.autoCaptionSettings,
					speedRegions: regions.effectiveSpeedRegions,
					previewWidth,
					previewHeight,
					cursorTelemetry,
					showCursor: prefs.showCursor,
					cursorStyle: prefs.cursorStyle,
					cursorSize: prefs.cursorSize,
					cursorSmoothing: prefs.cursorSmoothing,
					zoomSmoothness: prefs.zoomSmoothness,
					zoomClassicMode: prefs.zoomClassicMode,
					cursorMotionBlur: prefs.cursorMotionBlur,
					cursorClickBounce: prefs.cursorClickBounce,
					cursorClickBounceDuration: prefs.cursorClickBounceDuration,
					cursorSway: prefs.cursorSway,
				});
				await frameRenderer.initialize();
				await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch {
				// fallback below
			} finally {
				videoFrame?.close();
				frameRenderer?.destroy();
			}
		}

		const previewCanvas = previewHandle?.app?.canvas ?? null;
		const drawableSource =
			previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0
				? previewCanvas
				: previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
					? previewVideo
					: null;
		if (!drawableSource) return null;

		const sourceWidth =
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoWidth
				: drawableSource.width;
		const sourceHeight =
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoHeight
				: drawableSource.height;
		if (sourceWidth <= 0 || sourceHeight <= 0) return null;

		const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
		const drawWidth = Math.round(sourceWidth * scale);
		const drawHeight = Math.round(sourceHeight * scale);
		const offsetX = Math.round((targetWidth - drawWidth) / 2);
		const offsetY = Math.round((targetHeight - drawHeight) / 2);

		try {
			context.drawImage(drawableSource, offsetX, offsetY, drawWidth, drawHeight);
			return canvas.toDataURL("image/png");
		} catch {
			return null;
		}
	}, [
		currentTime,
		cursorTelemetry,
		prefs.backgroundBlur,
		prefs.borderRadius,
		prefs.connectZooms,
		prefs.connectedZoomDurationMs,
		prefs.connectedZoomEasing,
		prefs.connectedZoomGapMs,
		prefs.cropRegion,
		prefs.cursorClickBounce,
		prefs.cursorClickBounceDuration,
		prefs.cursorMotionBlur,
		prefs.cursorSize,
		prefs.cursorSmoothing,
		prefs.cursorStyle,
		prefs.cursorSway,
		prefs.padding,
		prefs.shadowIntensity,
		prefs.showCursor,
		prefs.wallpaper,
		prefs.webcam,
		prefs.zoomInDurationMs,
		prefs.zoomInEasing,
		prefs.zoomInOverlapMs,
		prefs.zoomMotionBlur,
		prefs.zoomOutDurationMs,
		prefs.zoomOutEasing,
		prefs.zoomSmoothness,
		prefs.zoomClassicMode,
		captions.autoCaptions,
		captions.autoCaptionSettings,
		regions.annotationRegions,
		regions.effectiveSpeedRegions,
		regions.effectiveZoomRegions,
	]);

	// ── getRenderConfig (for export hook) ────────────────────────────
	const getRenderConfig = useCallback((): RenderConfig => {
		return {
			videoPath,
			wallpaper: prefs.wallpaper,
			shadowIntensity: prefs.shadowIntensity,
			backgroundBlur: prefs.backgroundBlur,
			zoomMotionBlur: prefs.zoomMotionBlur,
			connectZooms: prefs.connectZooms,
			zoomInDurationMs: prefs.zoomInDurationMs,
			zoomInOverlapMs: prefs.zoomInOverlapMs,
			zoomOutDurationMs: prefs.zoomOutDurationMs,
			connectedZoomGapMs: prefs.connectedZoomGapMs,
			connectedZoomDurationMs: prefs.connectedZoomDurationMs,
			zoomInEasing: prefs.zoomInEasing,
			zoomOutEasing: prefs.zoomOutEasing,
			connectedZoomEasing: prefs.connectedZoomEasing,
			showCursor: prefs.showCursor,
			cursorStyle: prefs.cursorStyle,
			effectiveCursorTelemetry,
			cursorSize: prefs.cursorSize,
			cursorSmoothing: prefs.cursorSmoothing,
			zoomSmoothness: prefs.zoomSmoothness,
			zoomClassicMode: prefs.zoomClassicMode,
			cursorMotionBlur: prefs.cursorMotionBlur,
			cursorClickBounce: prefs.cursorClickBounce,
			cursorClickBounceDuration: prefs.cursorClickBounceDuration,
			cursorSway: prefs.cursorSway,
			audioRegions: regions.audioRegions,
			sourceAudioFallbackPaths,
			exportEncodingMode: prefs.exportEncodingMode,
			exportBackendPreference: prefs.exportBackendPreference,
			exportPipelineModel: prefs.exportPipelineModel,
			borderRadius: prefs.borderRadius,
			padding: prefs.padding,
			cropRegion: prefs.cropRegion,
			webcam: prefs.webcam,
			resolvedWebcamVideoUrl: prefs.resolvedWebcamVideoUrl,
			annotationRegions: regions.annotationRegions,
			autoCaptions: captions.autoCaptions,
			autoCaptionSettings: captions.autoCaptionSettings,
			isPlaying,
			exportQuality: prefs.exportQuality,
			effectiveZoomRegions: regions.effectiveZoomRegions,
			effectiveSpeedRegions: regions.effectiveSpeedRegions,
			trimRegions: regions.trimRegions,
			mp4FrameRate: prefs.mp4FrameRate,
			frame: prefs.frame,
			exportFormat: prefs.exportFormat,
			gifFrameRate: prefs.gifFrameRate,
			gifLoop: prefs.gifLoop,
			gifSizePreset: prefs.gifSizePreset,
		};
	}, [
		videoPath,
		prefs.wallpaper,
		prefs.shadowIntensity,
		prefs.backgroundBlur,
		prefs.zoomMotionBlur,
		prefs.connectZooms,
		prefs.zoomInDurationMs,
		prefs.zoomInOverlapMs,
		prefs.zoomOutDurationMs,
		prefs.connectedZoomGapMs,
		prefs.connectedZoomDurationMs,
		prefs.zoomInEasing,
		prefs.zoomOutEasing,
		prefs.connectedZoomEasing,
		prefs.showCursor,
		prefs.cursorStyle,
		effectiveCursorTelemetry,
		prefs.cursorSize,
		prefs.cursorSmoothing,
		prefs.zoomSmoothness,
		prefs.zoomClassicMode,
		prefs.cursorMotionBlur,
		prefs.cursorClickBounce,
		prefs.cursorClickBounceDuration,
		prefs.cursorSway,
		regions.audioRegions,
		sourceAudioFallbackPaths,
		prefs.exportEncodingMode,
		prefs.exportBackendPreference,
		prefs.exportPipelineModel,
		prefs.borderRadius,
		prefs.padding,
		prefs.cropRegion,
		prefs.webcam,
		prefs.resolvedWebcamVideoUrl,
		regions.annotationRegions,
		captions.autoCaptions,
		captions.autoCaptionSettings,
		isPlaying,
		prefs.exportQuality,
		regions.effectiveZoomRegions,
		regions.effectiveSpeedRegions,
		regions.trimRegions,
		prefs.mp4FrameRate,
		prefs.frame,
		prefs.exportFormat,
		prefs.gifFrameRate,
		prefs.gifLoop,
		prefs.gifSizePreset,
	]);

	// ── Hook 7: Export ───────────────────────────────────────────────
	const exp = useEditorExport({
		videoPlaybackRef,
		smokeExportConfig,
		getRenderConfig,
		ensureSupportedMp4SourceDimensions,
		remountPreview,
	});

	// ── Persisted state (for project save/load) ──────────────────────
	const currentSourcePath = useMemo(
		() => videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null),
		[videoPath, videoSourcePath],
	);
	const hasSourceAudioFallback = sourceAudioFallbackPaths.length > 0;

	const getCurrentPersistedState = useCallback(() => {
		return {
			wallpaper: prefs.wallpaper,
			shadowIntensity: prefs.shadowIntensity,
			backgroundBlur: prefs.backgroundBlur,
			zoomMotionBlur: prefs.zoomMotionBlur,
			connectZooms: prefs.connectZooms,
			zoomInDurationMs: prefs.zoomInDurationMs,
			zoomInOverlapMs: prefs.zoomInOverlapMs,
			zoomOutDurationMs: prefs.zoomOutDurationMs,
			connectedZoomGapMs: prefs.connectedZoomGapMs,
			connectedZoomDurationMs: prefs.connectedZoomDurationMs,
			zoomInEasing: prefs.zoomInEasing,
			zoomOutEasing: prefs.zoomOutEasing,
			connectedZoomEasing: prefs.connectedZoomEasing,
			showCursor: prefs.showCursor,
			loopCursor: prefs.loopCursor,
			cursorStyle: prefs.cursorStyle,
			cursorSize: prefs.cursorSize,
			cursorSmoothing: prefs.cursorSmoothing,
			zoomSmoothness: prefs.zoomSmoothness,
			zoomClassicMode: prefs.zoomClassicMode,
			cursorMotionBlur: prefs.cursorMotionBlur,
			cursorClickBounce: prefs.cursorClickBounce,
			cursorClickBounceDuration: prefs.cursorClickBounceDuration,
			cursorSway: prefs.cursorSway,
			borderRadius: prefs.borderRadius,
			padding: prefs.padding,
			frame: prefs.frame,
			webcam: prefs.webcam,
			zoomRegions: regions.zoomRegions,
			trimRegions: regions.trimRegions,
			clipRegions: regions.clipRegions,
			speedRegions: regions.effectiveSpeedRegions,
			annotationRegions: regions.annotationRegions,
			audioRegions: regions.audioRegions,
			autoCaptions: captions.autoCaptions,
			autoCaptionSettings: captions.autoCaptionSettings,
			aspectRatio: prefs.aspectRatio,
			exportEncodingMode: prefs.exportEncodingMode,
			exportBackendPreference: prefs.exportBackendPreference,
			exportPipelineModel: prefs.exportPipelineModel,
			exportQuality: prefs.exportQuality,
			mp4FrameRate: prefs.mp4FrameRate,
			exportFormat: prefs.exportFormat,
			gifFrameRate: prefs.gifFrameRate,
			gifLoop: prefs.gifLoop,
			gifSizePreset: prefs.gifSizePreset,
		};
	}, [
		prefs.wallpaper, prefs.shadowIntensity, prefs.backgroundBlur, prefs.zoomMotionBlur,
		prefs.connectZooms, prefs.zoomInDurationMs, prefs.zoomInOverlapMs, prefs.zoomOutDurationMs,
		prefs.connectedZoomGapMs, prefs.connectedZoomDurationMs, prefs.zoomInEasing,
		prefs.zoomOutEasing, prefs.connectedZoomEasing, prefs.showCursor, prefs.loopCursor,
		prefs.cursorStyle, prefs.cursorSize, prefs.cursorSmoothing, prefs.zoomSmoothness,
		prefs.zoomClassicMode, prefs.cursorMotionBlur, prefs.cursorClickBounce,
		prefs.cursorClickBounceDuration, prefs.cursorSway, prefs.borderRadius, prefs.padding,
		prefs.frame, prefs.webcam, prefs.aspectRatio, prefs.exportEncodingMode,
		prefs.exportBackendPreference, prefs.exportPipelineModel, prefs.exportQuality,
		prefs.mp4FrameRate, prefs.exportFormat, prefs.gifFrameRate, prefs.gifLoop,
		prefs.gifSizePreset, regions.zoomRegions, regions.trimRegions, regions.clipRegions,
		regions.effectiveSpeedRegions, regions.annotationRegions, regions.audioRegions,
		captions.autoCaptions, captions.autoCaptionSettings,
	]);

	const projectDisplayName = useMemo(() => {
		const fileName =
			currentProjectPath?.split(/[\\/]/).pop() ??
			currentSourcePath?.split(/[\\/]/).pop() ??
			"";
		const withoutExtension = fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "");
		return withoutExtension || t("editor.project.untitled", "Untitled");
	}, [currentProjectPath, currentSourcePath, t]);

	// ── onApplyLoadedProject (bridge for project hook) ───────────────
	const onApplyLoadedProject = useCallback(
		async (
			normalizedEditor: ReturnType<typeof normalizeProjectEditor>,
			sourcePath: string,
			projectPath: string | null,
		) => {
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			setError(null);

			setVideoSourcePath(sourcePath);
			setVideoPath(await resolveVideoUrl(sourcePath));
			setCurrentProjectPath(projectPath);
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;

			if (normalizedEditor.webcam.sourcePath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath: normalizedEditor.webcam.sourcePath,
				});
			} else {
				await window.electronAPI.setCurrentVideoPath(sourcePath);
			}

			prefs.applyProjectPreferences(normalizedEditor);
			regions.resetForProject(normalizedEditor);
			captions.resetForProject(normalizedEditor);
			return true;
		},
		[prefs.applyProjectPreferences, regions.resetForProject, captions.resetForProject],
	);

	// ── Hook 8: Project ──────────────────────────────────────────────
	const project = useEditorProject({
		getCurrentPersistedState,
		getCurrentSourcePath: useCallback(() => currentSourcePath, [currentSourcePath]),
		getCurrentProjectPath: useCallback(() => currentProjectPath, [currentProjectPath]),
		setCurrentProjectPath,
		captureProjectThumbnail,
		remountPreview,
		onApplyLoadedProject,
		clearHistory: history.clearHistory,
	});

	// ── Webcam handlers ──────────────────────────────────────────────
	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null) => {
			if (!currentSourcePath || !window.electronAPI.setCurrentRecordingSession) return;
			await window.electronAPI.setCurrentRecordingSession({
				videoPath: currentSourcePath,
				webcamPath,
			});
		},
		[currentSourcePath],
	);

	const handleUploadWebcam = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (!result.success || !result.path) return;
		prefs.setWebcam((prev) => ({ ...prev, enabled: true, sourcePath: result.path ?? null }));
		await syncRecordingSessionWebcam(result.path);
		toast.success(t("settings.effects.webcamFootageAdded"));
	}, [syncRecordingSessionWebcam, prefs.setWebcam, t]);

	const handleClearWebcam = useCallback(async () => {
		prefs.setWebcam((prev) => ({ ...prev, enabled: false, sourcePath: null }));
		await syncRecordingSessionWebcam(null);
		toast.success(t("settings.effects.webcamFootageRemoved"));
	}, [syncRecordingSessionWebcam, prefs.setWebcam, t]);

	// ── Playback helpers ─────────────────────────────────────────────
	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;
		if (!video.paused && !video.ended) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = regions.mapTimelineTimeToSourceTime(time * 1000) / 1000;
	}

	const handleAutoSuggestZoomsConsumed = useCallback(() => {
		setAutoSuggestZoomsTrigger(0);
	}, []);

	// ── Crop handlers ────────────────────────────────────────────────
	const handleOpenCropEditor = useCallback(() => {
		cropSnapshotRef.current = { ...prefs.cropRegion };
		setShowCropModal(true);
	}, [prefs.cropRegion]);

	const handleCloseCropEditor = useCallback(() => setShowCropModal(false), []);

	const handleCancelCropEditor = useCallback(() => {
		if (cropSnapshotRef.current) prefs.setCropRegion(cropSnapshotRef.current);
		setShowCropModal(false);
	}, [prefs.setCropRegion]);

	const isCropped = useMemo(() => {
		const { x, y, width, height } = prefs.cropRegion;
		const top = Math.round(y * 100);
		const left = Math.round(x * 100);
		const bottom = Math.round((1 - y - height) * 100);
		const right = Math.round((1 - x - width) * 100);
		return top > 0 || left > 0 || bottom > 0 || right > 0;
	}, [prefs.cropRegion]);

	// ── Misc handlers ────────────────────────────────────────────────
	const openRecordingsFolder = useCallback(async () => {
		try {
			const result = await window.electronAPI.openRecordingsFolder();
			if (!result.success)
				toast.error(result.message || result.error || "Failed to open recordings folder.");
		} catch (err) {
			toast.error(`Failed to open recordings folder: ${String(err)}`);
		}
	}, []);

	const revealExportedFile = useCallback(async () => {
		if (!exp.exportedFilePath) return;
		try {
			const result = await window.electronAPI.revealInFolder(exp.exportedFilePath);
			if (!result.success)
				toast.error(result.error || result.message || "Failed to reveal item in folder.");
		} catch (err) {
			toast.error(`Failed to reveal item in folder: ${String(err)}`);
		}
	}, [exp.exportedFilePath]);

	const openLightningIssues = useCallback(async () => {
		await openExternalLink(
			RECORDLY_ISSUES_URL,
			t("editor.feedback.openFailed", "Failed to open link."),
		);
	}, [t]);

	// ── Effects ──────────────────────────────────────────────────────

	// Platform detection
	useEffect(() => {
		void window.electronAPI?.getPlatform?.()?.then((platform) => setAppPlatform(platform));
	}, []);

	// Reset auto-suggested refs on mount
	useEffect(() => {
		regions.autoSuggestedVideoPathRef.current = null;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Auto-activate builtin extensions
	useEffect(() => {
		extensionHost.autoActivateBuiltins();
	}, []);

	// Load source audio fallback paths
	useEffect(() => {
		let cancelled = false;
		setSourceAudioFallbackPaths([]);
		if (!currentSourcePath) return () => { cancelled = true; };
		void (async () => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) return;
				setSourceAudioFallbackPaths(result.success ? (result.paths ?? []) : []);
			} catch {
				if (!cancelled) setSourceAudioFallbackPaths([]);
			}
		})();
		return () => { cancelled = true; };
	}, [currentSourcePath]);

	// Resolve webcam video URL
	useEffect(() => {
		let cancelled = false;
		if (!prefs.webcam.sourcePath) {
			prefs.setResolvedWebcamVideoUrl(null);
			return;
		}
		prefs.setResolvedWebcamVideoUrl(null);
		void resolveVideoUrl(prefs.webcam.sourcePath).then((url) => {
			if (!cancelled) prefs.setResolvedWebcamVideoUrl(url);
		});
		return () => { cancelled = true; };
	}, [prefs.webcam.sourcePath, prefs.setResolvedWebcamVideoUrl]);

	// Reset auto-zoom ref when preference is disabled
	useEffect(() => {
		if (!prefs.autoApplyFreshRecordingAutoZooms) {
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [prefs.autoApplyFreshRecordingAutoZooms]);

	// Persist whisper paths (not managed by preferences hook)
	useEffect(() => {
		saveEditorPreferences({
			whisperExecutablePath: captions.whisperExecutablePath,
			whisperModelPath: captions.whisperModelPath,
		});
	}, [captions.whisperExecutablePath, captions.whisperModelPath]);

	// ── loadInitialData ──────────────────────────────────────────────
	useEffect(() => {
		async function loadInitialData() {
			try {
				if (smokeExportConfig.enabled) {
					if (!smokeExportConfig.inputPath) {
						setError("Smoke export input path is missing.");
						return;
					}
					const sourcePath = fromFileUrl(smokeExportConfig.inputPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					const smokeWebcamSourcePath = smokeExportConfig.webcamInputPath
						? fromFileUrl(smokeExportConfig.webcamInputPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current = null;
					prefs.setWebcam((prev) => ({
						...prev,
						enabled: !!smokeWebcamSourcePath,
						sourcePath: smokeWebcamSourcePath,
						shadow:
							smokeExportConfig.webcamShadow === undefined
								? prev.shadow
								: smokeExportConfig.webcamShadow,
						size:
							smokeExportConfig.webcamSize === undefined
								? prev.size
								: smokeExportConfig.webcamSize,
					}));
					setError(null);
					return;
				}

				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await project.applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						// Re-apply user preferences so stale project data does not
						// overwrite the last-used settings saved to localStorage.
						prefs.setPadding(initialEditorPreferences.padding);
						prefs.setBorderRadius(initialEditorPreferences.borderRadius);
						prefs.setAspectRatio(initialEditorPreferences.aspectRatio);
						prefs.setExportFormat(initialEditorPreferences.exportFormat);
						prefs.setMp4FrameRate(
							initialEditorPreferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
						);
						prefs.setExportQuality(initialEditorPreferences.exportQuality);
						prefs.setExportEncodingMode(initialEditorPreferences.exportEncodingMode);
						prefs.setExportBackendPreference(
							initialEditorPreferences.exportBackendPreference,
						);
						prefs.setExportPipelineModel(initialEditorPreferences.exportPipelineModel);
						prefs.setGifFrameRate(initialEditorPreferences.gifFrameRate);
						prefs.setGifLoop(initialEditorPreferences.gifLoop);
						prefs.setGifSizePreset(initialEditorPreferences.gifSizePreset);
						return;
					}
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current =
						prefs.autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
					prefs.setWebcam((prev) => ({
						...prev,
						enabled: Boolean(sessionResult.session?.webcamPath),
						sourcePath: sessionResult.session?.webcamPath ?? null,
					}));
					return;
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					regions.pendingFreshRecordingAutoZoomPathRef.current = null;
					prefs.setWebcam((prev) => ({
						...prev,
						enabled: false,
						sourcePath: null,
					}));
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}
		loadInitialData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ── Auto-zoom suggestion ─────────────────────────────────────────
	useEffect(() => {
		if (
			!videoPath ||
			loading ||
			!isPreviewReady ||
			duration <= 0 ||
			regions.zoomRegions.length > 0 ||
			normalizedCursorTelemetry.length < 2
		) {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			return;
		}
		if (regions.pendingFreshRecordingAutoZoomPathRef.current !== videoPath) return;
		if (regions.autoSuggestedVideoPathRef.current === videoPath) {
			regions.pendingFreshRecordingAutoZoomPathRef.current = null;
			return;
		}
		const telemetryPointCount = cursorTelemetry.length;
		if (pendingFreshRecordingAutoSuggestTelemetryCountRef.current === telemetryPointCount)
			return;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = telemetryPointCount;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
		pendingFreshRecordingAutoSuggestTimeoutRef.current = window.setTimeout(() => {
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			if (
				regions.pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
				regions.autoSuggestedVideoPathRef.current === videoPath ||
				regions.zoomRegions.length > 0
			) {
				return;
			}
			setAutoSuggestZoomsTrigger((v) => v + 1);
		}, 500);
	}, [
		videoPath,
		loading,
		isPreviewReady,
		duration,
		cursorTelemetry.length,
		normalizedCursorTelemetry,
		regions.zoomRegions,
	]);

	// ── Keyboard shortcuts ───────────────────────────────────────────
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;
			const usesPrimaryModifier = isMac ? e.metaKey : e.ctrlKey;
			const key = e.key.toLowerCase();

			if (usesPrimaryModifier && !e.altKey && key === "z") {
				if (!isEditableTarget) {
					e.preventDefault();
					if (e.shiftKey) history.handleRedo();
					else history.handleUndo();
				}
				return;
			}
			if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && key === "y") {
				if (!isEditableTarget) {
					e.preventDefault();
					history.handleRedo();
				}
				return;
			}
			if (e.key === "Tab") {
				if (isEditableTarget) return;
				e.preventDefault();
			}
			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				if (isEditableTarget) return;
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					if (playback.video.paused) playback.play().catch(console.error);
					else playback.pause();
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [shortcuts, isMac, history.handleUndo, history.handleRedo]);

	// ── Smoke export trigger ─────────────────────────────────────────
	useEffect(() => {
		if (!smokeExportConfig.enabled || exp.smokeExportStartedRef.current) return;
		if (error) {
			exp.smokeExportStartedRef.current = true;
			console.error(`[smoke-export] ${error}`);
			window.close();
			return;
		}
		if (!videoPath || loading) return;
		exp.smokeExportStartedRef.current = true;
		void exp.handleExport({
			format: "mp4",
			quality: "good",
			encodingMode: smokeExportConfig.encodingMode ?? "balanced",
		});
	}, [error, exp.handleExport, loading, smokeExportConfig.enabled, smokeExportConfig.encodingMode, videoPath]);

	// Cleanup auto-suggest timeout
	useEffect(() => {
		return () => {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
		};
	}, []);

	// ── Extension section buttons ────────────────────────────────────
	const [extensionSectionButtons, setExtensionSectionButtons] = useState<
		{ id: EditorEffectSection; label: string; icon: typeof PhPuzzle | string }[]
	>([]);
	useEffect(() => {
		const update = () => {
			const panels = extensionHost.getSettingsPanels();
			const standalone = panels
				.filter((p) => !p.panel.parentSection)
				.map((p) => ({
					id: `ext:${p.extensionId}/${p.panel.id}` as EditorEffectSection,
					label: p.panel.label,
					icon: p.panel.icon || (PhPuzzle as typeof PhPuzzle | string),
				}));
			setExtensionSectionButtons(standalone);
		};
		update();
		return extensionHost.onChange(update);
	}, []);

	const editorSectionButtons = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: PhSparkle },
			{
				id: "cursor" as const,
				label: t("settings.sections.cursor", "Cursor"),
				icon: PhCursorFill,
			},
			{
				id: "webcam" as const,
				label: t("settings.sections.webcam", "Webcam"),
				icon: PhCamera,
			},
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: PhCaptions,
			},
			{
				id: "settings" as const,
				label: t("settings.sections.settings", "Settings"),
				icon: PhSettings,
			},
			...extensionSectionButtons,
			{
				id: "extensions" as const,
				label: t("settings.sections.extensions", "Extensions"),
				icon: PhPuzzle,
			},
		],
		[t, extensionSectionButtons],
	);

	// ── Export derived labels ─────────────────────────────────────────
	const isLightningExportInProgress =
		prefs.exportFormat === "mp4" &&
		prefs.exportPipelineModel === "modern" &&
		(exp.isExporting || exp.exportProgress !== null);
	const isLegacyExportInProgress =
		prefs.exportFormat === "mp4" &&
		prefs.exportPipelineModel === "legacy" &&
		(exp.isExporting || exp.exportProgress !== null);
	const exportRenderSpeedLabel =
		typeof exp.exportProgress?.renderFps === "number" &&
		Number.isFinite(exp.exportProgress.renderFps) &&
		exp.exportProgress.renderFps > 0
			? t("editor.exportStatus.renderSpeed", "Render speed {{fps}} FPS", {
					fps: exp.exportProgress.renderFps.toFixed(1),
				})
			: null;
	const exportRuntimeLabel = useMemo(() => {
		const renderBackend = exp.exportProgress?.renderBackend;
		const encodeBackend = exp.exportProgress?.encodeBackend;
		const encoderName = exp.exportProgress?.encoderName;
		if (!renderBackend && !encodeBackend && !encoderName) return null;
		const rendererLabel =
			renderBackend === "webgpu" ? "WebGPU" : renderBackend === "webgl" ? "WebGL" : null;
		const encoderLabel =
			encodeBackend === "ffmpeg"
				? "Breeze"
				: encodeBackend === "webcodecs"
					? "WebCodecs"
					: null;
		const pathLabel =
			rendererLabel && encoderLabel
				? `${rendererLabel} + ${encoderLabel}`
				: (rendererLabel ?? encoderLabel);
		if (!pathLabel) return encoderName ?? null;
		return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
	}, [exp.exportProgress]);
	const exportPercentLabel = exp.exportProgress
		? exp.isExportSaving
			? t("editor.exportStatus.saving", "Opening save dialog...")
			: exp.isRenderingAudio
				? t("editor.exportStatus.renderingAudio", "Rendering audio {{percent}}%", {
						percent: Math.round((exp.exportProgress.audioProgress ?? 0) * 100),
					})
				: exp.isExportFinalizing
					? t("editor.exportStatus.finalizingPercent", "Finalizing {{percent}}%", {
							percent: Math.round(exp.exportFinalizingProgress ?? 99),
						})
					: t("editor.exportStatus.completePercent", "{{percent}}% complete", {
							percent: Math.round(exp.exportProgress.percentage),
						})
		: t("editor.exportStatus.preparing", "Preparing export...");

	// ── Project browser element ──────────────────────────────────────
	const projectBrowser = (
		<ProjectBrowserDialog
			open={project.projectBrowserOpen}
			onOpenChange={project.setProjectBrowserOpen}
			entries={project.projectLibraryEntries}
			anchorRef={error ? projectBrowserFallbackTriggerRef : projectBrowserTriggerRef}
			onOpenProject={(projectPath) => {
				void project.handleOpenProjectFromLibrary(projectPath);
			}}
		/>
	);

	// ── Render ───────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="text-foreground">Loading video...</div>
				{projectBrowser}
				<Toaster className="pointer-events-auto" />
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						ref={projectBrowserFallbackTriggerRef}
						type="button"
						onClick={project.handleOpenProjectBrowser}
						className="rounded-[5px] bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
					>
						Open Projects
					</button>
				</div>
				{projectBrowser}
				<Toaster className="pointer-events-auto" />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-editor-bg text-foreground overflow-hidden selection:bg-[#2563EB]/30">
			{/* ── Header ─────────────────────────────────────────────── */}
			<div
				className="relative flex h-11 flex-shrink-0 items-center justify-between bg-editor-header/88 px-5 backdrop-blur-md border-b border-foreground/10 z-50"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className={`flex items-center gap-1.5 justify-self-start ${headerLeftControlsPaddingClass}`}
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => void openRecordingsFolder()}
						className={APP_HEADER_ICON_BUTTON_CLASS}
						title={t("common.app.manageRecordings", "Open recordings folder")}
						aria-label={t("common.app.manageRecordings", "Open recordings folder")}
					>
						<FolderOpen className="h-4 w-4" />
					</Button>
					<DiscordLinkButton />
					<FeedbackDialog />
					<div className="ml-1 h-5 w-px bg-foreground/10" />
					<Button
						type="button"
						variant="ghost"
						onClick={history.handleUndo}
						disabled={!history.canUndo}
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
						title={t("common.actions.undo", "Undo")}
						aria-label={t("common.actions.undo", "Undo")}
					>
						<Undo2 className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={history.handleRedo}
						disabled={!history.canRedo}
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
						title={t("common.actions.redo", "Redo")}
						aria-label={t("common.actions.redo", "Redo")}
					>
						<Redo2 className="h-4 w-4" />
					</Button>
				</div>
				<div
					className="pointer-events-none absolute left-1/2 flex min-w-0 -translate-x-1/2 items-baseline justify-center gap-0"
					style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
				>
					<span className="text-sm font-semibold tracking-tight text-foreground/90">
						{projectDisplayName}
					</span>
					<span className="text-xs font-medium tracking-tight text-muted-foreground/70">
						.recordly
					</span>
				</div>
				<div
					className="flex items-center gap-2 justify-self-end pr-3"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<Button
						ref={projectBrowserTriggerRef}
						type="button"
						onClick={project.handleOpenProjectBrowser}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-neutral-800 px-4 text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
					>
						<FolderOpen className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">
							{t("editor.project.projects", "Projects")}
						</span>
					</Button>
					<Button
						type="button"
						onClick={project.handleSaveProject}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-neutral-800 px-4 text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
					>
						<span
							className={`${project.hasUnsavedChanges ? "flex" : "hidden"} size-2 relative`}
						>
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2563EB] opacity-75"></span>
							<span className="relative inline-flex size-2 rounded-full bg-[#2563EB]"></span>
						</span>
						<Save className="h-4 w-4" weight="fill" />
						<span className="text-sm font-semibold tracking-tight">
							{t("common.actions.save")}
						</span>
					</Button>
					<div className="mx-1 h-5 w-px bg-foreground/10" />
					<DropdownMenu
						open={exp.showExportDropdown}
						onOpenChange={exp.setShowExportDropdown}
						modal={false}
					>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								onClick={exp.handleOpenExportDropdown}
								className="inline-flex h-8 min-w-[112px] items-center justify-center gap-2 rounded-[5px] bg-[#2563EB] px-4.5 text-white transition-colors hover:bg-[#2563EB]/92"
							>
								<Download className="h-4 w-4" />
								<span className="text-sm font-semibold tracking-tight">
									{t("common.actions.export", "Export")}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							sideOffset={10}
							className="w-[360px] border-none bg-transparent p-0 shadow-none"
						>
							{exp.isExporting ? (
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<div className="mb-3 flex items-center justify-between gap-3">
										<div>
											<p className="text-sm font-semibold text-foreground">
												{t("editor.exportStatus.exporting", "Exporting")}
											</p>
											<p className="text-xs text-muted-foreground">
												{t(
													"editor.exportStatus.renderingFile",
													"Rendering your file.",
												)}
											</p>
											{isLightningExportInProgress ? (
												<p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
													PLEASE
													<button
														type="button"
														onClick={() => void openLightningIssues()}
														className="underline decoration-slate-500/70 underline-offset-2 transition-colors hover:text-foreground"
													>
														report bugs
													</button>
													with Lightning export
													<span aria-hidden="true">{"\u{1F64F}"}</span>
												</p>
											) : null}
											{isLegacyExportInProgress ? (
												<p className="mt-1 text-[11px] text-muted-foreground/70">
													Export too slow? Cancel and try Lightning
													export!
												</p>
											) : null}
										</div>
										<Button
											type="button"
											variant="outline"
											onClick={exp.handleCancelExport}
											className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20"
										>
											{t("common.actions.cancel")}
										</Button>
									</div>
									<div className="h-2 overflow-hidden rounded-full border border-foreground/5 bg-foreground/5">
										{exp.isExportSaving ? (
											<div className="indeterminate-progress h-full rounded-full bg-transparent" />
										) : (
											<div
												className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
												style={{
													width: `${Math.min(exp.isRenderingAudio ? ((exp.exportProgress as ExportProgress).audioProgress ?? 0) * 100 : (exp.exportFinalizingProgress ?? exp.exportProgress?.percentage ?? 8), 100)}%`,
												}}
											/>
										)}
									</div>
									<p className="mt-2 text-xs text-muted-foreground">
										{exportPercentLabel}
									</p>
									{exp.isRenderingAudio ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Audio requires real-time playback for speed/overlay
											edits
										</p>
									) : exportRenderSpeedLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											{exportRenderSpeedLabel}
										</p>
									) : null}
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
								</div>
							) : exp.exportError ? (
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<p className="text-sm font-semibold text-foreground">
										{t("editor.exportStatus.issue", "Export issue")}
									</p>
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
									<p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
										{exp.exportError}
									</p>
									<div className="mt-4 flex gap-2">
										{exp.hasPendingExportSave ? (
											<Button
												type="button"
												onClick={exp.handleRetrySaveExport}
												className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
											>
												{t("editor.actions.saveAgain", "Save Again")}
											</Button>
										) : null}
										<Button
											type="button"
											variant="outline"
											onClick={exp.handleExportDropdownClose}
											className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
										>
											{t("common.actions.close", "Close")}
										</Button>
									</div>
								</div>
							) : exp.exportedFilePath ? (
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<p className="text-sm font-semibold text-foreground">
										{t("editor.exportStatus.complete", "Export complete")}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{t(
											"editor.exportStatus.savedSuccessfully",
											"Your file was saved successfully.",
										)}
									</p>
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
									<p className="mt-3 truncate text-xs text-muted-foreground/70">
										{exp.exportedFilePath.split("/").pop()}
									</p>
									<div className="mt-4 flex gap-2">
										<Button
											type="button"
											onClick={revealExportedFile}
											className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
										>
											{t("editor.actions.showInFolder", "Show In Folder")}
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={exp.handleExportDropdownClose}
											className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
										>
											Done
										</Button>
									</div>
								</div>
							) : (
								<ExportSettingsMenu
									exportFormat={prefs.exportFormat}
									onExportFormatChange={prefs.setExportFormat}
									exportEncodingMode={prefs.exportEncodingMode}
									onExportEncodingModeChange={prefs.setExportEncodingMode}
									mp4FrameRate={prefs.mp4FrameRate}
									onMp4FrameRateChange={prefs.setMp4FrameRate}
									exportPipelineModel={prefs.exportPipelineModel}
									onExportPipelineModelChange={prefs.setExportPipelineModel}
									exportQuality={prefs.exportQuality}
									onExportQualityChange={prefs.setExportQuality}
									gifFrameRate={prefs.gifFrameRate}
									onGifFrameRateChange={prefs.setGifFrameRate}
									gifLoop={prefs.gifLoop}
									onGifLoopChange={prefs.setGifLoop}
									gifSizePreset={prefs.gifSizePreset}
									onGifSizePresetChange={prefs.setGifSizePreset}
									mp4OutputDimensions={mp4OutputDimensions}
									gifOutputDimensions={gifOutputDimensions}
									onExport={exp.handleStartExportFromDropdown}
									className="shadow-2xl"
								/>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			{/* ── Main area ──────────────────────────────────────────── */}
			<div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
				<div className="flex min-h-0 flex-1 gap-3">
					{/* Settings sidebar */}
					<div className="flex flex-shrink-0 gap-1.5">
						{/* Icon rail */}
						<div className="flex flex-shrink-0 flex-col items-center gap-0.5 px-2 py-2">
							{editorSectionButtons.map((section) => {
								const isActive = prefs.activeEffectSection === section.id;
								return (
									<div key={section.id} className="flex items-center">
										<motion.button
											type="button"
											onClick={() =>
												prefs.setActiveEffectSection(section.id)
											}
											title={section.label}
											className="group relative flex h-9 w-9 items-center justify-center rounded-lg outline-none focus:outline-none focus-visible:outline-none"
											animate={{ opacity: isActive ? 1 : 0.55 }}
											transition={{ duration: 0.14 }}
										>
											{isActive && (
												<motion.span
													layoutId="rail-active-bg"
													className="absolute inset-0 rounded-lg bg-foreground/[0.08]"
													transition={{
														type: "spring",
														stiffness: 450,
														damping: 35,
													}}
												/>
											)}
											<motion.span
												className="relative z-10"
												animate={{
													color: isActive
														? "#2563EB"
														: "hsl(var(--foreground))",
												}}
												transition={{ duration: 0.14 }}
											>
												{typeof section.icon === "string" ? (
													<ExtensionIcon
														icon={section.icon}
														className="h-[27px] w-[27px]"
													/>
												) : (
													<section.icon
														className="h-[27px] w-[27px]"
														weight={isActive ? "fill" : "regular"}
													/>
												)}
											</motion.span>
										</motion.button>
										<div className="ml-1.5 h-1.5 w-1.5 flex-shrink-0">
											{isActive && (
												<motion.span
													layoutId="rail-active-dot"
													className="block h-1.5 w-1.5 rounded-full bg-[#2563EB]"
													initial={{ opacity: 0, scale: 0.5 }}
													animate={{ opacity: 1, scale: 1 }}
													exit={{ opacity: 0, scale: 0.5 }}
													transition={{
														type: "spring",
														stiffness: 500,
														damping: 32,
													}}
												/>
											)}
										</div>
									</div>
								);
							})}
							<div className="mt-auto pt-3">
								<motion.button
									type="button"
									onClick={() => toast.info("Account coming soon")}
									title="Account"
									className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground/55 outline-none transition hover:text-foreground focus:outline-none focus-visible:outline-none"
									whileHover={{ opacity: 1 }}
									initial={{ opacity: 0.55 }}
								>
									<motion.span className="absolute inset-0 rounded-lg bg-foreground/[0.04] opacity-0 transition group-hover:opacity-100" />
									<User className="relative z-10 h-[22px] w-[22px]" />
								</motion.button>
							</div>
						</div>
						{/* Panel */}
						{prefs.activeEffectSection === "extensions" ? (
							<ExtensionManager />
						) : (
							<SettingsPanel
								panelMode="editor"
								activeEffectSection={prefs.activeEffectSection}
								selected={prefs.wallpaper}
								onWallpaperChange={prefs.setWallpaper}
								selectedZoomDepth={
									regions.selectedZoomId
										? regions.zoomRegions.find(
												(z) => z.id === regions.selectedZoomId,
											)?.depth
										: null
								}
								onZoomDepthChange={(depth) =>
									regions.selectedZoomId &&
									regions.handleZoomDepthChange(depth)
								}
								selectedZoomId={regions.selectedZoomId}
								selectedZoomMode={
									regions.selectedZoomId
										? (regions.zoomRegions.find(
												(z) => z.id === regions.selectedZoomId,
											)?.mode ?? "auto")
										: null
								}
								onZoomModeChange={(mode) =>
									regions.selectedZoomId &&
									regions.handleZoomModeChange(mode)
								}
								onZoomDelete={regions.handleZoomDelete}
								selectedClipId={regions.selectedClipId}
								selectedClipSpeed={
									regions.selectedClipId
										? (regions.clipRegions.find(
												(c) => c.id === regions.selectedClipId,
											)?.speed ?? 1)
										: null
								}
								selectedClipMuted={
									regions.selectedClipId
										? (regions.clipRegions.find(
												(c) => c.id === regions.selectedClipId,
											)?.muted ?? false)
										: null
								}
								onClipSpeedChange={(speed) =>
									regions.selectedClipId &&
									regions.handleClipSpeedChange(speed)
								}
								onClipMutedChange={(muted) =>
									regions.selectedClipId &&
									regions.handleClipMutedChange(muted)
								}
								onClipDelete={regions.handleClipDelete}
								shadowIntensity={prefs.shadowIntensity}
								onShadowChange={prefs.setShadowIntensity}
								backgroundBlur={prefs.backgroundBlur}
								onBackgroundBlurChange={prefs.setBackgroundBlur}
								zoomMotionBlur={prefs.zoomMotionBlur}
								onZoomMotionBlurChange={prefs.setZoomMotionBlur}
								autoApplyFreshRecordingAutoZooms={
									prefs.autoApplyFreshRecordingAutoZooms
								}
								onAutoApplyFreshRecordingAutoZoomsChange={
									prefs.setAutoApplyFreshRecordingAutoZooms
								}
								connectZooms={prefs.connectZooms}
								onConnectZoomsChange={prefs.setConnectZooms}
								zoomInDurationMs={prefs.zoomInDurationMs}
								onZoomInDurationMsChange={prefs.setZoomInDurationMs}
								zoomInOverlapMs={prefs.zoomInOverlapMs}
								onZoomInOverlapMsChange={prefs.setZoomInOverlapMs}
								zoomOutDurationMs={prefs.zoomOutDurationMs}
								onZoomOutDurationMsChange={prefs.setZoomOutDurationMs}
								connectedZoomGapMs={prefs.connectedZoomGapMs}
								onConnectedZoomGapMsChange={prefs.setConnectedZoomGapMs}
								connectedZoomDurationMs={prefs.connectedZoomDurationMs}
								onConnectedZoomDurationMsChange={prefs.setConnectedZoomDurationMs}
								zoomInEasing={prefs.zoomInEasing}
								onZoomInEasingChange={prefs.setZoomInEasing}
								zoomOutEasing={prefs.zoomOutEasing}
								onZoomOutEasingChange={prefs.setZoomOutEasing}
								connectedZoomEasing={prefs.connectedZoomEasing}
								onConnectedZoomEasingChange={prefs.setConnectedZoomEasing}
								showCursor={prefs.showCursor}
								onShowCursorChange={prefs.setShowCursor}
								loopCursor={prefs.loopCursor}
								onLoopCursorChange={prefs.setLoopCursor}
								cursorStyle={prefs.cursorStyle}
								onCursorStyleChange={prefs.setCursorStyle}
								cursorSize={prefs.cursorSize}
								onCursorSizeChange={prefs.setCursorSize}
								cursorSmoothing={prefs.cursorSmoothing}
								onCursorSmoothingChange={prefs.setCursorSmoothing}
								zoomSmoothness={prefs.zoomSmoothness}
								onZoomSmoothnessChange={prefs.setZoomSmoothness}
								zoomClassicMode={prefs.zoomClassicMode}
								onZoomClassicModeChange={prefs.setZoomClassicMode}
								cursorMotionBlur={prefs.cursorMotionBlur}
								onCursorMotionBlurChange={prefs.setCursorMotionBlur}
								cursorClickBounce={prefs.cursorClickBounce}
								onCursorClickBounceChange={prefs.setCursorClickBounce}
								cursorClickBounceDuration={prefs.cursorClickBounceDuration}
								onCursorClickBounceDurationChange={
									prefs.setCursorClickBounceDuration
								}
								cursorSway={prefs.cursorSway}
								onCursorSwayChange={prefs.setCursorSway}
								borderRadius={prefs.borderRadius}
								onBorderRadiusChange={prefs.setBorderRadius}
								webcam={prefs.webcam}
								onWebcamChange={prefs.setWebcam}
								onUploadWebcam={handleUploadWebcam}
								onClearWebcam={handleClearWebcam}
								padding={prefs.padding}
								onPaddingChange={prefs.setPadding}
								frame={prefs.frame}
								onFrameChange={prefs.setFrame}
								cropRegion={prefs.cropRegion}
								onCropChange={prefs.setCropRegion}
								aspectRatio={prefs.aspectRatio}
								onAspectRatioChange={prefs.setAspectRatio}
								selectedAnnotationId={regions.selectedAnnotationId}
								annotationRegions={regions.annotationRegions}
								autoCaptions={captions.autoCaptions}
								autoCaptionSettings={captions.autoCaptionSettings}
								whisperExecutablePath={captions.whisperExecutablePath}
								whisperModelPath={captions.whisperModelPath}
								whisperModelDownloadStatus={captions.whisperModelDownloadStatus}
								whisperModelDownloadProgress={
									captions.whisperModelDownloadProgress
								}
								isGeneratingCaptions={captions.isGeneratingCaptions}
								onAutoCaptionSettingsChange={captions.setAutoCaptionSettings}
								onPickWhisperExecutable={captions.handlePickWhisperExecutable}
								onPickWhisperModel={captions.handlePickWhisperModel}
								onGenerateAutoCaptions={captions.handleGenerateAutoCaptions}
								onClearAutoCaptions={captions.handleClearAutoCaptions}
								onDownloadWhisperSmallModel={
									captions.handleDownloadWhisperSmallModel
								}
								onDeleteWhisperSmallModel={captions.handleDeleteWhisperSmallModel}
								onAnnotationContentChange={regions.handleAnnotationContentChange}
								onAnnotationTypeChange={regions.handleAnnotationTypeChange}
								onAnnotationStyleChange={regions.handleAnnotationStyleChange}
								onAnnotationFigureDataChange={
									regions.handleAnnotationFigureDataChange
								}
								onAnnotationBlurIntensityChange={
									regions.handleAnnotationBlurIntensityChange
								}
								onAnnotationBlurColorChange={
									regions.handleAnnotationBlurColorChange
								}
								onAnnotationDelete={regions.handleAnnotationDelete}
							/>
						)}
					</div>
					{/* Right column: preview + timeline */}
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						{/* Preview */}
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
								{/* Aspect ratio + crop controls */}
								<div className="flex items-center justify-center gap-2 py-1.5 flex-shrink-0">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1"
											>
												<span className="font-medium">
													{getAspectRatioLabel(prefs.aspectRatio)}
												</span>
												<ChevronDown className="w-3 h-3" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="center"
											className="bg-editor-surface-alt border-foreground/10"
										>
											{ASPECT_RATIOS.map((ratio) => (
												<DropdownMenuItem
													key={ratio}
													onClick={() => prefs.setAspectRatio(ratio)}
													className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer flex items-center justify-between gap-3"
												>
													<span>{getAspectRatioLabel(ratio)}</span>
													{prefs.aspectRatio === ratio && (
														<Check className="w-3 h-3 text-[#2563EB]" />
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
									<div className="w-[1px] h-4 bg-foreground/20" />
									<Button
										variant="ghost"
										size="sm"
										onClick={handleOpenCropEditor}
										className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1.5"
									>
										<Crop className="w-3.5 h-3.5" />
										<span className="font-medium">
											{t("settings.crop.title")}
										</span>
										{isCropped ? (
											<span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
										) : null}
									</Button>
								</div>
								{/* Video preview */}
								<div
									className="flex w-full min-h-0 flex-1 items-stretch"
									style={{ flex: "1 1 auto", margin: "6px 0 0" }}
								>
									<div className="flex min-w-0 flex-1 items-center justify-center px-1">
										<div
											className="relative overflow-hidden rounded-[30px]"
											style={{
												width: "auto",
												height: "100%",
												aspectRatio: getAspectRatioValue(
													prefs.aspectRatio,
													(() => {
														const previewVideo =
															videoPlaybackRef.current?.video;
														if (
															previewVideo &&
															previewVideo.videoHeight > 0
														) {
															return (
																previewVideo.videoWidth /
																previewVideo.videoHeight
															);
														}
														return 16 / 9;
													})(),
												),
												maxWidth: "100%",
												margin: "0 auto",
												boxSizing: "border-box",
											}}
										>
											<VideoPlayback
												key={`${videoPath || "no-video"}:${previewVersion}`}
												aspectRatio={prefs.aspectRatio}
												ref={videoPlaybackRef}
												videoPath={videoPath || ""}
												onDurationChange={setDuration}
												onPreviewReadyChange={setIsPreviewReady}
												onTimeUpdate={setCurrentTime}
												currentTime={currentTime}
												onPlayStateChange={setIsPlaying}
												onError={setError}
												wallpaper={prefs.wallpaper}
												zoomRegions={regions.effectiveZoomRegions}
												selectedZoomId={regions.selectedZoomId}
												onSelectZoom={regions.handleSelectZoom}
												onZoomFocusChange={regions.handleZoomFocusChange}
												isPlaying={isPlaying}
												showShadow={prefs.shadowIntensity > 0}
												shadowIntensity={prefs.shadowIntensity}
												backgroundBlur={prefs.backgroundBlur}
												zoomMotionBlur={prefs.zoomMotionBlur}
												connectZooms={prefs.connectZooms}
												zoomInDurationMs={prefs.zoomInDurationMs}
												zoomInOverlapMs={prefs.zoomInOverlapMs}
												zoomOutDurationMs={prefs.zoomOutDurationMs}
												connectedZoomGapMs={prefs.connectedZoomGapMs}
												connectedZoomDurationMs={
													prefs.connectedZoomDurationMs
												}
												zoomInEasing={prefs.zoomInEasing}
												zoomOutEasing={prefs.zoomOutEasing}
												connectedZoomEasing={prefs.connectedZoomEasing}
												borderRadius={prefs.borderRadius}
												padding={prefs.padding}
												frame={prefs.frame}
												cropRegion={prefs.cropRegion}
												webcam={prefs.webcam}
												webcamVideoPath={
													prefs.webcam.sourcePath
														? prefs.resolvedWebcamVideoUrl
														: null
												}
												trimRegions={regions.trimRegions}
												speedRegions={regions.effectiveSpeedRegions}
												annotationRegions={regions.annotationRegions}
												autoCaptions={captions.autoCaptions}
												autoCaptionSettings={captions.autoCaptionSettings}
												selectedAnnotationId={
													regions.selectedAnnotationId
												}
												onSelectAnnotation={
													regions.handleSelectAnnotation
												}
												onAnnotationPositionChange={
													regions.handleAnnotationPositionChange
												}
												onAnnotationSizeChange={
													regions.handleAnnotationSizeChange
												}
												cursorTelemetry={effectiveCursorTelemetry}
												showCursor={prefs.showCursor}
												cursorStyle={prefs.cursorStyle}
												cursorSize={prefs.cursorSize}
												cursorSmoothing={prefs.cursorSmoothing}
												zoomSmoothness={prefs.zoomSmoothness}
												zoomClassicMode={prefs.zoomClassicMode}
												cursorMotionBlur={prefs.cursorMotionBlur}
												cursorClickBounce={prefs.cursorClickBounce}
												cursorClickBounceDuration={
													prefs.cursorClickBounceDuration
												}
												cursorSway={prefs.cursorSway}
												volume={
													hasSourceAudioFallback
														? 0
														: prefs.previewVolume
												}
											/>
										</div>
									</div>
								</div>
							</div>
						</div>
						{/* Toolbar */}
						<div className="relative flex flex-shrink-0 items-center px-1 py-1">
							{/* Left tools */}
							<div className="z-10 flex min-w-0 flex-1 items-center gap-1.5">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 gap-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 text-[11px] text-foreground/65 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)] transition-all hover:bg-foreground/[0.08] hover:text-foreground"
										>
											<Plus className="w-3.5 h-3.5" />
											<span className="font-medium">
												{t("editor.toolbar.addLayer")}
											</span>
											<ChevronDown className="w-3 h-3" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										className="bg-editor-surface-alt border-foreground/10"
									>
										<DropdownMenuItem
											onClick={() => {
												const nextTrackIndex =
													regions.annotationRegions.length > 0
														? Math.max(
																...regions.annotationRegions.map(
																	(r) => r.trackIndex ?? 0,
																),
															) + 1
														: 0;
												timelineRef.current?.addAnnotation(nextTrackIndex);
											}}
											className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
										>
											{t("timeline.annotation.label")}
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => timelineRef.current?.addAudio()}
											className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
										>
											{t("timeline.audio.label")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<div className="w-[1px] h-4 bg-foreground/10 mx-1" />
								<Button
									onClick={() => timelineRef.current?.addZoom()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
									title={t("timeline.zoom.addZoom")}
								>
									<ZoomIn className="w-4 h-4" />
								</Button>
								<Button
									onClick={() => timelineRef.current?.suggestZooms()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
									title={t("timeline.zoom.suggestZooms")}
								>
									<WandSparkles className="w-4 h-4" />
								</Button>
								<Button
									onClick={() => timelineRef.current?.splitClip()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
									title={t("editor.toolbar.splitClip")}
								>
									<Scissors className="w-4 h-4" />
								</Button>
							</div>
							{/* Playback controls */}
							<div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
								<div className="flex items-center gap-1.5 pointer-events-auto">
									<span className="mr-1 text-[10px] font-medium tabular-nums text-muted-foreground">
										{formatTime(regions.timelinePlayheadTime)}
									</span>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
										title={t("editor.playback.skipBack")}
										onClick={() => {
											const currentMs =
												regions.timelinePlayheadTime * 1000;
											const kfs = timelineRef.current?.keyframes ?? [];
											const prev = [...kfs]
												.reverse()
												.find((k) => k.time < currentMs - 50);
											handleSeek(
												prev
													? prev.time / 1000
													: Math.max(
															0,
															regions.timelinePlayheadTime - 5,
														),
											);
										}}
									>
										<SkipBack className="w-3.5 h-3.5" weight="fill" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className={`h-7 w-7 rounded-full border border-foreground/10 transition-all shadow-[0_8px_18px_rgba(0,0,0,0.18)] ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
										onClick={togglePlayPause}
										title={isPlaying ? "Pause" : "Play"}
									>
										{isPlaying ? (
											<Pause className="w-3.5 h-3.5" weight="fill" />
										) : (
											<Play className="w-3.5 h-3.5" weight="fill" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
										title={t("editor.playback.skipForward")}
										onClick={() => {
											const currentMs =
												regions.timelinePlayheadTime * 1000;
											const kfs = timelineRef.current?.keyframes ?? [];
											const next = kfs.find((k) => k.time > currentMs + 50);
											handleSeek(
												next
													? next.time / 1000
													: Math.min(
															duration,
															regions.timelinePlayheadTime + 5,
														),
											);
										}}
									>
										<SkipForward className="w-3.5 h-3.5" weight="fill" />
									</Button>
									<span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums ml-1">
										{formatTime(duration)}
									</span>
								</div>
							</div>
							{/* Right: collapse + volume */}
							<div className="z-10 ml-auto flex items-center gap-2">
								<Button
									variant="ghost"
									size="icon"
									title={
										timelineCollapsed
											? t("editor.timeline.expand")
											: t("editor.timeline.collapse")
									}
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
									onClick={() => setTimelineCollapsed((p) => !p)}
								>
									{timelineCollapsed ? (
										<ChevronUp className="w-3.5 h-3.5" />
									) : (
										<ChevronDown className="w-3.5 h-3.5" />
									)}
								</Button>
								<div className="flex items-center gap-1.5">
									<button
										type="button"
										className="text-muted-foreground hover:text-foreground transition-colors"
										title={t("editor.playback.muteUnmute")}
										onClick={() =>
											prefs.setPreviewVolume(
												prefs.previewVolume <= 0.001 ? 1 : 0,
											)
										}
									>
										{prefs.previewVolume <= 0.001 ? (
											<VolumeX className="w-3.5 h-3.5" />
										) : prefs.previewVolume < 0.5 ? (
											<Volume1 className="w-3.5 h-3.5" />
										) : (
											<Volume2 className="w-3.5 h-3.5" />
										)}
									</button>
									<div className="relative flex h-7 w-24 select-none items-center overflow-hidden rounded-full border border-foreground/[0.06] bg-editor-bg/80 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]">
										<div
											className="absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-foreground/[0.08]"
											style={{
												width:
													prefs.previewVolume > 0
														? `max(calc(${prefs.previewVolume * 100}% - 6px), 1.2rem)`
														: 0,
											}}
										/>
										<div
											className="pointer-events-none absolute bottom-[18%] top-[18%] z-10 w-[2px] rounded-full bg-foreground/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]"
											style={{
												left: `calc(${prefs.previewVolume * 100}% - 8px)`,
											}}
										/>
										<span className="pointer-events-none relative z-10 pl-2 text-[10px] font-medium text-muted-foreground">
											{Math.round(prefs.previewVolume * 100)}%
										</span>
										<input
											type="range"
											min="0"
											max="1"
											step="0.01"
											value={prefs.previewVolume}
											onChange={(e) =>
												prefs.setPreviewVolume(Number(e.target.value))
											}
											className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
										/>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				{/* Timeline */}
				<div
					className="flex-shrink-0 flex flex-col"
					style={{
						height: timelineCollapsed ? undefined : "15%",
						minHeight: timelineCollapsed ? 0 : 160,
					}}
				>
					<TimelineEditor
						ref={timelineRef}
						hideToolbar
						videoDuration={duration}
						currentTime={currentTime}
						playheadTime={regions.timelinePlayheadTime}
						onSeek={handleSeek}
						videoPath={videoPath}
						cursorTelemetry={normalizedCursorTelemetry}
						autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
						onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
						zoomRegions={regions.zoomRegions}
						onZoomAdded={regions.handleZoomAdded}
						onZoomSuggested={regions.handleZoomSuggested}
						onZoomSpanChange={regions.handleZoomSpanChange}
						onZoomDelete={regions.handleZoomDelete}
						selectedZoomId={regions.selectedZoomId}
						onSelectZoom={regions.handleSelectZoom}
						trimRegions={regions.trimRegions}
						clipRegions={regions.clipRegions}
						onClipSplit={regions.handleClipSplit}
						onClipSpanChange={regions.handleClipSpanChange}
						onClipDelete={regions.handleClipDelete}
						selectedClipId={regions.selectedClipId}
						onSelectClip={regions.handleSelectClip}
						audioRegions={regions.audioRegions}
						onAudioAdded={regions.handleAudioAdded}
						onAudioSpanChange={regions.handleAudioSpanChange}
						onAudioDelete={regions.handleAudioDelete}
						selectedAudioId={regions.selectedAudioId}
						onSelectAudio={regions.handleSelectAudio}
						annotationRegions={regions.annotationRegions}
						onAnnotationAdded={regions.handleAnnotationAdded}
						onAnnotationSpanChange={regions.handleAnnotationSpanChange}
						onAnnotationDelete={regions.handleAnnotationDelete}
						selectedAnnotationId={regions.selectedAnnotationId}
						onSelectAnnotation={regions.handleSelectAnnotation}
						aspectRatio={prefs.aspectRatio}
					/>
				</div>
			</div>

			{/* ── Crop modal ─────────────────────────────────────────── */}
			{showCropModal ? (
				<>
					<div
						className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
						onClick={handleCancelCropEditor}
					/>
					<div className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-foreground/10 bg-background p-8 shadow-2xl animate-in zoom-in-95 duration-200">
						<div className="mb-6 flex items-center justify-between">
							<div>
								<span className="text-xl font-bold text-foreground">
									{t("settings.crop.title")}
								</span>
								<p className="mt-2 text-sm text-muted-foreground">
									{t("settings.crop.instruction")}
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancelCropEditor}
								className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
							>
								<X className="h-5 w-5" />
							</Button>
						</div>
						<CropControl
							videoElement={videoPlaybackRef.current?.video || null}
							cropRegion={prefs.cropRegion}
							onCropChange={prefs.setCropRegion}
							aspectRatio={prefs.aspectRatio}
						/>
						<div className="mt-6 flex justify-end">
							<Button
								onClick={handleCloseCropEditor}
								size="lg"
								className="bg-[#2563EB] text-white hover:bg-[#2563EB]/90"
							>
								{t("common.actions.done")}
							</Button>
						</div>
					</div>
				</>
			) : null}

			{projectBrowser}
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
