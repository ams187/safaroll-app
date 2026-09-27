/// <reference types="@webgpu/types" />

import { useEffect, useRef } from "react";
import { PixelRatio } from "react-native";
import {
  type CanvasRef,
  type NativeCanvas,
  useDevice,
} from "react-native-webgpu";

export interface WebGpuSceneProps {
  readonly canvas: NativeCanvas;
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly gpu: GPU;
  readonly presentationFormat: GPUTextureFormat;
}

export type RenderWebGpuScene = (timestamp: number) => void;

export type WebGpuScene = (
  props: WebGpuSceneProps
) => Promise<RenderWebGpuScene | undefined> | RenderWebGpuScene | undefined;

export interface UseWebGpuOptions {
  readonly alphaMode?: GPUCanvasAlphaMode;
}

export function useWebGPU(scene: WebGpuScene, options: UseWebGpuOptions = {}) {
  const { device } = useDevice();
  const canvasRef = useRef<CanvasRef>(null);
  const animationFrameId = useRef<number | null>(null);
  const alphaMode = options.alphaMode ?? "opaque";

  useEffect(() => {
    let cancelled = false;

    async function startScene() {
      const context = canvasRef.current?.getContext("webgpu");

      if (!(context && device) || cancelled) {
        return;
      }

      const canvas = context.canvas as HTMLCanvasElement;
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

      canvas.width = canvas.clientWidth * PixelRatio.get();
      canvas.height = canvas.clientHeight * PixelRatio.get();

      context.configure({
        alphaMode,
        device,
        format: presentationFormat,
      });

      const renderScene = await scene({
        canvas: context.canvas as unknown as NativeCanvas,
        context,
        device,
        gpu: navigator.gpu,
        presentationFormat,
      });

      if (cancelled || typeof renderScene !== "function") {
        return;
      }

      const render = () => {
        if (cancelled) {
          return;
        }

        renderScene(Date.now());
        context.present();
        animationFrameId.current = requestAnimationFrame(render);
      };

      animationFrameId.current = requestAnimationFrame(render);
    }

    startScene().catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      setTimeout(() => {
        throw error instanceof Error
          ? error
          : new Error("Failed to start WebGPU scene");
      }, 0);
    });

    return () => {
      cancelled = true;

      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [alphaMode, device, scene]);

  return canvasRef;
}
