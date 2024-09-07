import { useRef, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Replayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';

import {
  Box,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Center,
} from '@chakra-ui/react';
import { getEvents, getSession, getAudioChunks } from '~/utils/storage';

function dataURLToBlob(dataURL: string) {
    // Split the Data URL into two parts: the MIME type and the base64 data
    const [header, base64Data] = dataURL.split(',');
    // Determine the MIME type from the header
    const mimeString = header.split(':')[1].split(';')[0];
    // Decode the base64 data
    const byteString = atob(base64Data);
    // Create an array of byte values
    const byteNumbers = new Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      byteNumbers[i] = byteString.charCodeAt(i);
    }
    // Convert the byte values to an Uint8Array
    const uint8Array = new Uint8Array(byteNumbers);
    // Create and return the Blob
    return new Blob([uint8Array], { type: mimeString });
}

export default function Player() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Replayer | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  
  const { sessionId } = useParams();
  const [sessionName, setSessionName] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then((session) => {
        setSessionName(session.name);
      })
      .catch((err) => {
        console.error(err);
      });
    getAudioChunks(sessionId).then(audioChunks => {
        const blob = new Blob(audioChunks.map(str => dataURLToBlob(str as any)), { type: 'audio/wav' });
        const audio = new Audio(URL.createObjectURL(blob));
        // Hide the audio element
        audio.style.display = 'none';        
        // Add the audio element to the DOM
        audioPlayerRef.current = audio;
        document.body.appendChild(audioPlayerRef.current);
    })
    getEvents(sessionId)
      .then((events) => {
        if (!playerElRef.current) return;

        const linkEl = document.createElement('link');
        linkEl.href =
          'https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css';
        linkEl.rel = 'stylesheet';
        document.head.appendChild(linkEl);
        playerRef.current = new Replayer({
          target: playerElRef.current as HTMLElement,
          props: {
            events,
            autoPlay: false,
          },
        });

        let seekAudio = false;
        // console.log(playerRef.current.getReplayer());
        playerRef.current.addEventListener('ui-update-player-state', (e: any) => {
            // console.debug('ui-update-player-state:', e);
            seekAudio = true;
            if (audioPlayerRef.current) {
                if (e.payload === 'paused') {
                    audioPlayerRef.current.pause();
                }
                else {
                    audioPlayerRef.current.play();
                }
            }
        })
        playerRef.current.addEventListener('ui-update-current-time', (e: any) => {
            if (seekAudio && audioPlayerRef.current) {
                console.debug('seeking audio to:', e.payload);
                audioPlayerRef.current.currentTime = e.payload/1000;
                seekAudio = false;
            }
        })
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      playerRef.current?.pause();
      audioPlayerRef.current?.pause();
    };
  }, [sessionId]);

  return (
    <>
      <Breadcrumb mb={5} fontSize="md">
        <BreadcrumbItem>
          <BreadcrumbLink href="#">Sessions</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <BreadcrumbLink>{sessionName}</BreadcrumbLink>
        </BreadcrumbItem>
      </Breadcrumb>
      <Center>
        <Box id={sessionName} ref={playerElRef}></Box>
      </Center>
    </>
  );
}
