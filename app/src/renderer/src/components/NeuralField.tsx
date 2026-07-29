import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { onPulse, onAmbientLevel } from '../../../shared/neuralFieldBus'
import { cssColor, vivid, makeGlowTexture } from '../webgl/glowTexture'

const PARTICLE_COUNT = 180
const CONNECT_DISTANCE = 110
const MAX_CONNECTIONS_PER_PARTICLE = 4
const BASE_PARTICLE_SIZE = 6.5
const BASE_PARTICLE_OPACITY = 0.9
const PULSE_DECAY = 0.94 // per frame — a pulse fades to near-nothing in ~1–1.5s at 60fps

// Light-theme "line-art" tuning — see the doctrine comment in index.css above
// `.neural-field-root`. Smaller, flatter marks and much thinner/fainter
// strokes than the dark theme's glowing-neuron register.
const LINE_ART_PARTICLE_SIZE = 3
const LINE_ART_PARTICLE_OPACITY = 0.3
const LINE_ART_LINE_OPACITY = 0.2
const LINE_ART_LINEWIDTH = 1.1

interface NeuralFieldProps {
  /** Resolved theme at mount. NeuralField is remounted on theme change (see
   * main.tsx's `key={theme}`), so this never needs to react live — it's read
   * once here to pick a rendering mode. */
  theme?: 'light' | 'dark'
}

/** Ambient WebGL backdrop — a slow-drifting field of "neurons" with bright
 * synapse connections, replacing the flat void background app-wide. Purely
 * decorative: fixed, pointer-events none, painted before everything else so
 * panels sit on top. Three signal colors (cyan / violet / orange) echo the
 * app's cool/warm ink duality plus the synthesis accent, mixed across the
 * field rather than a single flat hue.
 *
 * Under the light theme this same particle/line simulation renders in a
 * distinct "line-art" mode instead: additive glow blending is swapped for
 * plain alpha blending, the glow-sprite texture is dropped (a bare THREE.js
 * point renders as a flat square — the "small squares at intersections" the
 * reference calls for), and the tri-color signal palette collapses to a
 * single pale warm-gray ink, because a field of colored glow dots reads as a
 * decorative bug on bright paper where a monochrome technical-diagram wash
 * reads as intentional. The underlying particle motion/physics is identical
 * in both modes — only the rendering is mode-switched. */
export function NeuralField({ theme = 'dark' }: NeuralFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isLineArt = theme === 'light'

    // Line-art mode: one pale desaturated ink shared by every particle/line,
    // sampled from the light theme's own faint text tier rather than the
    // saturated cool/warm/violet signal triad — a faded-graphite wash, not a
    // colored glow. Dark mode keeps the existing three-color vivid palette.
    const cyan = vivid(cssColor('--color-ink-cool', '#5b8fa8'), 0.35, 0.18)
    const violet = vivid(cssColor('--color-ink-violet', '#a78bda'), 0.25, 0.12)
    const orange = vivid(cssColor('--color-ink-warm', '#e8a857'), 0.3, 0.1)
    const paleInk = cssColor('--color-hairline', '#cbbb98')
    const palette = isLineArt ? [paleInk] : [cyan, violet, orange]

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 2000)
    camera.position.z = 600

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // WebGL unavailable — the solid void background remains, nothing broken.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const velocities = new Float32Array(PARTICLE_COUNT * 3)
    const colors = new Float32Array(PARTICLE_COUNT * 3)
    const particleColors: THREE.Color[] = []

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1400
      positions[i * 3 + 1] = (Math.random() - 0.5) * 900
      positions[i * 3 + 2] = (Math.random() - 0.5) * 600
      velocities[i * 3] = (Math.random() - 0.5) * 0.12
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.12
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.08
      const c = palette[Math.floor(Math.random() * palette.length)]
      particleColors.push(c)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }

    // Line-art mode drops the glow sprite entirely — a THREE.Points material
    // with no `map` renders each point as a flat square, which is exactly
    // the reference's "small squares at intersections" mark rather than a
    // glowing sphere.
    const glowTexture = isLineArt ? null : makeGlowTexture()
    const particleGeo = new THREE.BufferGeometry()
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const particleMat = new THREE.PointsMaterial({
      size: isLineArt ? LINE_ART_PARTICLE_SIZE : BASE_PARTICLE_SIZE,
      map: glowTexture ?? undefined,
      vertexColors: true,
      transparent: true,
      opacity: isLineArt ? LINE_ART_PARTICLE_OPACITY : BASE_PARTICLE_OPACITY,
      sizeAttenuation: true,
      depthWrite: false,
      blending: isLineArt ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    const points = new THREE.Points(particleGeo, particleMat)
    scene.add(points)

    // Synapse lines — real screen-space width via Line2/LineMaterial (plain
    // LineBasicMaterial ignores linewidth on most WebGL backends). Colors
    // interpolate between each connection's two endpoint particles, so the
    // cyan/violet/orange mix actually blends across the field (dark mode);
    // in line-art mode every particle shares the same pale ink, so this
    // still works, it just interpolates a color with itself.
    const maxLines = PARTICLE_COUNT * MAX_CONNECTIONS_PER_PARTICLE
    const linePositions = new Float32Array(maxLines * 2 * 3)
    const lineColors = new Float32Array(maxLines * 2 * 3)
    const lineGeo = new LineSegmentsGeometry()
    const lineMat = new LineMaterial({
      linewidth: isLineArt ? LINE_ART_LINEWIDTH : 2.4, // screen-space pixels (worldUnits: false, the default)
      vertexColors: true,
      transparent: true,
      opacity: isLineArt ? LINE_ART_LINE_OPACITY : 0.55,
      depthWrite: false,
      blending: isLineArt ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    lineMat.resolution.set(container.clientWidth || 1, container.clientHeight || 1)
    const lines = new LineSegments2(lineGeo, lineMat)
    lines.frustumCulled = false
    scene.add(lines)

    // Connections are persistent slots with an eased alpha, not a binary
    // include/exclude rebuilt from scratch — that's what lets a line actually
    // fade in/out instead of popping the instant a distance threshold crosses.
    // Alpha is baked into vertex-color brightness each frame (additive blending
    // already makes a near-zero line read as invisible, no shader needed for a
    // real per-vertex alpha channel).
    const FADE_SPEED = 0.08
    interface ConnectionSlot {
      i: number
      j: number
      alpha: number
    }
    const slots = new Map<string, ConnectionSlot>()
    const degree = new Int8Array(PARTICLE_COUNT)

    function findNewConnections() {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        if (degree[i] >= MAX_CONNECTIONS_PER_PARTICLE) continue
        for (let j = i + 1; j < PARTICLE_COUNT; j++) {
          if (degree[j] >= MAX_CONNECTIONS_PER_PARTICLE) continue
          const key = `${i}:${j}`
          if (slots.has(key)) continue
          const dx = positions[i * 3] - positions[j * 3]
          const dy = positions[i * 3 + 1] - positions[j * 3 + 1]
          const dz = positions[i * 3 + 2] - positions[j * 3 + 2]
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < CONNECT_DISTANCE * CONNECT_DISTANCE) {
            slots.set(key, { i, j, alpha: 0 })
            degree[i]++
            degree[j]++
            if (degree[i] >= MAX_CONNECTIONS_PER_PARTICLE) break
          }
        }
      }
    }

    function updateConnections() {
      let count = 0
      for (const [key, slot] of slots) {
        const dx = positions[slot.i * 3] - positions[slot.j * 3]
        const dy = positions[slot.i * 3 + 1] - positions[slot.j * 3 + 1]
        const dz = positions[slot.i * 3 + 2] - positions[slot.j * 3 + 2]
        const d2 = dx * dx + dy * dy + dz * dz
        const inRange = d2 < CONNECT_DISTANCE * CONNECT_DISTANCE
        const target = inRange ? 1 : 0
        slot.alpha += (target - slot.alpha) * FADE_SPEED
        if (!inRange && slot.alpha < 0.01) {
          slots.delete(key)
          degree[slot.i]--
          degree[slot.j]--
          continue
        }
        if (count >= maxLines) continue
        const o = count * 6
        linePositions[o] = positions[slot.i * 3]
        linePositions[o + 1] = positions[slot.i * 3 + 1]
        linePositions[o + 2] = positions[slot.i * 3 + 2]
        linePositions[o + 3] = positions[slot.j * 3]
        linePositions[o + 4] = positions[slot.j * 3 + 1]
        linePositions[o + 5] = positions[slot.j * 3 + 2]
        const ca = particleColors[slot.i]
        const cb = particleColors[slot.j]
        lineColors[o] = ca.r * slot.alpha
        lineColors[o + 1] = ca.g * slot.alpha
        lineColors[o + 2] = ca.b * slot.alpha
        lineColors[o + 3] = cb.r * slot.alpha
        lineColors[o + 4] = cb.g * slot.alpha
        lineColors[o + 5] = cb.b * slot.alpha
        count++
      }
      lineGeo.setPositions(linePositions.subarray(0, count * 6))
      lineGeo.setColors(lineColors.subarray(0, count * 6))
    }

    let frame = 0
    let raf = 0
    let running = true
    let pulseIntensity = 0
    let ambient = 0
    // Tint bias: a short-lived pull of the particle color toward warm (resolve)
    // or violet (synthesis), decaying alongside pulseIntensity. The original
    // three pulse kinds never touch this — no tint, plain brightness/size boost.
    let tintIntensity = 0
    let tintColor: THREE.Color | null = null
    const mouse = { x: 0, y: 0 }

    // Reactive pulses on real milestones (a review recalled, a streak day, a
    // capstone cleared, a resolve beat, a synthesis job finishing) — see
    // neuralFieldBus.ts. The original three kinds keep the same flat
    // brightness/size boost; resolve and synthesis additionally bias the
    // particle color for the life of the pulse.
    const unsubscribePulse = onPulse((kind) => {
      if (kind === 'resolve') {
        pulseIntensity = 0.7
        tintIntensity = 0.7
        tintColor = orange
      } else if (kind === 'synthesis') {
        pulseIntensity = 0.8
        tintIntensity = 0.8
        tintColor = violet
      } else {
        pulseIntensity = 1
      }
    })

    // Ambient session momentum (0–1) — a subtle overall brightening as a Learn
    // session's recall streak builds, set via setAmbientLevel/reset on exit.
    const unsubscribeAmbient = onAmbientLevel((level) => {
      ambient = level
    })

    function onMouseMove(e: MouseEvent) {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouseMove)

    function tick() {
      if (!running) return
      frame++
      if (!reducedMotion) {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          positions[i * 3] += velocities[i * 3]
          positions[i * 3 + 1] += velocities[i * 3 + 1]
          positions[i * 3 + 2] += velocities[i * 3 + 2]
          if (positions[i * 3] > 700) positions[i * 3] = -700
          else if (positions[i * 3] < -700) positions[i * 3] = 700
          if (positions[i * 3 + 1] > 450) positions[i * 3 + 1] = -450
          else if (positions[i * 3 + 1] < -450) positions[i * 3 + 1] = 450
          if (positions[i * 3 + 2] > 300) positions[i * 3 + 2] = -300
          else if (positions[i * 3 + 2] < -300) positions[i * 3 + 2] = 300
        }
        particleGeo.attributes.position.needsUpdate = true
        if (frame % 12 === 0) findNewConnections()
        updateConnections()

        camera.position.x += (mouse.x * 40 - camera.position.x) * 0.02
        camera.position.y += (-mouse.y * 25 - camera.position.y) * 0.02
        camera.lookAt(0, 0, 0)

        const baseSize = isLineArt ? LINE_ART_PARTICLE_SIZE : BASE_PARTICLE_SIZE
        const baseOpacity = isLineArt ? LINE_ART_PARTICLE_OPACITY : BASE_PARTICLE_OPACITY
        const ambientOpacity = baseOpacity * (1 + 0.25 * ambient)
        if (pulseIntensity > 0.001) {
          particleMat.size = baseSize * (1 + pulseIntensity * 0.7)
          particleMat.opacity = Math.min(1, ambientOpacity + pulseIntensity * 0.1)
          pulseIntensity *= PULSE_DECAY
        } else if (particleMat.size !== baseSize || particleMat.opacity !== ambientOpacity) {
          particleMat.size = baseSize
          particleMat.opacity = ambientOpacity
          pulseIntensity = 0
        }

        // Subtle color tint, mixed toward the pulse's tint color and decaying
        // in step with pulseIntensity — restored to the base per-particle
        // color once the tint has faded out.
        if (tintIntensity > 0.001 && tintColor) {
          const mixAmount = tintIntensity * 0.35
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const base = particleColors[i]
            colors[i * 3] = base.r + (tintColor.r - base.r) * mixAmount
            colors[i * 3 + 1] = base.g + (tintColor.g - base.g) * mixAmount
            colors[i * 3 + 2] = base.b + (tintColor.b - base.b) * mixAmount
          }
          particleGeo.attributes.color.needsUpdate = true
          tintIntensity *= PULSE_DECAY
        } else if (tintIntensity !== 0) {
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const base = particleColors[i]
            colors[i * 3] = base.r
            colors[i * 3 + 1] = base.g
            colors[i * 3 + 2] = base.b
          }
          particleGeo.attributes.color.needsUpdate = true
          tintIntensity = 0
          tintColor = null
        }
      }

      renderer.render(scene, camera)
      if (!reducedMotion) raf = requestAnimationFrame(tick)
    }

    function resize() {
      const w = container!.clientWidth
      const h = container!.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      lineMat.resolution.set(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    function syncRunning() {
      const shouldRun = document.visibilityState === 'visible' && document.hasFocus()
      if (shouldRun && !running) {
        running = true
        raf = requestAnimationFrame(tick)
      } else if (!shouldRun && running) {
        running = false
        if (raf) cancelAnimationFrame(raf)
      }
    }
    document.addEventListener('visibilitychange', syncRunning)
    window.addEventListener('blur', syncRunning)
    window.addEventListener('focus', syncRunning)

    findNewConnections()
    // Reduced motion skips the animation loop entirely (see tick(), below) — jump
    // straight to full alpha once so connections still render as a static frame.
    if (reducedMotion) for (const slot of slots.values()) slot.alpha = 1
    updateConnections()
    raf = requestAnimationFrame(tick)

    return () => {
      running = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      unsubscribePulse()
      unsubscribeAmbient()
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('visibilitychange', syncRunning)
      window.removeEventListener('blur', syncRunning)
      window.removeEventListener('focus', syncRunning)
      particleGeo.dispose()
      particleMat.dispose()
      glowTexture?.dispose()
      lineGeo.dispose()
      lineMat.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none neural-field-root" aria-hidden />
}
