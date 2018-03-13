const base62 = require('base-x')('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
const crypto = require('crypto')
const http = require('http')
const express = require('express')
const WebSocket = require('ws')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server, path: '/ws' })

const SESSION_SECRET = process.env.SESSION_SECRET || randomID(16)
const sessionMap = new Map()
const roomMap = new Map()

function randomID(length=8) {
  return base62.encode(crypto.randomBytes(length))
}

function validID(id) {
  return id.length > 3
}

function genSessionSecret(sessionID) {
  return base62.encode(crypto.createHmac('sha256', SESSION_SECRET).update(sessionID).digest())
}

function validSessionSecret(sessionID, sessionSecret) {
  if (!sessionID || !sessionSecret) {
    return false
  }

  const expectedSessionSecret = genSessionSecret(sessionID)
  if (sessionSecret.length !== expectedSessionSecret.length) {
    return false
  }

  return crypto.timingSafeEqual(Buffer.from(sessionSecret), Buffer.from(expectedSessionSecret))
}

wss.on('connection', (ws) => {
  const connectionData = {
    ws,
    sessionID: null,
    sessionSecret: null,
    roomID: null,
    expireTimeout: null,
  }

  ws.on('message', (msgBuf) => {
    const msg = JSON.parse(msgBuf.toString())

    if (msg.type === 'create' || msg.type === 'join') {
      if (connectionData.room) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'already_in_room',
          }),
        )
        return
      }

      if (msg.sessionSecret && validSessionSecret(msg.sessionID, msg.sessionSecret)) {
        if (sessionMap.has(msg.sessionID)) {
          clearTimeout(sessionMap.get(msg.sessionID).expireTimeout)
        }
        connectionData.sessionID = msg.sessionID
        connectionData.sessionSecret = msg.sessionSecret
      } else {
        connectionData.sessionID = randomID(16)
        connectionData.sessionSecret = genSessionSecret(connectionData.sessionID)
      }
      const {sessionID, sessionSecret} = connectionData
      sessionMap.set(sessionID, connectionData)

      let roomID
      if (msg.type === 'create') {
        while (!roomID || roomMap.has(roomID)) {
          roomID = randomID()
        }
      } else {
        if (!validID(msg.roomID)) {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'invalid_room_id',
            }),
          )
          return
        }
        roomID = msg.roomID
      }

      if (!roomMap.has(roomID)) {
        roomMap.set(roomID, {
          participants: new Set(),
        })
      }
      const roomData = roomMap.get(roomID)
      roomData.participants.add(sessionID)
      connectionData.roomID = roomID

      for (const otherSessionID of roomData.participants) {
        if (otherSessionID === sessionID) {
          continue
        }
        sessionMap.get(otherSessionID).ws.send(
          JSON.stringify({
            type: 'new_peer',
            peerID: sessionID,
            initiator: false,
          }),
        )
        ws.send(
          JSON.stringify({
            type: 'new_peer',
            peerID: otherSessionID,
            initiator: true,
          }),
        )
      }

      // Send joined event after peers so client can expect they've received the whole list.
      ws.send(
        JSON.stringify({
          type: 'joined',
          roomID,
          sessionID,
          sessionSecret,
        }),
      )
    } else if (msg.type === 'signal') {
      if (!connectionData.roomID) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'self_not_in_room',
          }),
        )
        return
      }

      const roomData = roomMap.get(connectionData.roomID)

      if (!roomData.participants.has(msg.peerID)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'target_not_in_room',
          }),
        )
        return
      }

      sessionMap.get(msg.peerID).ws.send(
        JSON.stringify({
          type: 'signal',
          peerID: connectionData.sessionID,
          data: msg.data,
        }),
      )
    } else {
      console.warn(connectionData.sessionID, 'unknown command', msg.type)
    }
  })

  ws.on('close', () => {
    const {roomID, sessionID} = connectionData
    if (roomID) {
      const roomParticipants = roomMap.get(roomID).participants
      roomParticipants.delete(sessionID)
      if (roomParticipants.size === 0) {
        roomMap.delete(roomID)
      }
    }
    connectionData.expireTimeout = setTimeout(() => {
      sessionMap.delete(sessionID)
    }, 1000 * 5 * 60)
  })
})

server.listen(process.env.SERVER_PORT, () => {
  console.log(`listening on port ${process.env.SERVER_PORT}`)
})
