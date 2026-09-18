import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/inspect-glb.mjs <file.glb>')
  process.exit(1)
}

const bytes = fs.readFileSync(file)
if (bytes.toString('ascii', 0, 4) !== 'glTF') {
  throw new Error(`${file} is not a binary glTF file`)
}

const jsonLength = bytes.readUInt32LE(12)
const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength))
let offset = 20 + jsonLength
let binary = null
while (offset + 8 <= bytes.length) {
  const chunkLength = bytes.readUInt32LE(offset)
  const chunkType = bytes.readUInt32LE(offset + 4)
  if (chunkType === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + chunkLength)
  offset += 8 + chunkLength
}

const componentReaders = {
  5120: { bytes: 1, read: (b, o) => b.readInt8(o) },
  5121: { bytes: 1, read: (b, o) => b.readUInt8(o) },
  5122: { bytes: 2, read: (b, o) => b.readInt16LE(o) },
  5123: { bytes: 2, read: (b, o) => b.readUInt16LE(o) },
  5125: { bytes: 4, read: (b, o) => b.readUInt32LE(o) },
  5126: { bytes: 4, read: (b, o) => b.readFloatLE(o) },
}

const typeSizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readAccessor(index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const component = componentReaders[accessor.componentType]
  const size = typeSizes[accessor.type]
  const stride = view.byteStride || component.bytes * size
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0)
  const rows = []
  for (let i = 0; i < accessor.count; i += 1) {
    const row = []
    for (let j = 0; j < size; j += 1) {
      row.push(component.read(binary, start + i * stride + j * component.bytes))
    }
    rows.push(row)
  }
  return rows
}

function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let k = 0; k < 4; k += 1) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k]
    }
  }
  return out
}

function trs(node) {
  if (node.matrix) return node.matrix
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale || [1, 1, 1]
  const [tx, ty, tz] = node.translation || [0, 0, 0]
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

const parents = new Map()
for (let i = 0; i < json.nodes.length; i += 1) {
  for (const child of json.nodes[i].children || []) parents.set(child, i)
}

const worldCache = new Map()
function worldMatrix(index) {
  if (worldCache.has(index)) return worldCache.get(index)
  const local = trs(json.nodes[index])
  const parent = parents.get(index)
  const world = parent == null ? local : multiply(worldMatrix(parent), local)
  worldCache.set(index, world)
  return world
}

function nodeBounds(index) {
  const node = json.nodes[index]
  if (node.mesh == null) return null
  const matrix = worldMatrix(index)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of json.meshes[node.mesh].primitives) {
    const position = json.accessors[primitive.attributes.POSITION]
    if (!position?.min || !position?.max) continue
    for (const x of [position.min[0], position.max[0]]) {
      for (const y of [position.min[1], position.max[1]]) {
        for (const z of [position.min[2], position.max[2]]) {
          const point = transformPoint(matrix, [x, y, z])
          for (let axis = 0; axis < 3; axis += 1) {
            min[axis] = Math.min(min[axis], point[axis])
            max[axis] = Math.max(max[axis], point[axis])
          }
        }
      }
    }
  }
  return min[0] === Infinity ? null : { min, max }
}

function round(value) {
  if (Array.isArray(value)) return value.map(round)
  if (typeof value === 'number') return Number(value.toFixed(6))
  return value
}

function parentPath(index) {
  const names = []
  let current = index
  while (current != null) {
    names.unshift(`${current}:${json.nodes[current].name || '(unnamed)'}`)
    current = parents.get(current)
  }
  return names.join(' > ')
}

const curtainPattern = /帘|curtain/i
const openingPattern = /墙|窗|window|wall/i

console.log(`File: ${path.resolve(file)}`)
console.log(`Nodes: ${json.nodes.length}, meshes: ${json.meshes?.length || 0}, animations: ${json.animations?.length || 0}`)
console.log('\n=== Curtain nodes ===')
for (let i = 0; i < json.nodes.length; i += 1) {
  const node = json.nodes[i]
  if (!curtainPattern.test(node.name || '')) continue
  console.log(JSON.stringify({
    index: i,
    name: node.name,
    parentPath: parentPath(i),
    translation: round(node.translation || [0, 0, 0]),
    rotation: round(node.rotation || [0, 0, 0, 1]),
    scale: round(node.scale || [1, 1, 1]),
    mesh: node.mesh,
    bounds: round(nodeBounds(i)),
  }))
}

console.log('\n=== Window/wall nodes near curtains ===')
for (let i = 0; i < json.nodes.length; i += 1) {
  const node = json.nodes[i]
  if (!openingPattern.test(node.name || '') || node.mesh == null) continue
  console.log(JSON.stringify({ index: i, name: node.name, bounds: round(nodeBounds(i)) }))
}

console.log('\n=== Curtain animation channels ===')
for (const [animationIndex, animation] of (json.animations || []).entries()) {
  const channels = []
  for (const channel of animation.channels) {
    const targetNode = json.nodes[channel.target.node]
    if (!curtainPattern.test(targetNode?.name || '') && !curtainPattern.test(animation.name || '')) continue
    const sampler = animation.samplers[channel.sampler]
    channels.push({
      target: `${channel.target.node}:${targetNode?.name || '(unnamed)'}`,
      path: channel.target.path,
      input: round(readAccessor(sampler.input)),
      output: round(readAccessor(sampler.output)),
      interpolation: sampler.interpolation || 'LINEAR',
    })
  }
  if (channels.length) console.log(JSON.stringify({ index: animationIndex, name: animation.name, channels }, null, 2))
}
