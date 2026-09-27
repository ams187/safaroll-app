/* eslint-disable react-hooks/immutability -- vendored: Reanimated .value writes are intentional */
import React, { memo } from "react"
import { Dimensions, StyleSheet, ViewStyle } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { Easing, Extrapolation, interpolate, runOnJS, SharedValue, useDerivedValue, withSpring, withTiming } from "react-native-reanimated"
import { Canvas, Path, Shadow } from "@shopify/react-native-skia"
// Vendored from ogulcanbagatir/rn-animated-components (MIT). Only change:
// the @/theme/colors import replaced by a local helper.
const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const { width: W, height: H } = Dimensions.get("window")

interface Props {
  containerStyle?: ViewStyle,
  width?: number,
  height?: number,
  minY?: number,
  maxY?: number,
  onAnimationEnd?: ()=> void,
  colors?: string[],
  progress: SharedValue<number>
}

const mapRange = (value: number, inputRange: Array<number>, outputRange: Array<number>, clamp?: boolean) => {
  "worklet"
  if(clamp){
    if(value < inputRange[0]){
      return outputRange[0]
    }else if(value > inputRange[1]){
      return outputRange[1]
    }
  }

  const res = outputRange[0] + ((value - inputRange[0]) * (outputRange[1] - outputRange[0])) / (inputRange[1] - inputRange[0])

  return res
}

function Curtain({ containerStyle, width = W, height = H, minY = 80, maxY = H - 60, onAnimationEnd, colors = ["#FFE8AD", "#EF5A57"], progress }: Props) {

  const onGesture = Gesture.Pan()
  .onBegin((e)=> {
    progress.value = withSpring(mapRange(e.y, [minY, maxY], [0, 1], true))
  })
  .onUpdate((e)=> {
    progress.value = mapRange(e.y, [minY, maxY], [0, 1], true)
  })
  .onFinalize((e)=> {
    if(e.y > height / 2 + 50){
      progress.value = withTiming(1, {easing: Easing.linear}, ()=> {
        onAnimationEnd && runOnJS(onAnimationEnd)()
      })
    }else{
      progress.value = withTiming(0, {duration: 1000})
    }
  })

  const leftPath = useDerivedValue(()=> {
    const start = interpolate(progress.value, [0, 0.7], [width / 2, 0], {extrapolateLeft: Extrapolation.CLAMP})
    const curve = interpolate(progress.value, [0.5, 0.7, 1], [width / 2, width * 0.1, 0], Extrapolation.CLAMP)
    const end = interpolate(progress.value, [0.7, 1], [width / 2, 0], Extrapolation.CLAMP)
    const curve2 = interpolate(progress.value, [0.5, 0.9], [width / 2, 0], Extrapolation.CLAMP)
    return `M ${start} 0 C ${curve} ${height / 2}, ${curve2} ${(height / 3) * 2}, ${end} ${height} L 0 ${height} L 0 0 Z`
  })

  const rightPath = useDerivedValue(()=> {
    const start = interpolate(progress.value, [0, 0.7], [width / 2, width], {extrapolateLeft: Extrapolation.CLAMP})
    const curve = interpolate(progress.value, [0.5, 0.7, 1], [width / 2, width * 0.9, width], Extrapolation.CLAMP)
    const end = interpolate(progress.value, [0.7, 1], [width / 2, width], Extrapolation.CLAMP)
    const curve2 = interpolate(progress.value, [0.5, 0.9], [width / 2, width], Extrapolation.CLAMP)
    return `M ${start} 0 C ${curve} ${height / 2}, ${curve2} ${(height / 3) * 2}, ${end} ${height} L ${width} ${height} L ${width} 0 Z`
  })

  return (
    <GestureDetector gesture={onGesture}>
      <Animated.View style={[containerStyle, {width, height}]}>
        <Canvas style={styles.canvas}>
          <Path
            path={leftPath}
            color={colors[0]}
            style={"fill"}
          >
            <Shadow
              dx={0}
              dy={0}
              blur={10}
              color={hexToRgba("#111111", 0.5)}
            />
          </Path>
          <Path
            path={rightPath}
            color={colors[1]}
            style={"fill"}
          >
            <Shadow
              dx={0}
              dy={0}
              blur={10}
              color={hexToRgba("#111111", 0.5)}
            />
          </Path>
        </Canvas>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  canvas: {
    width: "100%", 
    height: "100%"
  }
})

export default memo(Curtain)