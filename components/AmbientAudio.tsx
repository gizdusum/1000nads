'use client'

import { useEffect, useRef, useState } from 'react'

export function AmbientAudio() {
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const audio = new Audio('/music.mp3')
    audio.loop = true
    audio.volume = 0.22
    audio.preload = 'auto'
    audioRef.current = audio

    const tryPlay = async () => {
      if (startedRef.current) return
      try {
        await audio.play()
        startedRef.current = true
        setPlaying(true)
      } catch {
        // Autoplay blocked — will start on first interaction
      }
    }

    tryPlay()

    const onInteract = () => {
      tryPlay()
    }
    document.addEventListener('click', onInteract, { once: true })
    document.addEventListener('keydown', onInteract, { once: true })

    return () => {
      audio.pause()
      audio.src = ''
      document.removeEventListener('click', onInteract)
      document.removeEventListener('keydown', onInteract)
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => {})
    }
  }

  return (
    <button
      className="audio-toggle"
      onClick={toggle}
      title={playing ? 'Mute soundtrack' : 'Play soundtrack'}
    >
      <span className="audio-icon">{playing ? '♫' : '♪'}</span>
      <span className="audio-lbl">{playing ? 'Music on' : 'Music off'}</span>
    </button>
  )
}
