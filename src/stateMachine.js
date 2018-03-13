import { Machine, actions, assign, forwardTo, send } from 'xstate'
import Peer from 'simple-peer'
import { parse as parseSDP, write as encodeSDP } from 'sdp-transform'
import * as I from 'immutable'

import {userStreamWidth, userStreamHeight, castStreamWidth, castStreamHeight} from './constants'

function wsService(callback, onReceive) {
  const ws = new WebSocket(`wss://${window.location.host}/api/ws`)

  ws.addEventListener('open', () => {
    callback('WS.CONNECTED')
  })

  ws.addEventListener('close', (ev) => {
    callback({
      type: 'WS.DISCONNECTED',
      code: ev.code,
    })
  })

  ws.addEventListener('error', () => {
    callback('WS.ERROR')
  })

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)

    if (msg.type === 'joined') {
      callback({
        type: 'WS.RECEIVE.JOINED',
        roomID: msg.roomID,
        sessionID: msg.sessionID,
        sessionSecret: msg.sessionSecret,
      })
    } else if (msg.type === 'new_peer') {
      callback({
        type: 'WS.RECEIVE.NEW_PEER',
        peerID: msg.peerID,
        initiator: msg.initiator,
      })
    } else if (msg.type === 'signal') {
      callback({
        type: 'WS.RECEIVE.SIGNAL',
        peerID: msg.peerID,
        data: msg.data,
      })
    } else if (msg.type === 'error') {
      callback({
        type: 'WS.RECEIVE.ERROR',
        error: msg.error,
      })
    }
  })

  onReceive((ev) => {
    if (ev.type === 'WS.SEND.CREATE') {
      ws.send(
        JSON.stringify({
          type: 'create',
        }),
      )
    } else if (ev.type === 'WS.SEND.JOIN') {
      ws.send(
        JSON.stringify({
          type: 'join',
          roomID: ev.roomID,
          sessionID: ev.sessionID,
          sessionSecret: ev.sessionSecret,
        }),
      )
    } else if (ev.type === 'RTC.SIGNAL') {
      ws.send(
        JSON.stringify({
          type: 'signal',
          peerID: ev.peerID,
          data: ev.data,
        }),
      )
    }
  })

  return () => {
    ws.close()
  }
}

const rtcService = (callback, onReceive) => {
  const peers = new Map()
  let peerStates = new I.Map()
  let userStream
  let castStream
  let audioActive = false

  const PeerInfo = I.Record({ state: 'new', streams: I.Map(), expireTimeout: null })
  const StreamInfo = I.Record({ stream: undefined, audioOnly: true, audioActive: false, kind: undefined })

  function updatePeers(newPeerStates) {
    peerStates = newPeerStates
    callback({
      type: 'RTC.PEER_STATE',
      peers: peerStates,
    })
  }

  function sdpTransform(sdp) {
    const sdpData = parseSDP(sdp)
    for (const m of sdpData.media) {
      for (const f of m.fmtp) {
        if (f.payload === 111) {
          f.config.replace('maxaveragebitrate=d+;?', '')
          f.config += ';maxaveragebitrate=160000'
          f.config.replace('stereo=d+;?', '')
          f.config += ';stereo=1'
        }
      }
    }
    return encodeSDP(sdpData)
  }

  function startPeer(peerID, initiator) {
    if (peers.has(peerID)) {
      if (peerStates.get(peerID).state === 'connected') {
        return
      }
      clearTimeout(peerStates.get(peerID).expireTimeout)
    }

    const peer = new Peer({
      initiator,
      streams: [userStream, castStream].filter((x) => x),
      sdpTransform,
    })

    peer.on('signal', (data) => {
      callback({
        type: 'RTC.SIGNAL',
        peerID,
        data,
      })
    })

    peer.on('connect', () => {
      try {
        if (userStream) {
          peer.send(
            JSON.stringify({
              type: 'stream',
              id: userStream.id,
              kind: 'user',
            }),
          )
          peer.send(
            JSON.stringify({
              type: 'activity',
              id: userStream.id,
              audioActive,
            }),
          )
        }
        if (castStream) {
          peer.send(
            JSON.stringify({
              type: 'stream',
              id: castStream.id,
              kind: 'cast',
            }),
          )
        }
      } catch (err) {
        console.warn('failed to send peer stream info', err)
      }

      updatePeers(peerStates.setIn([peerID, 'state'], 'connected'))
    })

    peer.on('data', (data) => {
      let msg
      try {
        msg = JSON.parse(data)
      } catch (error) {
        callback({
          type: 'RTC.DATA_ERROR',
          error,
        })
        return
      }

      if (msg.type === 'stream') {
        updatePeers(peerStates.updateIn(
          [peerID, 'streams', msg.id],
          StreamInfo(),
          (s) => s.set('kind', msg.kind),
        ))

        if (msg.kind === 'cast') {
          callback({
            type: 'RTC.RECEIVE.CAST',
            id: msg.id,
          })
        }
      } else if (msg.type === 'activity') {
        updatePeers(peerStates.updateIn(
          [peerID, 'streams', msg.id],
          StreamInfo(),
          p => p.set('audioActive', msg.audioActive)
        ))
      }
    })

    peer.on('track', (track, stream) => {
      updatePeers(
        peerStates.updateIn([peerID, 'streams', stream.id], StreamInfo(), (s) =>
          s.merge({
            stream,
            audioOnly: stream.getVideoTracks().length === 0,
          }),
        ),
      )

      if (track.kind === 'video') {
        function checkVideoAvailable() {
          updatePeers(
            peerStates.updateIn([peerID, 'streams', stream.id], StreamInfo(), (s) =>
              s.set('audioOnly', stream.getVideoTracks().filter(t => !t.muted).length === 0),
            )
          )
        }
        track.addEventListener('mute', checkVideoAvailable)
        track.addEventListener('unmute', checkVideoAvailable)
      }
    })

    peer.on('stream', (stream) => {
      stream.addEventListener('removetrack', () => {
        if (stream.getTracks().every((t) => t.readyState === 'ended')) {
          updatePeers(peerStates.deleteIn([peerID, 'streams', stream.id]))
        }
      })
    })

    peer.on('close', () => {
      peer.destroy()
      peers.delete(peerID)
      if (peerStates.get(peerID, {}).state === 'error') {
        // Keep peers in an error state around for a few seconds so they are visible.
        updatePeers(peerStates.setIn([peerID, 'expireTimeout'],
          setTimeout(() => {
            updatePeers(peerStates.delete(peerID))
          }, 3000))
        )
      } else {
        updatePeers(peerStates.delete(peerID))
      }
    })

    peer.on('error', (error) => {
      if (peerStates.get(peerID, {}).state === 'connecting') {
        updatePeers(peerStates.setIn([peerID, 'state'], 'error'))
      }
      callback({
        type: 'RTC.ERROR',
        error,
      })
    })

    peers.set(peerID, peer)
    updatePeers(peerStates.set(peerID, PeerInfo({ state: 'connecting' })))
  }

  onReceive((ev) => {
    if (ev.type === 'WS.RECEIVE.NEW_PEER') {
      startPeer(ev.peerID, ev.initiator)
    } else if (ev.type === 'WS.RECEIVE.SIGNAL') {
      if (peers.has(ev.peerID)) {
        peers.get(ev.peerID).signal(ev.data)
      } else {
        console.warn('unknown peer', ev.peerID, peers)
      }
    } else if (
      ev.type === 'MEDIA.USER.ADD_STREAM' ||
      ev.type === 'MEDIA.CAST.ADD_STREAM'
    ) {
      if (ev.type === 'MEDIA.USER.ADD_STREAM') {
        userStream = ev.stream
      } else if (ev.type === 'MEDIA.CAST.ADD_STREAM') {
        castStream = ev.stream
      }
      for (const peer of peers.values()) {
        try {
          peer.send(
            JSON.stringify({
              type: 'stream',
              id: ev.stream.id,
              kind: ev.type === 'MEDIA.USER.ADD_STREAM' ? 'user' : 'cast',
            }),
          )
          if (ev.type === 'MEDIA.CAST.ADD_STREAM') {
            peer.addStream(ev.stream)
          }
        } catch (err) {
          console.warn('failed to send peer stream info', err)
        }
      }
    } else if (
      ev.type === 'MEDIA.USER.ADD_TRACK' ||
      ev.type === 'MEDIA.USER.REMOVE_TRACK'
    ) {
      const action = ev.type === 'MEDIA.USER.ADD_TRACK' ? 'addTrack' : 'removeTrack'
      for (const peer of peers.values()) {
        try {
          peer[action](ev.track, ev.stream)
        } catch (err) {
          console.warn(`failed to ${action}`, err)
        }
      }
    } else if (ev.type === 'MEDIA.CAST.REMOVE_STREAM') {
      for (const peer of peers.values()) {
        try {
          peer.removeStream(ev.stream)
        } catch (err) {
          console.warn('failed to remove stream', err)
        }
      }
      castStream = null
    } else if (ev.type === 'MEDIA.USER.MUTED.AUDIO' || ev.type === 'MEDIA.USER.UNMUTED.AUDIO') {
      audioActive = ev.type === 'MEDIA.USER.UNMUTED.AUDIO' ? true : false
      for (const peer of peers.values()) {
        try {
          peer.send(
            JSON.stringify({
              type: 'activity',
              id: ev.stream.id,
              audioActive,
            }),
          )
        } catch (err) {
          console.warn('failed to send peer audio activity info', err)
        }
      }
    }
  })

  return () => {
    for (const peer of peers.values()) {
      peer.destroy()
    }
  }
}

const COMMON_AUDIO_SETTINGS = {
  echoCancellation: false,
  autoGainControl: false,
  noiseSuppression: false,
}

class ChannelMapperTrack {
  constructor(inputTrack, audioCtx) {
    this.audioCtx = audioCtx

    // sourceNode -> splitterNode -> mergerNode -> destinationNode
    this.splitterNode = audioCtx.createChannelSplitter()
    this.mergerNode = audioCtx.createChannelMerger()
    const destinationNode = audioCtx.createMediaStreamDestination()
    this.mergerNode.connect(destinationNode)

    this.setSource(inputTrack)

    const outputTrack = destinationNode.stream.getTracks()[0]
    outputTrack.addEventListener('ended', () => newTrack.stop())
    this.outputTrack = outputTrack
  }

  setSource(track) {
    if (this.sourceNode) {
      this.sourceNode.disconnect()
    }
    const sourceNode = this.audioCtx.createMediaStreamSource(new MediaStream([track]))
    sourceNode.connect(this.splitterNode)
    const {channelCount} = track.getSettings()
    this.channelCount = channelCount
    this.setChannelMap(0, Math.min(channelCount - 1, 1))

    this.inputTrack = track
    this.sourceNode = sourceNode
  }

  setChannelMap(left, right) {
    if (left === undefined) {
      left = this.channelMap.left
    }
    if (right === undefined) {
      right = this.channelMap.right
    }
    const {splitterNode, mergerNode} = this
    splitterNode.disconnect()
    splitterNode.connect(mergerNode, left, 0)
    splitterNode.connect(mergerNode, right, 1)
    this.channelMap = {left, right}
  }
}

const userMediaService = (callback, onReceive) => {
  let stream = null
  let isAudioMuted = true
  let audioCtx = null
  let channelMapperTrack = null
  
  async function acquireStream(reqs) {
    let newStream
    try {
      newStream = await navigator.mediaDevices.getUserMedia(reqs)
    } catch (error) {
      callback({ type: 'MEDIA.USER.ACQUIRE.ERROR', stream, error, reqs })
      return
    }
    return newStream
  }

  async function checkAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext()
    }

    const devices = await navigator.mediaDevices.enumerateDevices()

    callback({
      type: 'MEDIA.USER.DEVICES.AUDIO',
      devices: devices.filter(d => d.kind === 'audioinput')
    })

    for (const device of devices) {
      if (device.kind === 'audioinput' && device.label) {
        callback('MEDIA.USER.GRANTED.AUDIO')
        return
      }
    }
  }

  function emitAudioSettings() {
    const {inputTrack, channelCount, channelMap} = channelMapperTrack
    callback({
      type: 'MEDIA.USER.DEVICES.AUDIO_SETTINGS',
      audioDeviceSettings: {
        label: inputTrack.label,
        deviceId: inputTrack.getSettings().deviceId,
        channelCount,
        left: channelMap.left,
        right: channelMap.right,
      },
    })
  }

  function setChannelMap(left, right) {
    if (!channelMapperTrack) {
      return
    }
    channelMapperTrack.setChannelMap(left, right)
    emitAudioSettings()
  }

  async function setSource(deviceId) {
    if (!channelMapperTrack) {
      return
    }

    // Firefox errors with "Concurrent mic process limit." if we try to listen to two mics at the same time.
    channelMapperTrack.inputTrack.stop()

    const newStream = await acquireStream({
      audio: {
        ...COMMON_AUDIO_SETTINGS,
        deviceId,
      }
    })
    if (!newStream) {
      return
    }
    channelMapperTrack.setSource(newStream.getAudioTracks()[0])
    emitAudioSettings()
  }

  async function acquire({ audio, video }) {
    const reqs = {}

    if (audio && !(stream && stream.getAudioTracks().length)) {
      reqs.audio = COMMON_AUDIO_SETTINGS
    }
    if (video && !(stream && stream.getVideoTracks().length)) {
      reqs.video = {
        width: {ideal: userStreamWidth},
        height: {ideal: userStreamHeight},
        facingMode: 'user',
      }
    }

    if (!reqs.audio && !reqs.video) {
      return
    }

    const newStream = await acquireStream(reqs)
    if (!newStream) {
      return
    }

    if (!stream) {
      stream = newStream
      callback({
        type: 'MEDIA.USER.ADD_STREAM',
        stream,
      })
    }

    for (let track of newStream.getTracks()) {
      if (track.kind === 'audio') {
        // Remove original track and replace with channel mapped track output.
        stream.removeTrack(track)
        channelMapperTrack = new ChannelMapperTrack(track, audioCtx)
        track = channelMapperTrack.outputTrack
      }

      stream.addTrack(track)
      callback({
        type: 'MEDIA.USER.ADD_TRACK',
        stream,
        track,
      })
    }

    updateAudioMuted()

    if (reqs.audio) {
      callback('MEDIA.USER.ACQUIRED.AUDIO')
      emitAudioSettings()
    }

    if (reqs.video) {
      callback('MEDIA.USER.ACQUIRED.VIDEO')
    }
  }

  function releaseVideo() {
    if (!stream) {
      return
    }

    for (const track of stream.getVideoTracks()) {
      track.stop()
      stream.removeTrack(track)
      callback({
        type: 'MEDIA.USER.REMOVE_TRACK',
        stream,
        track,
      })
    }
  }

  function updateAudioMuted() {
    for (const track of stream.getAudioTracks()) {
      track.enabled = !isAudioMuted
    }
    callback({
      type: isAudioMuted ? 'MEDIA.USER.MUTED.AUDIO' : 'MEDIA.USER.UNMUTED.AUDIO',
      stream,
    })
  }

  function stop() {
    if (!stream) {
      return
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  navigator.mediaDevices.addEventListener('devicechange', checkAudio)

  onReceive((ev) => {
    if (ev.type === 'MEDIA.USER.CHECK.AUDIO') {
      checkAudio()
    } else if (ev.type === 'MEDIA.USER.ACQUIRE.AUDIO') {
      acquire({audio: true})
    } else if (ev.type === 'MEDIA.USER.ACQUIRE.VIDEO') {
      acquire({video: true})
    } else if (ev.type === 'MEDIA.USER.RELEASE.VIDEO') {
      releaseVideo()
    } else if (ev.type === 'MEDIA.USER.MUTE.AUDIO') {
      isAudioMuted = true
      updateAudioMuted()
    } else if (ev.type === 'MEDIA.USER.UNMUTE.AUDIO') {
      isAudioMuted = false
      updateAudioMuted()
    } else if (ev.type === 'SET_CHANNEL_MAP') {
      setChannelMap(ev.left, ev.right)
    } else if (ev.type === 'SET_AUDIO_SOURCE') {
      setSource(ev.deviceId)
    }
  })

  return stop
}

const castMediaService = (callback, onReceive) => {
  let stream = null

  async function acquire() {
    if (stream) {
      return
    }

    const reqs = {
      audio: COMMON_AUDIO_SETTINGS,
      video: {
        width: castStreamWidth,
        height: castStreamHeight,
      },
    }

    try {
      stream = await navigator.mediaDevices.getDisplayMedia(reqs)
    } catch (error) {
      callback({ type: 'MEDIA.CAST.ACQUIRE.ERROR', stream, error, reqs })
      return
    }

    for (const track of stream.getTracks()) {
      track.addEventListener('ended', checkFinished)
    }

    callback({
      type: 'MEDIA.CAST.ADD_STREAM',
      stream,
    })
  }

  function stop() {
    if (!stream) {
      return
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    checkFinished()
  }

  function checkFinished() {
    const finished = stream.getTracks().every(t => t.readyState === 'ended')
    if (finished) {
      callback({
        type: 'MEDIA.CAST.REMOVE_STREAM',
        stream,
      })
      stream = null
    }
  } 

  onReceive((ev) => {
    if (ev.type === 'MEDIA.CAST.ACQUIRE') {
      acquire()
    } else if (ev.type === 'MEDIA.CAST.RELEASE') {
      stop()
    }
  })

  return stop
}

const stateMachine = Machine(
  {
    type: 'parallel',
    context: {
      roomID: null,
      sessionID: null,
      sessionSecret: null,
      userStream: null,
      castStream: null,
      audioDevices: [],
      audioDeviceSettings: null,
      transmitMode: 'ptt',
      peers: I.Map(),
      castingTipsSeen: false,
    },
    states: {
      log: {
        on: {
          '*': { actions: 'log' },
        },
      },
      media: {
        invoke: [
          {
            id: 'UserMedia',
            src: 'userMedia'
          },
          {
            id: 'CastMedia',
            src: 'castMedia'
          },
        ],
        on: {
          'SET_AUDIO_SOURCE': {
            actions: forwardTo('UserMedia'),
          },
          'SET_CHANNEL_MAP': {
            actions: forwardTo('UserMedia'),
          },
          'MEDIA.USER.DEVICES.AUDIO': {
            actions: assign((context, event) => ({
              audioDevices: event.devices,
            })),
          },
          'MEDIA.USER.DEVICES.AUDIO_SETTINGS': {
            actions: assign((context, event) => ({
              audioDeviceSettings: event.audioDeviceSettings,
            })),
          },
          'MEDIA.USER.ADD_STREAM': {
            actions: assign((context, event) => ({
              userStream: event.stream,
            })),
          },
          'MEDIA.CAST.ADD_STREAM': {
            actions: assign((context, event) => ({
              castStream: event.stream,
            })),
          },
          'MEDIA.CAST.REMOVE_STREAM': {
            actions: assign({
              castStream: null
            }),
          },
        },
      },
      room: {
        initial: 'nowhere',
        on: {
          'SET_ROOM_ID': {
            cond: 'isNavigating',
            target: '.nowhere',
            actions: assign((context, event) => ({
              roomID: event.roomID,
            })),
            internal: false,
          },
        },
        states: {
          nowhere: {
            entry: [
              'updateLocation',
              send('RTC.STOP'),
              send('WS.STOP'),
            ],
            on: {
              START: 'connecting',
            },
          },
          connecting: {
            initial: 'firstTry',
            entry: send('WS.START'),
            on: {
              '': {
                target: 'joining',
                in: { ws: 'running.connected' },
              },
            },
            states: {
              firstTry: {
                on: {
                  'WS.ERROR': 'retrying',
                },
              },
              retrying: {},
            },
          },
          joining: {
            entry: [
              send('RTC.START'),
              actions.choose([
                {
                  actions: send(
                    (context) => ({
                      type: 'WS.SEND.JOIN',
                      roomID: context.roomID,
                      sessionID: context.sessionID,
                      sessionSecret: context.sessionSecret,
                    }),
                    { to: 'WSService' },
                  ),
                  cond: 'contextHasRoomID',
                },
                {
                  actions: send('WS.SEND.CREATE', { to: 'WSService' }),
                },
              ]),
            ],
            on: {
              'WS.RECEIVE.JOINED': {
                actions: assign((context, event) => ({
                  roomID: event.roomID,
                  sessionID: event.sessionID,
                  sessionSecret: event.sessionSecret,
                })),
                target: 'joined',
              },
              'WS.RECEIVE.NEW_PEER': {
                actions: forwardTo('RTCService'),
              },
            },
          },
          joined: {
            entry: [
              'updateLocation',
              send('MEDIA.USER.CHECK.AUDIO', {to: 'UserMedia'}),
            ],
            on: {
              'WS.RECEIVE.SIGNAL': {
                actions: forwardTo('RTCService'),
              },
              'WS.RECEIVE.NEW_PEER': {
                actions: forwardTo('RTCService'),
              },
              'WS.CONNECTED': 'joining',
            },
          },
        },
      },
      voice: {
        id: 'voice',
        initial: 'noPermission',
        states: {
          noPermission: {
            on: {
              'MEDIA.USER.GRANTED.AUDIO': 'waitingForMedia',
              'VOICE.START': 'waitingForMedia',
            },
          },
          waitingForMedia: {
            entry: send('MEDIA.USER.ACQUIRE.AUDIO', {to: 'UserMedia'}),
            on: {
              'MEDIA.USER.ACQUIRED.AUDIO': 'hasMedia',
              'MEDIA.USER.ACQUIRE.ERROR': 'noPermission',
            },
          },
          hasMedia: {
            initial: 'idle',
            states: {
              idle: {
                on: {
                  'VOICE.START': 'sending',
                  'SET.TRANSMIT_MODE': {
                    target: 'sending',
                    cond: 'isTransmitContinuous',
                  },
                },
              },
              sending: {
                entry: send('MEDIA.USER.UNMUTE.AUDIO', {to: 'UserMedia'}),
                on: {
                  'VOICE.STOP': 'releasing',
                  'SET.TRANSMIT_MODE': {
                    target: 'releasing',
                    cond: 'isTransmitPTT',
                  },
                },
              },
              releasing: {
                exit: send('MEDIA.USER.MUTE.AUDIO', {to: 'UserMedia'}),
                after: {
                  RELEASE_DELAY: 'idle',
                },
                on: {
                  'VOICE.START': 'sending',
                },
              },
            },
          },
        },
      },
      video: {
        id: 'video',
        initial: 'idle',
        states: {
          idle: {
            on: {
              'VIDEO.START': 'waitingForMedia',
            },
          },
          waitingForMedia: {
            entry: send('MEDIA.USER.ACQUIRE.VIDEO', {to: 'UserMedia'}),
            on: {
              'MEDIA.USER.ACQUIRED.VIDEO': 'sending',
              'MEDIA.USER.ACQUIRE.ERROR': 'idle',
              'VIDEO.STOP': 'idle',
            },
          },
          sending: {
            exit: send('MEDIA.USER.RELEASE.VIDEO', {to: 'UserMedia'}),
            on: {
              'VIDEO.STOP': 'idle',
            },
          },
        },
      },
      cast: {
        id: 'cast',
        initial: 'idle',
        states: {
          idle: {
            on: {
              'CAST.START': [
                {
                  target: 'showingTips',
                  cond: 'castingTipsNotSeen',
                },
                {
                  target: 'waitingForMedia',
                },
              ],
            },
          },
          showingTips: {
            on: {
              'DISMISS.CASTING_TIPS': {
                target: 'waitingForMedia',
                actions: assign({castingTipsSeen: true}),
              },
              'CAST.STOP': 'idle',
            },
          },
          waitingForMedia: {
            entry: send('MEDIA.CAST.ACQUIRE', {to: 'CastMedia'}),
            on: {
              'MEDIA.CAST.ADD_STREAM': 'sending',
              'MEDIA.CAST.ACQUIRE.ERROR': 'idle',
              'CAST.STOP': 'idle',
            },
          },
          sending: {
            exit: send('MEDIA.CAST.RELEASE', {to: 'CastMedia'}),
            on: {
              'MEDIA.CAST.REMOVE_STREAM': 'idle',
              'CAST.STOP': 'idle',
              'RTC.RECEIVE.CAST': 'idle',
            },
          },
        },
      },
      ws: {
        id: 'ws',
        initial: 'idle',
        on: {
          'WS.START': '.running',
          'WS.STOP': '.idle',
        },
        states: {
          idle: {},
          running: {
            initial: 'connecting',
            invoke: {
              id: 'WSService',
              src: 'wsService',
            },
            on: {
              'WS.DISCONNECTED': 'reconnecting',
            },
            states: {
              connecting: {
                on: {
                  'WS.CONNECTED': 'connected',
                },
              },
              connected: {},
            },
          },
          reconnecting: {
            after: {
              RECONNECT_DELAY: 'running',
            },
          },
        },
      },
      rtc: {
        id: 'rtc',
        initial: 'idle',
        on: {
          'RTC.START': '.running',
          'RTC.STOP': '.idle',
        },
        states: {
          idle: {
            entry: assign({
              peers: I.Map(),
            }),
          },
          running: {
            invoke: {
              id: 'RTCService',
              src: 'rtcService',
            },
            on: {
              'MEDIA.USER.ADD_STREAM': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.USER.ADD_TRACK': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.USER.REMOVE_TRACK': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.USER.MUTED.AUDIO': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.USER.UNMUTED.AUDIO': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.CAST.ADD_STREAM': {
                actions: forwardTo('RTCService'),
              },
              'MEDIA.CAST.REMOVE_STREAM': {
                actions: forwardTo('RTCService'),
              },
              'RTC.SIGNAL': {
                actions: forwardTo('WSService'),
              },
              'RTC.PEER_STATE': {
                actions: assign((context, event) => ({ peers: event.peers })),
              },
            },
          },
        },
      },
      ui: {
        type: 'parallel',
        on: {
          'SET.TRANSMIT_MODE': {
            actions: assign((context, event) => ({
              transmitMode: event.value,
            }))
          },
          'VOICE.STOP': {
            actions: assign((context, event) => ({
              transmitMode: 'ptt',
            }))
          },
        },
        states: {
          inputSelector: {
            initial: 'hidden',
            states: {
              hidden: {
                on: {
                  'TOGGLE.INPUT_SELECTOR': 'showing',
                }
              },
              showing: {
                on: {
                  'TOGGLE.INPUT_SELECTOR': 'hidden',
                }
              },
            },
          }
        },
      },
    },
  },
  {
    actions: {
      log: (context, event) => {
        let method = 'log'
        if (event.type.endsWith('ERROR')) {
          method = 'error'
        }
        console[method]('%c%s %c%o', 'font-weight: bold', event.type, 'font-weight: normal', event)
      },
      updateLocation: (context) => {
        window.location.hash = context.roomID || ''
      },
    },
    guards: {
      isNavigating: (context, event) => context.roomID !== event.roomID,
      contextHasRoomID: (context) => !!context.roomID,
      isTransmitPTT: (context, event) => {
        return event.value === 'ptt'
      },
      isTransmitContinuous: (context, event) => {
        return event.value === 'continuous'
      },
      castingTipsNotSeen: (context) => {
        return !context.castingTipsSeen
      },
    },
    services: {
      wsService: (context, event) => wsService,
      rtcService: (context, event) => rtcService,
      userMedia: (context, event) => userMediaService,
      castMedia: (context, event) => castMediaService,
    },
    delays: {
      RECONNECT_DELAY: 2000,
      RELEASE_DELAY: 200,
    },
  },
)

export default stateMachine
