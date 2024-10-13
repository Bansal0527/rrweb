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
import { getEvents, getSession, getMediaChunks } from '~/utils/storage';

async function dataURLToBlob(dataURL: string) {
    return await (await fetch(dataURL)).blob(); 

    // // Split the Data URL into two parts: the MIME type and the base64 data
    // const [header, base64Data] = dataURL.split(',');
    // // Determine the MIME type from the header
    // const mimeString = header.split(':')[1].split(';')[0];
    // // Decode the base64 data
    // const byteString = atob(base64Data);
    // // Create an array of byte values
    // const byteNumbers = new Array(byteString.length);
    // for (let i = 0; i < byteString.length; i++) {
    //   byteNumbers[i] = byteString.charCodeAt(i);
    // }
    // // Convert the byte values to an Uint8Array
    // const uint8Array = new Uint8Array(byteNumbers);
    // // Create and return the Blob
    // return Promise.resolve(new Blob([uint8Array], { type: mimeString }));
}

export default function Player() {
  const playerElRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Replayer | null>(null);
//   const mediaPlayerElRef = useRef<HTMLDivElement>(null);
  const mediaPlayerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  
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
    getMediaChunks(sessionId).then(async mediaChunks => {
        // if (!mediaPlayerElRef.current) return;

        const promises = mediaChunks.map(async str => await dataURLToBlob(str as any));
        const blobs = await Promise.all(promises);
        const mimeString = blobs.length > 0 ? blobs[0].type : 'video/webm;codecs=vp8,opus';
        const blob = new Blob(blobs, { type: mimeString });
        const mediaUrl = URL.createObjectURL(blob);

        // const media = new Audio(mediaUrl);
        const media: HTMLVideoElement = document.createElement('video');
        media.src = mediaUrl;
        media.controls = true;
        // media.crossOrigin = 'anonymous';  
        // media.autoplay = true;
        media.load();
        // media.srcObject = blob;
        // Hide the audio element
        // media.style.display = 'none';
        // Add the audio element to the DOM
        mediaPlayerRef.current = media;
        document.body.appendChild(media);
        // document.body.appendChild(mediaPlayerRef.current);
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
            if (mediaPlayerRef.current) {
                if (e.payload === 'paused') {
                    mediaPlayerRef.current.pause();
                }
                else {
                    // console.log(mediaPlayerRef.current);
                    // mediaPlayerRef.current.play();
                }
            }
        })
        // playerRef.current.addEventListener('ui-update-progress', (e: any) => {
        //     console.debug('ui-update-progress:', e.payload); // fractional progress
        // })
        playerRef.current.addEventListener('ui-update-current-time', (e: any) => {
            // console.debug('ui-update-current-time:', e);
            if (seekAudio && mediaPlayerRef.current) {
                console.debug('seeking audio to:', e.payload);
                mediaPlayerRef.current.currentTime = e.payload/1000;
                seekAudio = false;
            }
        })
      })
      .catch((err) => {
        console.error(err);
      });
    return () => {
      playerRef.current?.pause();
      mediaPlayerRef.current?.pause();
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
        <Box ref={playerElRef}></Box>
        {/* <br/>
        <video width="750" height="500" controls >
            <source src={mediaPlayerRef.current?.src} type="video/webm;codecs=vp8,opus"/>
        </video> */}
      </Center>
    </>
  );
}
