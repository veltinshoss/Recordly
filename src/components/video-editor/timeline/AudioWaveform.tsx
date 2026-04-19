import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioPeaksData } from "./useAudioPeaks";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	timeStartMs: number;
	timeEndMs: number;
}

/**
 * Renders an audio waveform canvas clipped to a single clip item.
 * Maps pixels to [timeStartMs, timeEndMs] so the waveform aligns
 * with the clip's position on the timeline.
 */
export default function AudioWaveform({ peaks, timeStartMs, timeEndMs }: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [resizeKey, setResizeKey] = useState(0);

	const observerRef = useRef<ResizeObserver | null>(null);
	const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
		if (observerRef.current) {
			observerRef.current.disconnect();
			observerRef.current = null;
		}
		(canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = node;
		if (node) {
			const ro = new ResizeObserver(() => setResizeKey((k) => k + 1));
			ro.observe(node);
			observerRef.current = ro;
		}
	}, []);

	// Force a redraw after initial mount to handle cases where
	// ResizeObserver fires before layout is complete
	useEffect(() => {
		const id = requestAnimationFrame(() => setResizeKey((k) => k + 1));
		return () => cancelAnimationFrame(id);
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const rect = canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const width = Math.round(rect.width * dpr);
		const height = Math.round(rect.height * dpr);

		if (width === 0 || height === 0) return;

		canvas.width = width;
		canvas.height = height;

		ctx.clearRect(0, 0, width, height);

		const { peaks: peakData, durationMs } = peaks;
		if (durationMs <= 0 || peakData.length === 0) return;

		const clipDurationMs = timeEndMs - timeStartMs;
		if (clipDurationMs <= 0) return;

		const midY = height / 2;

		ctx.beginPath();
		for (let px = 0; px < width; px++) {
			const t = timeStartMs + (px / width) * clipDurationMs;
			const binIndex = Math.min(
				peakData.length - 1,
				Math.max(0, Math.floor((t / durationMs) * peakData.length)),
			);
			const amplitude = peakData[binIndex];
			const barHeight = amplitude * midY * 0.85;

			ctx.moveTo(px, midY - barHeight);
			ctx.lineTo(px, midY + barHeight);
		}

		ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
		ctx.lineWidth = dpr;
		ctx.stroke();
	}, [peaks, timeStartMs, timeEndMs, resizeKey]);

	return (
		<canvas
			ref={setCanvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ display: "block" }}
		/>
	);
}
