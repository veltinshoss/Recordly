interface ClipRowItem {
	id: string;
	label?: string;
}
interface ClipRowProps {
	items: ClipRowItem[];
	selectedClipId?: string | null;
	selectAllBlocksActive?: boolean;
	onSelectClip?: (id: string) => void;
}

export function ClipRow({
	items,
	selectedClipId,
	selectAllBlocksActive,
	onSelectClip,
}: ClipRowProps) {
	return (
		<div className="relative h-full min-h-0 overflow-hidden">
			{items.map((item) => (
				<div
					key={item.id}
					className={
						selectAllBlocksActive || item.id === selectedClipId ? "selected" : ""
					}
					onClick={() => onSelectClip?.(item.id)}
				>
					{item.label}
				</div>
			))}
		</div>
	);
}
