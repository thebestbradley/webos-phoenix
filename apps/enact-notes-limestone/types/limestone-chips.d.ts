// @enact/limestone/Chips ships without type definitions (1.11).
declare module '@enact/limestone/Chips' {
	import * as React from 'react';

	export interface ChipProps {
		id: string;
		children: string;
		checked?: boolean;
		disabled?: boolean;
		icon?: string;
		onClick?: (ev: React.MouseEvent) => void;
		className?: string;
	}
	export const Chip: React.ComponentType<ChipProps>;
	export const Chips: React.ComponentType<{children?: React.ReactNode; orientation?: 'horizontal' | 'vertical'; className?: string}>;
	export default Chips;
}
