import range from 'lodash/range'
import isMobile from 'is-mobile'
import { Machine } from 'xstate'
import { useMachine, useService } from '@xstate/react'
import { h, Fragment, render } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import Color from 'color'
import styled, { css, createGlobalStyle } from 'styled-components'
import { interpret } from 'xstate'
import * as I from 'immutable'
import stateMachine from './stateMachine.js'

import './index.css'

import CameraIcon from '../static/camera.svg'
import CastIcon from '../static/cast.svg'
import DisconnectedIcon from '../static/disconnected.svg'
import LineInIcon from '../static/linein.svg'
import LinkIcon from '../static/link.svg'
import LogoIcon from '../static/logo.svg'
import MicIcon from '../static/mic.svg'
import MenuArrowIcon from '../static/menu-arrow.svg'
import PersonIcon from '../static/person.svg'
import SendingIcon from '../static/sending.svg'
import StrikeIcon from '../static/strike.svg'
import ShareAudioImage from '../static/share-audio.svg'

const outerBGColor = Color('#1c1c24')
const grayBGColor = Color('#2c2c34')
const mainColor = Color('#da0067')
const highlightColor = grayBGColor.mix(mainColor, .75).desaturate(.15)
const faintMainColor = Color('#8f6575')
const secondMainColor = Color('#de406d')
const lightGrayColor = Color('#dadada')
const medGrayColor = Color('#939393')
const darkGrayColor = grayBGColor.lighten(.15)
const darkerGrayColor = darkGrayColor.darken(.25)
const popupBorderColor = secondMainColor.mix(grayBGColor, .5)
const fastDuration = '.065s'
const mediumDuration = '.20s'
const slowDuration = '.35s'
const footerHeight = 40
const mobileSelector = '@media screen and (min-width: 320px) and (max-width: 767px)'
const mobileLandscapeSelector = '@media screen and (min-width: 320px) and (max-width: 767px) and (orientation: landscape)'
const easeInOutQuint = 'cubic-bezier(0.83, 0, 0.17, 1)'  // via https://easings.net/#easeInOutQuint

const GlobalStyle = createGlobalStyle`
  body {
    margin: 0;
    display: flex;
    justify-content: center;
    background: ${outerBGColor};
    font-family: Noto Sans;
    color: ${lightGrayColor};
  }
`

const FullScreenAppStyle = createGlobalStyle`
  html, body {
    position: fixed;
    width: 100%;
    height: 100%;
  }
`

function Stream({ stream, audioOnly, mirror, ...props }) {
  const ref = useRef()

  useEffect(() => {
    if (stream) {
      ref.current.srcObject = stream
    }
  }, [stream, audioOnly])

  const style = {...props.style}
  if (audioOnly) {
    style.display = 'none'
  }
  if (mirror) {
    style.transform = 'scaleX(-1)'
  }

  return <video ref={ref} {...props} style={style} autoPlay playsInline />
}

const Container = styled.div`
  position: relative;
  align-self: center;
  justify-content: flex-end;
  display: flex;
  flex-direction: column;
  background: ${grayBGColor};
  width: 480px;
  height: 640px;
  overflow: hidden;
  user-select: none;
  box-shadow: 0 0 10px ${Color('black').alpha(.15)};

  @media (min-width: 480px) and (min-height: 640px) {
    border-radius: 8px;
  }

  @media screen and (max-width: 480px) {
    height: 100%;
  }

  ${mobileLandscapeSelector} {
    padding-top: 0;
    width: 100%;
    height: 100%;
  }

  button, a {
    -webkit-tap-highlight-color: transparent;
  }
`

const MainContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;

  ${mobileLandscapeSelector} {
    flex-direction: row;
  }
`

const StartScreen = styled(Container)`
  box-sizing: border-box;
  padding: 30px 60px;
`

const StartHeading = styled.h1`
  font-size: 24px;
  font-weight: normal;
  color: ${lightGrayColor};
  text-align: center;
  line-height: 1.5em;
  background: ${faintMainColor.alpha(.15)};
  margin: 0 -60px;
  margin-bottom: 15px;
  padding: 20px 60px;
`

const StartText = styled.h2`
  font-size: 20px;
  font-weight: normal;
  color: ${medGrayColor};
  text-align: center;
  line-height: 2em;

  a {
    padding: 5px 10px;
    color: ${secondMainColor};
    text-decoration: none;
    border: 1px solid currentColor;
    border-radius: 4px;
    font-size: .8em;
    font-weight: bold;

    &:hover {
      opacity: 1;
    }
  }

  ${mobileLandscapeSelector} {
    margin: 0;
  }
`

const BigButton = styled.button`
  background: ${faintMainColor.alpha(.45)};
  border: none;
  border-radius: 999px;
  color: ${lightGrayColor};
  font-size: 22px;
  font-weight: bold;
  padding: 16px 24px;
  transition: background ${fastDuration} ease-out;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${highlightColor};
  }

  &:hover {
    background: ${faintMainColor.alpha(.65)};
  }

  &:active {
    background: ${faintMainColor.alpha(.55)};
  }
`

const SmallerBigButton = styled(BigButton)`
  font-size: 1.1em;
  margin: 15px;
  padding: 12px 75px;
`

const NameText = styled.div`
  color: ${mainColor};
  font-weight: bold;
  margin-top: .25em;

  svg {
    width: auto;
    height: 1.5em;
    vertical-align: -.30em;
  }
`

const Spacer = styled.div`
  flex: 1;
`

const Controls = styled.div`
  display: flex;
  flex-direction:row;
  align-items: center;
  justify-content: space-evenly;
  margin-bottom: 20px;

  ${mobileLandscapeSelector} {
    flex-direction: column;
    margin: 0 20px;
  }
`

function BigTalkButton({onPress, onRelease, children, ...props}) {
  const handleMouseDown = useCallback((ev) => {
    if (ev.button !== 0) {
      return
    }
    onPress(ev)
  }, [onPress])

  const handleMouseUp = useCallback((ev) => {
    if (ev.button !== 0) {
      return
    }
    onRelease(ev)
  }, [onRelease])

  const handleTouchStart = useCallback((ev) => {
    ev.preventDefault()
    onPress(ev)
  }, [onPress])

  const handleTouchEnd = useCallback((ev) => {
    onRelease(ev)
  }, [onRelease])
  
  return (
    <StyledBigTalkButton
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      {...props}
    >
      <StyledSendingIcon />
      {children}
    </StyledBigTalkButton>
  )
}

const StyledSendingIcon = styled(SendingIcon)`
  position: absolute;
  top: -57px;
  width: auto;
  height: 55px;

  path {
    stroke-width: 6px;
    vector-effect: non-scaling-stroke;
  }
`

const StyledBigTalkButton = styled.button.attrs(props => ({
  primaryColor: props.canSend ? secondMainColor : faintMainColor,
}))`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.primaryColor.alpha(.05)};
  border: 8px solid ${props => props.primaryColor.alpha(.45)};
  border-radius: 999px;
  color: ${props => props.primaryColor};
  width: 110px;
  height: 110px;
  box-shadow: ${props => props.sending ? `0 0 15px ${props => props.primaryColor.alpha(.5)}` : 'none'};
  transition: all ${fastDuration} ease-out;

  &:focus {
    outline: none;
    box-shadow: 0 0 10px ${highlightColor};
  }

  &:hover {
    background: ${props => props.primaryColor.alpha(.15)};
  }

  ${StyledSendingIcon} {
    opacity: 0;
    transition: all ${mediumDuration} ease-out;
  }

  svg:not(${StyledSendingIcon}) {
    width: 38px;
  }

  ${props => props.sending && css`
    background: ${props => props.primaryColor.alpha(.30)} !important;
    box-shadow: 0 0 15px ${props => props.primaryColor.alpha(.5)};

    ${StyledSendingIcon} {
      opacity: .25;
    }
  `}
`

const SquareButtonStrike = styled(StrikeIcon)`
  position: absolute;
  width: 85%;
  height: 85%;

  path {
    stroke-width: 4px;
    vector-effect: non-scaling-stroke;
  }
`

function SquareToggleButton({on=false, children, ...props}) {
  return (
    <StyledSquareToggleButton on={on} {...props}>
      {!on ? <SquareButtonStrike /> : null}
      {children}
    </StyledSquareToggleButton>
  )
}

const StyledSquareToggleButton = styled.button.attrs(props => ({
  primaryColor: props.on ? secondMainColor : faintMainColor,
  secondaryColor: props.on ? grayBGColor.mix(secondMainColor, .45) : grayBGColor.mix(faintMainColor, .45),
}))`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.secondaryColor.alpha(.05)};
  border: 4px solid currentColor;
  border-radius: 12px;
  color: ${props => props.secondaryColor};
  width: 70px;
  height: 70px;
  transition: all ${fastDuration} ease-out;
  filter: ${props => props.disabled ? 'grayscale(1)' : 'none'};
  opacity: ${props => props.disabled ? .5 : 1};

  &:focus {
    outline: none;
    box-shadow: 0 0 10px ${highlightColor};
  }

  &:hover {
    background: ${props => props.secondaryColor.alpha(.25)};
  }

  &:enabled:active {
    background: ${props => props.secondaryColor.alpha(.40)};
    box-shadow: 0 0 10px ${props => props.secondaryColor.alpha(.5)};
  }

  svg:not(${SquareButtonStrike}) {
    color: ${props => props.primaryColor};
    width: 38px;
  }
`

const shareTipMachine = Machine({
  initial: 'init',
  states: {
    init: {
      on: {
        'CLICK': {
          actions: 'copy',
          target: 'clicked',
        }
      },
    },
    clicked: {
      after: {
        RESET_DELAY: 'init',
      },
    },
  },
})

function ShareTip({children}) {
  const [state, send] = useMachine(shareTipMachine, {
    actions: {
      copy: () => {
        navigator.clipboard.writeText(location)
      }
    },
    delays: {RESET_DELAY: 2000}
  })
  const handleClick = useCallback(() => send('CLICK'), [])
  return (
    <StyledShareTip
      onClick={handleClick}
    >
      {state.matches('clicked') ? <>url copied to clipboard</> : <><LinkIcon />share url to invite friends</>}
    </StyledShareTip>
  )
}

const StyledShareTip = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: ${darkGrayColor};
  color: ${lightGrayColor};
  border-radius: 5px;
  font-size: 1em;
  font-weight: bold;
  height: 35px;
  padding: 5px;
  margin: 10px;

  svg {
    width: 1.5em;
    height: 1.5em;
    margin: .5em;
  }
`

function Tumbleweed({children}) {
  return (
    <TumbleweedContainer>
      {children}
      <TumbleweedText>you're the first one here.</TumbleweedText>
    </TumbleweedContainer>
  )
}

const TumbleweedContainer = styled.div`
  flex: 1;
  flex-direction: column;
  display: flex;
  align-items: center;
  justify-content: center;
`

const TumbleweedText = styled.p`
  font-size: 1.25em;
  color: ${medGrayColor};
`

function UserStream({stream, audioOnly, audioActive, muted, state}) {
  return (
    <UserStreamBox audioActive={audioActive} state={state}>
      {state === 'error' ? <StyledErrorIcon />: <StyledPersonIcon />}
      {stream && <Stream stream={stream} audioOnly={audioOnly} muted={muted} mirror />}
    </UserStreamBox>
  )
}

const StyledPersonIcon = styled(PersonIcon)`
  path {
    stroke: ${darkerGrayColor};
    fill: ${darkGrayColor};
  }
`

const StyledErrorIcon = styled(DisconnectedIcon)`
  color: ${secondMainColor.darken(.15).alpha(.75)};
`

const UserStreamBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${medGrayColor};
  width: 120px;
  height: 80px;
  border: 2px solid ${props => props.audioActive ? secondMainColor : medGrayColor};
  border-radius: 3px;
  overflow: hidden;
  opacity: ${props => props.state === 'connecting' || props.state === 'error' ? .5 : 1};
  transform: ${props => props.state === 'connecting' || props.state === 'error' ? 'scale(.92)' : 'none'};
  transition: all ${easeInOutQuint} ${slowDuration};

  video {
    position: absolute;
    height: 100%;
    width: 100%;
    object-fit: cover;
  }

  ${StyledPersonIcon}, ${StyledErrorIcon} {
    position: absolute;
    height: 70%;
  }
`

const UserStreams = styled.div`
  display: flex;
  align-content: center;
  justify-content: center;
  margin-top: 5px;
  margin-bottom: 10px;

  & > * {
    margin: ${props => props.count <= 3 ? 6 : 3}px;
  }

  @media (max-width: 480px) {
    flex-wrap: wrap;
  }
`

function CastStream({stream, canCast, onStartCast, muted}) {
  return (
    <CastStreamBox hasStream={!!stream}>
      {!stream && (
        <>
          <StyledCastIcon />
          {canCast && <CastPlaceholderButton onClick={onStartCast}>start casting</CastPlaceholderButton>}
        </>
      )}
      {stream && <Stream stream={stream} muted={muted} />}
    </CastStreamBox>
  )
}

const CastPlaceholderButton = styled.button`
  background: ${darkGrayColor};
  color: ${lightGrayColor};
  border-radius: 999px;
  text-align: center;
  font-weight: bold;
  padding: 5px 15px;
  border: none;
  cursor: pointer;
`

const StyledCastIcon = styled(CastIcon)`
  width: 100%;
  height: 100%;
  padding: 35px;
  box-sizing: border-box;
  opacity: .15;

  path {
    stroke-width: 14px;
    vector-effect: non-scaling-stroke;
  }
`

const CastStreamBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.hasStream ? darkerGrayColor : medGrayColor};
  width: auto;
  height: 0;
  padding-top: ${(300 / 4).toFixed(2)}%;
  overflow: hidden;

  video {
    position: absolute;
    top: 0;
    width: 100%;
    height: 100%;
  }

  ${StyledCastIcon} {
    position: absolute;
    top: 0;
  }

  ${CastPlaceholderButton} {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
  }
`

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${darkerGrayColor};
  height: ${footerHeight}px;
  padding: 0 15px;
  opacity: .75;
  z-index: ${props => props.onTop ? 10 : 0};
`

const StyledMenuArrowIcon = styled(MenuArrowIcon)`
  height: 7px;
  width: auto;
  margin-left: .5em;
  transform: ${props => props.flipped ? 'scaleY(-1)' : 'none'};
`

const StyledLineInIcon = styled(LineInIcon)`
  height: 1.25em;
  width: auto;
  margin-right: .5em;
`

const InputSelectorButton = styled.button`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: ${secondMainColor};
  font-weight: bold;
  cursor: pointer;
  text-transform: lowercase;
  white-space: nowrap;
  padding: 4px 0;
  border: none;
  background: none;
  border-radius: 999px;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${highlightColor};
  }

  &:hover {
    background: ${secondMainColor.alpha(.15)};
  }

  &:active {
    background: ${secondMainColor.alpha(.25)};
  }
`

const FooterRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex: 1;
`

const FooterLogo = styled.a`
  display: flex;
  padding: 2px;
  border-radius: 4px;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${highlightColor};
  }

  svg {
    height: 26px;
    width: auto;

    path {
      stroke-width: 2.35px;
      vector-effect: non-scaling-stroke;
    }
  }
`

const InputSelectorHeading = styled.h3`
  color: ${secondMainColor};
  font-weight: bold;
  font-size: 1em;
  text-align: center;
  margin-top: 30px;
  margin-bottom: 10px;

  &:first-child {
    margin-top: 0;
  }
`

const InputSelectorPane = styled.div`
  position: absolute;
  display: flex;
  flex-direction: column;
  bottom: ${footerHeight}px;
  align-self: center;
  background: ${grayBGColor};
  border: 4px solid ${popupBorderColor};
  border-radius: 8px;
  padding: 20px 40px;
`

const StyledRadioTick = styled.div``

const StyledLabel = styled.label`
  display: flex;
  align-items: center;
  color: ${secondMainColor};
  font-size: 1em;
  padding: 8px 0;
  text-transform: lowercase;

  & > input {
    opacity: 0;
    position: absolute;
  }

  & > span {
    display: flex;
    align-items: center;
  }

  ${StyledRadioTick} {
    content: '';
    display: block;
    width: 12px;
    height: 12px;
    border: 1.5px solid ${secondMainColor};
    border-radius: 999px;
    margin-right: 10px;
    background: ${props => props.checked ? secondMainColor : 'none'};
  }
`

function Radio({children, checked, ...props}) {
  return <StyledLabel checked={checked}><input type="radio" {...props} checked={checked} /><StyledRadioTick /><span>{children}</span></StyledLabel>
}

const ChannelRow = styled.div`
  display: flex;
  align-items: center;
  margin: 5px 0;

  &:first-child {
    margin-top: 0;
  }
`

const ChannelLabel = styled.div`
  color: ${secondMainColor};
  font-size: 1em;
  width: 60px;
`

const channelRadioSize = 28

const StyledChannelRadioTick = styled.div``

const StyledChannelLabel = styled.label`
  position: relative;
  display: flex;
  justify-content: center;
  color: ${props => props.checked ? grayBGColor : secondMainColor};
  font-size: 1em;
  font-weight: bold;
  margin-right: 10px;
  width: ${channelRadioSize}px;
  line-height: ${channelRadioSize}px;
  text-align: center;

  & > input {
    opacity: 0;
    position: absolute;
  }

  & > span {
    // The span must be positioned to appear over the tick.
    position: relative;
    display: flex;
    justify-content: center;
  }

  ${StyledChannelRadioTick} {
    position: absolute;
    content: '';
    display: block;
    width: ${channelRadioSize}px;
    height: ${channelRadioSize}px;
    box-sizing: border-box;
    border: 1.5px solid ${secondMainColor};
    border-radius: 2px;
    background: ${props => props.checked ? secondMainColor : 'none'};
  }
`

function ChannelRadio({children, checked, ...props}) {
  return <StyledChannelLabel checked={checked}><input type="radio" {...props} checked={checked} /><StyledChannelRadioTick /><span>{children}</span></StyledChannelLabel>
}

const CastingTipsPane = styled.div`
  position: absolute;
  top: 75px;
  width: 90%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-self: center;
  background: ${grayBGColor};
  border: 4px solid ${popupBorderColor};
  border-radius: 8px;
  padding: 10px 30px;
  margin: 10px;
  line-height: 1.5em;

  svg {
    width: 100%;
    height: auto;
  }
`

const Shade = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: ${darkerGrayColor.alpha(.75)};
`

const SplashContainer = styled.main`
  display: flex;
  flex-direction: column;
  width: 100%;
  background: radial-gradient(circle at center 400px, ${mainColor.alpha(.1)}, transparent 900px)
`

const SplashHero = styled.section`
  align-self: center;
  flex-shrink: 0;
  margin: 0 20px;
  margin-top: 50px;

  ${mobileSelector} {
    margin-top: 10px;
  }
`

const SplashLogo = styled.h1`
  display: flex;
  align-items: center;
  color: ${mainColor};
  font-size: 1.5em;
  margin-top: 30px;

  svg {
    width: auto;
    height: 42px;
    margin-right: 10px;
  }
`

const SplashHeading = styled.h2`
  margin-top: 35px;
  margin-bottom: 50px;
  font-size: 1.25em;
  font-weight: normal;
  line-height: 1.5em;
`

const SplashBox = styled.div`
  display: flex;
  flex-direction: column;
  background: ${grayBGColor};
  border-radius: 10px;
  font-size: 1.1em;
  padding: 10px 20px;
  margin: 50px -25px;
  margin-bottom: 90px;

  ${mobileSelector} {
    margin-bottom: 45px;
  }

  ul {
    margin: 0;
  }

  li {
    margin: 15px 0;
    line-height: 1.5em;
  }

  em {
    display: block;
    font-style: normal;
    color: ${medGrayColor};
  }

  ${SmallerBigButton} {
    align-self: center;
  }
`

const SplashContent = styled.section`
  background: ${grayBGColor};
  padding: 30px;
  font-size: 1.1em;
  line-height: 1.5em;
`

const ContentHeading = styled.h4`
  color: ${medGrayColor};
  margin-top: 2em;
  margin-bottom: 0;
`

const SplashTextContainer = styled.div`
  max-width: 700px;
  margin: 0 auto;

  ${ContentHeading} + p {
    margin-top: .25em;
  }

  svg {
    width: 1.60em;
    height: 1.75em;
    vertical-align: middle;
    margin-left: .25em;
    margin-right: .15em;
    color: ${medGrayColor};
  }

  a {
    color: ${medGrayColor};
  }
`

const ContentLead = styled.h3`
  background: ${faintMainColor.alpha(.15)};
  margin: -30px;
  margn-top: 2em;
  margin-bottom: 0;
  padding: 30px;
  font-size: 1.1em;
  font-weight: normal;
  line-height: 1.75em;
  text-align: center;
`

const HoverNote = styled.span`
  border-bottom: 2px dotted ${lightGrayColor.alpha(.25)};
`

function SplashPage({onStart}) {
  return (
    <SplashContainer>
      <SplashHero>
        <SplashLogo><LogoIcon /> tinyca.st</SplashLogo>
        <SplashHeading>little group calls with exceptional audio quality.</SplashHeading>
        <SplashBox>
          <ul>
            <li>free, no account required</li>
            <li>
              cast audio or video with friends
              <em>(great for tiny dj sets, karaoke, and more)</em>
            </li>
            <li>crisp 160kbps audio</li>
          </ul>
          <SmallerBigButton onClick={onStart}>start a tinycast</SmallerBigButton>
        </SplashBox>
      </SplashHero>
      <SplashContent>
        <ContentLead>
          <SplashTextContainer>
            in this time of isolation, tinycast was made to make it easier to<br />share online experiences with the folks you wish you were closer to.
          </SplashTextContainer>
        </ContentLead>
        <SplashTextContainer>
          <ContentHeading>how does it work?</ContentHeading>
          <p>
            tinycast uses WebRTC peer-to-peer functionality built into your browser to directly connect your devices together. we tune the settings to crank audio quality up to 11.
          </p>
          <ContentHeading>who can join my tinycast?</ContentHeading>
          <p>each tinycast has a unique, <HoverNote title="there's over 16 quintillion possibilities!">unguessable</HoverNote> url. anyone you share the url with can join.</p>
          <p>for best results, keep the number of participants small. calls are limited by the peer with the least internet bandwidth.</p>
          <ContentHeading>how do I cast a tab?</ContentHeading>
          <p>click the <CastIcon /> cast button. only one person can cast at a time.</p>
          <p>currently, Chrome is the only browser which supports casting audio (you'll see an option to "share audio" when selecting a Chrome tab to share).</p>
          <ContentHeading>how can I use this for karaoke?</ContentHeading>
          <p>take turns casting a video and singing along. have fun! :)</p>
          <ContentHeading>more information</ContentHeading>
          <p>
            built with: <a href="https://github.com/feross/simple-peer">simple-peer</a>, <a href="https://github.com/clux/sdp-transform">sdp-transform</a>, <a href="https://github.com/davidkpiano/xstate">xstate</a>, and <a href="https://github.com/preactjs/preact">preact</a>.<br />
            source code is available at <a href="https://github.com/tinycast/tinycast">github.com/tinycast</a><br />
            contact: <a href="mailto:hi@tinyca.st" target="_blank">hi@tinyca.st</a>
          </p>
        </SplashTextContainer>
      </SplashContent>
    </SplashContainer>
  )
}

const StyledConnectionError = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: ${secondMainColor};
  line-height: 1.5em;

  svg {
    width: 200px;
    height: 200px;
    margin-bottom: 20px;
  }
`

const ErrorHeading = styled.h3`
  font-size: 1em;
  margin: 0;
`

function ConnectionError({children}) {
  return (
    <StyledConnectionError>
      <DisconnectedIcon />
      {children}
    </StyledConnectionError>
  )
}

function App({service}) {
  const [state, send] = useService(service)

  const {peers, userStream: myUserStream, castStream: myCastStream, audioDevices, audioDeviceSettings, transmitMode} = state.context

  const handleStart = useCallback((ev) => send('START'), [])
  const handleStartSpeak = useCallback((ev) => send('VOICE.START'), [])
  const handleStopSpeak = useCallback((ev) => send('VOICE.STOP'), [])
  const handleStartVideo = useCallback((ev) => send('VIDEO.START'), [])
  const handleStopVideo = useCallback((ev) => send('VIDEO.STOP'), [])
  const handleStartCast = useCallback((ev) => send('CAST.START'), [])
  const handleStopCast = useCallback((ev) => send('CAST.STOP'), [])
  const handleToggleInputSelector = useCallback((ev) => send('TOGGLE.INPUT_SELECTOR'), [])
  const handleSetAudioSource = useCallback((ev) => send({type: 'SET_AUDIO_SOURCE', deviceId: ev.target.value }), [])
  const handleSetLeftChannel = useCallback((ev) => send({type: 'SET_CHANNEL_MAP', left: Number(ev.target.value) }), [])
  const handleSetRightChannel = useCallback((ev) => send({type: 'SET_CHANNEL_MAP', right: Number(ev.target.value) }), [])
  const handleChangeTransmitMode = useCallback((ev) => send({type: 'SET.TRANSMIT_MODE', value: ev.target.value}), [])
  const handleDismissCastingTips = useCallback((ev) => send('DISMISS.CASTING_TIPS'), [])

  if (state.matches({ room: 'nowhere' })) {
    if (state.context.roomID) {
      return (
        <StartScreen>
          <FullScreenAppStyle />
          <StartHeading>
            <span>you've been invited to a</span>
            <NameText><LogoIcon /> tinyca.st</NameText>
          </StartHeading>
          <StartText>
            <p>little group calls with <br /> exceptional audio quality</p>
            <a href="/" target="_blank">what is tinyca.st?</a>
          </StartText>
          <Spacer />
          <BigButton onClick={handleStart}>enter call</BigButton>
        </StartScreen>
      )
    } else {
      return <SplashPage onStart={handleStart} />
    }
  }

  const streams = state.context.peers
    .flatMap((p) =>
      p.streams
        .filter((s) => (s.kind === 'user' || s.kind === 'cast') && s.stream)
        .map((s) => s.stream),
    )
    .toList()
    .groupBy((s) => (s.getVideoTracks().length > 0 ? 'video' : 'audio'))

  const canCast = !isMobile() && navigator.mediaDevices.getDisplayMedia
  const isJoined = state.matches({room: 'joined'})
  const myUserStreamUI = <UserStream stream={myUserStream} audioOnly={!state.matches({video: 'sending'})} audioActive={state.matches('voice.hasMedia.sending')} muted />
  const userStreams = Array.from(state.context.peers.values(), (p) => ({
    state: p.state,
    streamInfo: p.streams.find(s => s.kind === 'user', null, {}),
  }))
  const castStream = myCastStream || peers.flatMap(p => p.streams).find(s => s.kind === 'cast', null, {}).stream

  return (
    <Container>
      <FullScreenAppStyle />
      {isJoined && peers.size === 0 && <ShareTip />}
      {isJoined &&
        <MainContainer>
          {peers.size === 0 && <Tumbleweed>{myUserStreamUI}</Tumbleweed>}
          {peers.size > 0 && (
            <>
              <CastStream stream={castStream} canCast={canCast} onStartCast={handleStartCast} muted={castStream === myCastStream} />
              <UserStreams count={userStreams.length + 1}>
                {myUserStreamUI}
                {userStreams.map(({state, streamInfo: s}) => <UserStream stream={s.stream} audioOnly={s.audioOnly} audioActive={s.audioActive} state={state} />)}
              </UserStreams>
              <Spacer />
            </>
          )}
          {isJoined &&
            <Controls>
              <SquareToggleButton on={state.matches({cast: 'sending'})} onClick={state.matches({cast: 'sending'}) ? handleStopCast : handleStartCast} disabled={!canCast}><CastIcon /></SquareToggleButton>
              <BigTalkButton canSend={state.matches({voice: 'hasMedia'})} sending={state.matches('voice.hasMedia.sending')} onPress={handleStartSpeak} onRelease={handleStopSpeak}><MicIcon /></BigTalkButton>
              <SquareToggleButton on={state.matches({video: 'sending'})} onClick={state.matches({video: 'sending'}) ? handleStopVideo : handleStartVideo}><CameraIcon /></SquareToggleButton>
            </Controls>
          }
        </MainContainer>
      }
      {state.matches('room.connecting.retrying') &&
        <ConnectionError><ErrorHeading>error connecting to tinycast</ErrorHeading><p>we'll retry automatically until we get in.</p></ConnectionError>
      }
      <Footer onTop={state.matches('ui.inputSelector.showing')}>
        <Spacer />
        {audioDeviceSettings && (
          <InputSelectorButton onClick={handleToggleInputSelector}>
            <StyledLineInIcon /> {audioDeviceSettings.label} <StyledMenuArrowIcon flipped={state.matches('ui.inputSelector.showing')} />
          </InputSelectorButton>
        )}
        <FooterRight>
          <FooterLogo href="/" target="_blank"><LogoIcon /></FooterLogo>
        </FooterRight>
      </Footer>
      {state.matches('ui.inputSelector.showing') && (
        <>
          <Shade onClick={handleToggleInputSelector} />
          <InputSelectorPane>
            <InputSelectorHeading>available inputs</InputSelectorHeading>
            {audioDevices.map(d =>
              <Radio name="device" type="radio" checked={d.deviceId === audioDeviceSettings.deviceId} onChange={handleSetAudioSource} value={d.deviceId}> {d.label}</Radio>
            )}
            <InputSelectorHeading>input channels</InputSelectorHeading>
            <ChannelRow>
              <ChannelLabel>left</ChannelLabel>
              {range(audioDeviceSettings.channelCount).map(i => <ChannelRadio name="leftChannel" checked={i === audioDeviceSettings.left} onChange={handleSetLeftChannel} value={i}>{i + 1}</ChannelRadio>)}
            </ChannelRow>
            <ChannelRow>
              <ChannelLabel>right</ChannelLabel>
              {range(audioDeviceSettings.channelCount).map(i => <ChannelRadio name="rightChannel" checked={i === audioDeviceSettings.right} onChange={handleSetRightChannel} value={i}>{i + 1}</ChannelRadio>)}
            </ChannelRow>
            <InputSelectorHeading>transmit mode</InputSelectorHeading>
            <Radio name="transmitMode" checked={transmitMode === 'ptt'} onChange={handleChangeTransmitMode} value="ptt"> push-to-talk</Radio>
            <Radio name="transmitMode" checked={transmitMode === 'continuous'} onChange={handleChangeTransmitMode} value="continuous"> continuous</Radio>
          </InputSelectorPane>
        </>
      )}
      {state.matches({cast: 'showingTips'}) && (
        <>
          <Shade onClick={handleStopCast} />
          <CastingTipsPane>
            <p>at this time, Chrome is the only browser which supports casting audio.</p>
            <ShareAudioImage />
            <p>share a tab and check "share audio" below.</p>
            <SmallerBigButton onClick={handleDismissCastingTips}>got it, let's cast!</SmallerBigButton>
          </CastingTipsPane>
        </>
      )}
    </Container>
  )
}

function roomIDFromHash() {
  return location.hash ? location.hash.substr(1) : null
}

function main() {
  const service = interpret(
    stateMachine.withContext({
      ...stateMachine.context,
      roomID: roomIDFromHash(),
    }),
  )
  service.onTransition((state) => (window.debugState = state))
  service.start()

  window.debugEvent = service.send

  window.addEventListener('hashchange', () => {
    const roomID = roomIDFromHash()
    service.send({type: 'SET_ROOM_ID', roomID})
  })

  render(
    <>
      <GlobalStyle />
      <App service={service} />
    </>,
    document.body,
  )
}

main()
