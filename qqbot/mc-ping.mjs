// 直接读取 Minecraft Server List Ping 的 players.sample，补齐站点未上报的在线玩家名单。
import { createConnection } from 'node:net'

function varInt(value) {
  let current = value >>> 0
  const bytes = []
  while (true) {
    let byte = current & 0x7f
    current >>>= 7
    if (current !== 0) byte |= 0x80
    bytes.push(byte)
    if (current === 0) break
  }
  return Buffer.from(bytes)
}

function readVarInt(buffer, offset = 0) {
  let value = 0
  let shift = 0
  for (let index = offset; index < buffer.length; index += 1) {
    const byte = buffer[index]
    value |= (byte & 0x7f) << shift
    shift += 7
    if ((byte & 0x80) === 0) return { value: value >>> 0, size: index - offset + 1 }
    if (shift > 35) return null
  }
  return null
}

function stringField(value) {
  const bytes = Buffer.from(String(value || ''), 'utf8')
  return Buffer.concat([varInt(bytes.length), bytes])
}

export function getMcPlayerSample({ host, port, timeoutMs = 3000 }) {
  const targetHost = String(host || '').trim()
  const targetPort = Number(port)
  if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    return Promise.resolve({ names: [], online: 0, error: 'invalid address' })
  }
  return new Promise(resolve => {
    const socket = createConnection({ host: targetHost, port: targetPort })
    let buffer = Buffer.alloc(0)
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ names: [], online: 0, error: 'timeout' }), Math.max(1000, Number(timeoutMs) || 3000))

    socket.on('connect', () => {
      const handshake = Buffer.concat([
        varInt(0),
        varInt(47),
        stringField(targetHost),
        Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
        varInt(1),
      ])
      socket.write(Buffer.concat([varInt(handshake.length), handshake, varInt(1), Buffer.from([0])]))
    })

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      const packetLength = readVarInt(buffer)
      if (!packetLength || buffer.length < packetLength.size + packetLength.value) return
      const packet = buffer.subarray(packetLength.size, packetLength.size + packetLength.value)
      const packetId = readVarInt(packet)
      if (!packetId || packetId.value !== 0) return finish({ names: [], online: 0, error: 'unexpected packet' })
      let offset = packetId.size
      const jsonLength = readVarInt(packet, offset)
      if (!jsonLength) return finish({ names: [], online: 0, error: 'invalid json length' })
      offset += jsonLength.size
      const json = packet.subarray(offset, offset + jsonLength.value).toString('utf8')
      try {
        const data = JSON.parse(json)
        const online = Math.max(0, Number(data?.players?.online) || 0)
        const names = (Array.isArray(data?.players?.sample) ? data.players.sample : [])
          .map(player => String(player?.name || '').trim())
          .filter(Boolean)
        finish({ names: [...new Set(names)], online })
      } catch {
        finish({ names: [], online: 0, error: 'invalid json' })
      }
    })

    socket.on('error', error => finish({ names: [], online: 0, error: error.message }))
    socket.on('timeout', () => finish({ names: [], online: 0, error: 'timeout' }))
    socket.setTimeout(Math.max(1000, Number(timeoutMs) || 3000))
  })
}
