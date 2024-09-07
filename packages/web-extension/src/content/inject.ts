import { record } from 'rrweb';
import type { recordOptions } from 'rrweb';
import type { eventWithTime } from '@rrweb/types';
import { MessageName, type RecordStartedMessage } from '~/types';
import { isInCrossOriginIFrame } from '~/utils';

/**
 * This script is injected into both main page and cross-origin IFrames through <script> tags.
 */

const events: eventWithTime[] = [];
const audioChunks: any[] = [];
let audioRecorder: MediaRecorder | null = null;
let audioStream: MediaStream | null = null;


let stopFn: (() => void) | null = null;

function blobToDataURL(blob: Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to convert Blob to Data URL'));
      reader.readAsDataURL(blob);
    });
  }

async function startRecord(config: recordOptions<eventWithTime>) {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // use below to combine multiple streams
        // audioStream = new MediaStream([...userAudioStream.getAudioTracks()]);
        audioRecorder = new MediaRecorder(audioStream);
        audioRecorder.ondataavailable = async (e) => {
            const audioChunk = await blobToDataURL(e.data)
            audioChunks.push(audioChunk);
            postMessage({
                message: MessageName.EmitAudioChunk,
                audioChunk
            });
        }
        // XXX hack to force invoking 'RecordStarted' after audioChunk has been added
        audioRecorder.onstop = () => setTimeout(() => stopRrwebAndPostMessage(), 100);
        audioRecorder.start();
    }
    catch (error) {
        console.error('Error accessing microphone:', error);
    }

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
        if (audioRecorder && audioStream) {
            audioRecorder.stop();
            audioStream.getTracks().forEach(track => track.stop());
            // stopRrwebAndPostMessage() will be called from audioRecorder.onstop
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
        audioChunks,
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
