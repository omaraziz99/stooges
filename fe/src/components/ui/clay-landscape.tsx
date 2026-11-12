// A small claymation-style 3D scene for the team dashboard: one rounded clay
// hill per KPI item on a plateau, its height set by the team's evidence, and a
// kopi cup that hops beside them. Decorative only: the legend next to it
// carries the numbers, so it is aria-hidden and renders nothing without WebGL.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useReducedMotion } from 'motion/react'
import { usePrefs } from '../../lib/prefs'

/** One hill: a CSS colour (hex or var(--x)) and a height from 0 to 1. */
export type Hill = { color: string; value: number }

export function ClayLandscape({ hills, ground, className }: { hills: Hill[]; ground: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const still = useReducedMotion() ?? false
  const { theme } = usePrefs()
  const key = JSON.stringify([hills, ground, theme])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let scene: { dispose: () => void } | null = null
    // Wait a frame: the theme's CSS variables are applied in an effect that runs after this one.
    const frame = requestAnimationFrame(() => {
      try {
        const resolved = (JSON.parse(key)[0] as Hill[]).map((h) => ({ ...h, color: resolve(h.color) }))
        scene = createScene(el, resolved, resolve(ground), still)
      } catch {
        // No WebGL: the legend beside the scene still shows every value.
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      scene?.dispose()
    }
  }, [key, ground, still])

  return <div ref={ref} aria-hidden className={className} />
}

/** Any CSS colour (var(--x), oklch(), hex) as rgb(), which three.js can read: a 1-pixel canvas converts it. */
const resolve = (color: string) => {
  const v = color.match(/^var\((--[\w-]+)\)$/)
  const css = v ? getComputedStyle(document.documentElement).getPropertyValue(v[1]).trim() : color
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return css
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * A bell-shaped hill (a Gaussian profile: flared base, rounded top), 1 wide and
 * 1 tall, with a hand-pressed wobble so it reads as clay rather than CAD.
 */
function clayHill() {
  const floor = 0.06 // where the bell is cut off at the base
  const profile = Array.from({ length: 25 }, (_, k) => {
    const y = floor + (1 - floor) * (1 - (1 - k / 24) ** 1.6) // denser near the top
    return new THREE.Vector2(Math.sqrt(-Math.log(y) / -Math.log(floor)), (y - floor) / (1 - floor))
  })
  const base = new THREE.LatheGeometry(profile, 48)
  base.deleteAttribute('normal')
  base.deleteAttribute('uv')
  const dome = mergeVertices(base) // weld the seam so normals stay smooth
  base.dispose()
  const p = dome.attributes.position
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
    const k = y > 0.01 ? 1 + 0.035 * Math.sin(x * 5.1 + 1.7) * Math.sin(z * 4.3 + 0.4) * Math.sin(y * 6.7 + 2.3) : 1
    p.setXYZ(i, x * k, y * k, z * k)
  }
  dome.computeVertexNormals()
  return dome
}

const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2

function createScene(container: HTMLDivElement, hills: Hill[], ground: string, still: boolean) {
  const canvas = document.createElement('canvas')
  canvas.className = 'block size-full'
  container.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  const target = new THREE.Vector3(0, 0.2, 0.3)

  scene.add(new THREE.HemisphereLight(0xfff4e2, 0xc9a98a, 1.5))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(-5, 9, 6)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.bias = -0.0005
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 })
  scene.add(sun)

  const trash: { dispose: () => void }[] = []
  const clay = (color: THREE.ColorRepresentation) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 })
    trash.push(m)
    return m
  }
  const keep = <T extends THREE.BufferGeometry>(g: T) => (trash.push(g), g)
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    const o = new THREE.Mesh(g, m)
    o.castShadow = shadow
    o.receiveShadow = true
    return o
  }

  const plateau = mesh(keep(new THREE.CylinderGeometry(4.9, 5.1, 0.6, 72)), clay(ground), false)
  plateau.position.y = -0.3
  scene.add(plateau)

  // Hills left to right in item order (the legend's order), in two staggered rows.
  const shape = keep(clayHill())
  const span = 6.6
  const radius = Math.min(1.25, (span / Math.max(hills.length, 1)) * 0.95)
  const growing = hills.map((hill, i) => {
    const group = new THREE.Group()
    const body = mesh(shape, clay(hill.color))
    body.scale.set(radius, 0.3 + hill.value * 1.9, radius)
    group.add(body)
    const x = hills.length === 1 ? 0 : -span / 2 + (span * i) / (hills.length - 1)
    group.position.set(x, 0, i % 2 ? 0.9 : -0.5)
    group.scale.y = still ? 1 : 0.001
    scene.add(group)
    return { group, x, delay: i * 0.09 }
  })

  // The mascot: a kopi cup with a face.
  const cup = new THREE.Group()
  const porcelain = clay(0xfff3e0)
  const mug = mesh(keep(new THREE.CylinderGeometry(0.34, 0.27, 0.56, 40)), porcelain)
  mug.position.y = 0.28
  const coffee = mesh(keep(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 40)), clay(0x6b3b22))
  coffee.position.y = 0.55
  const handle = mesh(keep(new THREE.TorusGeometry(0.15, 0.05, 12, 28)), porcelain)
  handle.position.set(0.36, 0.3, 0)
  cup.add(mug, coffee, handle)
  const dot = keep(new THREE.SphereGeometry(1, 16, 12))
  const eye = clay(0x1a1410)
  const blush = clay(0xff8fab)
  for (const side of [-1, 1]) {
    const e = mesh(dot, eye, false)
    e.scale.setScalar(0.045)
    e.position.set(side * 0.11, 0.33, 0.31)
    const c = mesh(dot, blush, false)
    c.scale.set(0.055, 0.03, 0.02)
    c.position.set(side * 0.2, 0.25, 0.29)
    cup.add(e, c)
  }
  cup.position.set(2.9, 0, 2.7)
  cup.rotation.y = -0.3
  scene.add(cup)

  // A wide card stretches the scene sideways: the plateau becomes a long oval
  // and the hills spread out along it, instead of a small island in the middle.
  const stretchTo = (aspect: number) => {
    const stretch = Math.min(2.2, Math.max(1, aspect / 1.7))
    plateau.scale.x = stretch
    for (const { group, x } of growing) group.position.x = x * stretch
    cup.position.x = 2.9 * stretch
    return stretch
  }

  // Camera: pulled back far enough that the whole (stretched) plateau fits the card's width.
  const view = new THREE.Vector3(0, 0.52, 1).normalize()
  const look = new THREE.Vector2()
  const aim = new THREE.Vector2()
  let distance = 12
  const placeCamera = () => {
    const yaw = look.x * 0.18
    const dir = view.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    dir.y += look.y * 0.05
    camera.position.copy(target).addScaledVector(dir.normalize(), distance)
    camera.lookAt(target)
  }

  const resize = () => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    const stretch = stretchTo(camera.aspect)
    distance = Math.max(11, (5.7 * stretch) / (Math.tan(THREE.MathUtils.degToRad(16)) * camera.aspect))
    camera.updateProjectionMatrix()
    placeCamera()
    renderer.render(scene, camera)
  }
  const resizer = new ResizeObserver(resize)
  resizer.observe(container)

  let raf = 0
  let onScreen = true
  const start = performance.now()
  const frame = (now: number) => {
    const t = (now - start) / 1000
    for (const { group, delay } of growing) {
      const p = Math.min(Math.max((t - delay) / 0.9, 0), 1)
      group.scale.y = Math.max(easeOutBack(p), 0.001)
    }
    const hop = Math.abs(Math.sin(t * 2.2))
    cup.position.y = hop * 0.12
    cup.scale.set(1 + (1 - hop) * 0.04, 1 - (1 - hop) * 0.06, 1 + (1 - hop) * 0.04) // squash on landing
    look.lerp(aim, 0.06)
    placeCamera()
    renderer.render(scene, camera)
    if (onScreen) raf = requestAnimationFrame(frame)
  }

  const onPointer = (e: PointerEvent) => {
    const r = container.getBoundingClientRect()
    aim.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
  }
  const onLeave = () => aim.set(0, 0)
  // Off screen, stop animating; back on screen, carry on.
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    cancelAnimationFrame(raf)
    if (onScreen && !still) raf = requestAnimationFrame(frame)
  })
  if (!still) {
    container.addEventListener('pointermove', onPointer)
    container.addEventListener('pointerleave', onLeave)
    watcher.observe(container)
  }
  resize()

  return {
    dispose() {
      cancelAnimationFrame(raf)
      watcher.disconnect()
      resizer.disconnect()
      container.removeEventListener('pointermove', onPointer)
      container.removeEventListener('pointerleave', onLeave)
      for (const d of trash) d.dispose()
      renderer.dispose()
      canvas.remove()
    },
  }
}
