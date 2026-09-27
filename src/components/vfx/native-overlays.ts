// Guarded access to @native-springs/shaders. The overlays are native Metal
// views: importing them in a dev client built before the dependency was added
// throws at load time. This shim turns "module not linked yet" into "no
// overlay", so the JS bundle keeps working on both sides of the rebuild.
import type { ComponentType } from 'react';

type OverlayModule = {
  SparklesOverlay: ComponentType<any>;
  NeonOverlay: ComponentType<any>;
  LiquidMetalOverlay: ComponentType<any>;
  FireworksOverlay: ComponentType<any>;
  AuroraOverlay: ComponentType<any>;
};

let overlays: OverlayModule | null = null;
try {
  overlays = require('@native-springs/shaders') as OverlayModule;
} catch {
  overlays = null;
}

export const SparklesOverlay = overlays?.SparklesOverlay ?? null;
export const NeonOverlay = overlays?.NeonOverlay ?? null;
export const LiquidMetalOverlay = overlays?.LiquidMetalOverlay ?? null;
export const FireworksOverlay = overlays?.FireworksOverlay ?? null;
export const AuroraOverlay = overlays?.AuroraOverlay ?? null;
