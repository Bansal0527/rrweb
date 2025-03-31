import { useState, useEffect } from 'react';
import {
  Box,
  Flex,
  IconButton,
  Link,
  Spacer,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiSettings, FiList, FiPause, FiPlay } from 'react-icons/fi';
import Channel from '~/utils/channel';
import type {
  LocalData,
  RecordStartedMessage,
  RecordStoppedMessage,
  Session,
} from '~/types';
import { LocalDataKey, RecorderStatus, ServiceName, EventName } from '~/types';
import Browser from 'webextension-polyfill';
import { CircleButton } from '~/components/CircleButton';
import { Timer } from './Timer';
import { pauseRecording, resumeRecording } from '~/utils/recording';
import { saveSession } from '~/utils/storage';
const RECORD_BUTTON_SIZE = 3;
const BACKEND_API_URL = 'http://127.0.0.1:8000/create-video'; // Replace with your actual API URL
// const BACKEND_API_URL = 'http://localhost:8000/get';
const channel = new Channel();

export function App() {
  const [status, setStatus] = useState<RecorderStatus>(RecorderStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [newSession, setNewSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<any[]>([]); // Add this line to store events


  useEffect(() => {
    void Browser.storage.local.get(LocalDataKey.recorderStatus).then((data) => {
      const localData = data as LocalData;
      if (!localData || !localData[LocalDataKey.recorderStatus]) return;
      const { status, startTimestamp, pausedTimestamp } =
        localData[LocalDataKey.recorderStatus];
      setStatus(status);
      if (startTimestamp && pausedTimestamp)
        setStartTime(Date.now() - pausedTimestamp + startTimestamp || 0);
      else if (startTimestamp) setStartTime(startTimestamp);
    });
  }, []);

  const saveRecordingData = async (session: Session, events: any[], mediaChunks: Blob[] | string[]) => {
    try {
      console.log("Sending data to backend", {
        session,
        eventsCount: events.length,
        mediaChunksCount: mediaChunks.length
      });

      const response = await fetch(BACKEND_API_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          session: session,
          events: events,
          mediaChunks: mediaChunks
        }), 
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend response error:', response.status, errorText);
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log("Response from backend:", data);
      
      if (!data.videoUrl || !data.transcriptUrl || !data.timestampUrl) {
        console.error('Missing required URLs in response:', data);
        throw new Error('Backend response missing required URLs');
      }

      return {
        videoUrl: data.videoUrl,
        transcriptUrl: data.transcriptUrl,
        timestampUrl: data.timestampUrl
      };
    } catch (error) {
      console.error('Error sending recording data:', error);
      setErrorMessage(`Failed to send recording data to backend: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };

  const redirectToWebsite = (videoUrl: string, transcriptUrl: string, timestampUrl: string) => {
    if (!videoUrl || !transcriptUrl || !timestampUrl) {
      console.error('Missing required URLs:', { videoUrl, transcriptUrl, timestampUrl });
      setErrorMessage('Failed to get required URLs from backend');
      return;
    }
    
    console.log("Video URL:", videoUrl);
    console.log("Transcript URL:", transcriptUrl);
    console.log("Timestamp URL:", timestampUrl);
    
    const websiteUrl = `http://localhost:3000/editor?videoUrl=${encodeURIComponent(videoUrl)}&transcriptUrl=${encodeURIComponent(transcriptUrl)}&timestampUrl=${encodeURIComponent(timestampUrl)}`;
    void Browser.tabs.create({ url: websiteUrl });
  };

  return (
    <Flex direction="column" w={300} padding="5%">
      <Flex>
        <Text fontSize="md" fontWeight="bold">
          Zemo Recorder
        </Text>
        <Spacer />
        <Stack direction="row">
          <IconButton
            onClick={() => {
              void Browser.tabs.create({ url: '/pages/index.html#/' });
            }}
            size="xs"
            icon={<FiList />}
            aria-label={'Session List'}
            title="Session List"
          ></IconButton>
          <IconButton
            onClick={() => {
              void Browser.runtime.openOptionsPage();
            }}
            size="xs"
            icon={<FiSettings />}
            aria-label={'Settings button'}
            title="Settings"
          ></IconButton>
        </Stack>
      </Flex>
      {status !== RecorderStatus.IDLE && startTime && (
        <Timer
          startTime={startTime}
          ticking={status === RecorderStatus.RECORDING}
        />
      )}
      <Flex justify="center" gap="10" mt="5" mb="5">
        {[RecorderStatus.IDLE, RecorderStatus.RECORDING].includes(status) && (
          <CircleButton
            diameter={RECORD_BUTTON_SIZE}
            title={
              status === RecorderStatus.IDLE
                ? 'Start Recording'
                : 'Stop Recording'
            }
            onClick={() => {
              if (status === RecorderStatus.RECORDING) {
                // stop recording
                setErrorMessage('');
                void channel.getCurrentTabId().then((tabId) => {
                  if (tabId === -1) return;
                  void channel
                    .requestToTab(tabId, ServiceName.StopRecord, {})
                    .then(async (res: RecordStoppedMessage) => {
                      if (!res) return;

                      setStatus(RecorderStatus.IDLE);
                      const status: LocalData[LocalDataKey.recorderStatus] = {
                        status: RecorderStatus.IDLE,
                        activeTabId: tabId,
                      };
                      await Browser.storage.local.set({
                        [LocalDataKey.recorderStatus]: status,
                      });
                      if (res.session) {
                        console.debug('stop recording clicked:', res);
                        setNewSession(res.session);
                        await saveSession(res.session, res.events, res.mediaChunks).catch(
                          (e) => {
                            setErrorMessage((e as { message: string }).message);
                          },
                        );
                        channel.emit(EventName.SessionUpdated, {});
                        
                        try {
                          const result = await saveRecordingData(res.session, res.events, res.mediaChunks);
                          if (result && result.videoUrl && result.transcriptUrl && result.timestampUrl) {
                            // Redirect to website after session is saved and events are sent
                            redirectToWebsite(result.videoUrl, result.transcriptUrl, result.timestampUrl);
                          } else {
                            setErrorMessage('Failed to get required URLs from backend');
                          }
                        } catch (error) {
                          setErrorMessage(`Error processing recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                      }
                    })
                    .catch((error: Error) => {
                      setErrorMessage(error.message);
                    });
                });
              } else {
                // start recording
                console.debug('popup: start recording clicked');
                void channel.getCurrentTabId().then((tabId) => {
                  if (tabId === -1) return;
                  void channel
                    .requestToTab(tabId, ServiceName.StartRecord, {})
                    .then(async (res: RecordStartedMessage | undefined) => {
                      if (res) {
                        console.debug('popup: start message:', res);
                        setStatus(RecorderStatus.RECORDING);
                        setStartTime(res.startTimestamp);
                        const status: LocalData[LocalDataKey.recorderStatus] = {
                          status: RecorderStatus.RECORDING,
                          activeTabId: tabId,
                          startTimestamp: res.startTimestamp,
                        };
                        await Browser.storage.local.set({
                          [LocalDataKey.recorderStatus]: status,
                        });
                      }
                    })
                    .catch((error: Error) => {
                      setErrorMessage(error.message);
                    });
                });
              }
            }}
          >
            <Box
              w={`${RECORD_BUTTON_SIZE}rem`}
              h={`${RECORD_BUTTON_SIZE}rem`}
              borderRadius={status === RecorderStatus.IDLE ? 9999 : 6}
              margin="0"
              bgColor="red.500"
            />
          </CircleButton>
        )}
        {status !== RecorderStatus.IDLE && (
          <CircleButton
            diameter={RECORD_BUTTON_SIZE}
            title={
              status === RecorderStatus.RECORDING
                ? 'Pause Recording'
                : 'Resume Recording'
            }
            onClick={() => {
              if (status === RecorderStatus.RECORDING) {
                void pauseRecording(channel, RecorderStatus.PAUSED).then(
                  (result) => {
                    if (!result) return;
                    setStatus(result?.status.status);
                  },
                );
              } else {
                void channel.getCurrentTabId().then((tabId) => {
                  if (tabId === -1) return;
                  resumeRecording(channel, tabId)
                    .then((statusData) => {
                      if (!statusData) return;
                      setStatus(statusData.status);
                      if (statusData.startTimestamp)
                        setStartTime(statusData.startTimestamp);
                    })
                    .catch((error: Error) => {
                      setErrorMessage(error.message);
                    });
                });
              }
            }}
          >
            <Box
              w={`${RECORD_BUTTON_SIZE}rem`}
              h={`${RECORD_BUTTON_SIZE}rem`}
              borderRadius={9999}
              margin="0"
              color="gray.600"
            >
              {[RecorderStatus.PAUSED, RecorderStatus.PausedSwitch].includes(
                status,
              ) && (
                <FiPlay
                  style={{
                    paddingLeft: '0.5rem',
                    width: '100%',
                    height: '100%',
                  }}
                />
              )}
              {status === RecorderStatus.RECORDING && (
                <FiPause
                  style={{
                    width: '100%',
                    height: '100%',
                  }}
                />
              )}
            </Box>
          </CircleButton>
        )}
      </Flex>
      {errorMessage !== '' && (
        <Text color="red.500" fontSize="md">
          {errorMessage}
          <br />
          Maybe refresh your current tab.
        </Text>
      )}
    </Flex>
  );
}