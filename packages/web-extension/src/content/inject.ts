import { record } from 'rrweb';
import type { recordOptions } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { MessageName, type RecordStartedMessage } from '~/types';
import { isInCrossOriginIFrame } from '~/utils';

/**
 * This script is injected into both main page and cross-origin IFrames through <script> tags.
 */

const events: eventWithTime[] = [];
const mediaChunks: any[] = [];
let mediaRecorder: MediaRecorder | null = null;
let micStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;


let stopFn: (() => void) | null = null;

function blobToDataURL(blob: Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to convert Blob to Data URL'));
      reader.readAsDataURL(blob);
    });
  }

  // List all mimeTypes
  const mimeTypes = [
    "video/webm;codecs=avc1",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm;codecs=h264",
    "video/webm",
  ];

  // Check if the browser supports any of the mimeTypes, 
  // make sure to select the first one that is supported from the list
  let mimeType = mimeTypes.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType)
  );

  console.log('best supported mimetype:', mimeType);

  async function startMediaRecording(onStopCb: any) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        preferCurrentTab: true,
        video: {
          width: 1920,
          height: 1080,
          frameRate: 30,
          resizeMode: 'crop-and-scale'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      } as any);
    }
    catch (error) {
        console.error('Error accessing screen:', error);
    }

      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      }
      catch (error) {
        console.error('Error accessing microphone:', error);
      }
      const mediaStream = new MediaStream([
        ...(screenStream ? screenStream.getTracks() : []),
        ...(micStream ? micStream.getAudioTracks() : [])
      ]);
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
        mediaRecorder.ondataavailable = async (e) => {
            console.debug('received chunk of type:', e.data.type);
            const mediaChunk = await blobToDataURL(e.data)
            mediaChunks.push(mediaChunk);
            postMessage({
                message: MessageName.EmitMediaChunk,
                mediaChunk
            });
        }
        // XXX hack to force invoking 'RecordStarted' after mediaChunk has been added
        mediaRecorder.onstop = () => setTimeout(() => onStopCb(), 10);
        mediaRecorder.start();
  }

  function stopMediaRecording() {
    mediaRecorder?.stop();
    micStream?.getTracks().forEach(track => track.stop());
    screenStream?.getTracks().forEach(track => track.stop());
  }

async function startRecord(config: recordOptions<eventWithTime>) {
  events.length = 0;
  stopFn =
    record({
      emit: (event) => {
        events.push(event);
        postMessage({
          message: MessageName.EmitEvent,
          event,
        });
      },
      ...config,
    }) || null;

  postMessage({
    message: MessageName.RecordStarted,
    startTimestamp: Date.now(),
  } as RecordStartedMessage);

  setTimeout(async () => {
    await startMediaRecording(() => stopRrwebAndPostMessage());  
  }, 10);
}

const messageHandler = (
  event: MessageEvent<{
    message: MessageName;
    config?: recordOptions<eventWithTime>;
  }>,
) => {
  if (event.source !== window) return;
  const data = event.data;
  const eventHandler = {
    [MessageName.StartRecord]: () => {
      startRecord(data.config || {});
    },
    [MessageName.StopRecord]: () => {
        if (mediaRecorder) {
            stopMediaRecording();
            // stopRrwebAndPostMessage() will be called from mediaRecorder.onstop
        }
        else {
            stopRrwebAndPostMessage();
        }
      
    },
  } as Record<MessageName, () => void>;
  if (eventHandler[data.message]) eventHandler[data.message]();
};

function stopRrwebAndPostMessage() {
    if (stopFn) {
        try {
          stopFn();
        } catch (e) {
          //
        }
      }
      postMessage({
        message: MessageName.RecordStopped,
        events,
        mediaChunks,
        endTimestamp: Date.now(),
      });
      window.removeEventListener('message', messageHandler);
}

/**
 * Only post message in the main page.
 */
function postMessage(message: unknown) {
  if (!isInCrossOriginIFrame()) window.postMessage(message, location.origin);
}

window.addEventListener('message', messageHandler);

window.postMessage(
  {
    message: MessageName.RecordScriptReady,
  },
  location.origin,
);
