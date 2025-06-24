/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './circle-visualizer'; // Import the new circle visualizer

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private systemInstructionsContent: string | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh; /* Make it full height */
      background-color: #ffffff; /* White background for the component */
      position: relative; /* Ensure child absolute positioning is relative to this */
      overflow: hidden; /* Prevent content from spilling out */
    }

    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: #333333; /* Dark grey for visibility on white */
      font-family: sans-serif;
      padding: 0 5px; /* Add some horizontal padding */
      box-sizing: border-box; /* Include padding in width calculation */
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: row; /* Horizontal arrangement */
      gap: 10px;

      button {
        outline: none;
        border: 1px solid #cccccc; /* Grey border */
        color: #333333; /* Dark grey icon/text color */
        border-radius: 10px; /* Adjusted border radius */
        background: #f0f0f0; /* Light grey background */
        width: 48px; /* Smaller button width */
        height: 48px; /* Smaller button height */
        cursor: pointer;
        font-size: 20px; /* Adjusted for smaller icon if text was used */
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0; /* Prevent buttons from shrinking */

        &:hover {
          background: #e0e0e0; /* Slightly darker grey on hover */
        }
      }

      button[disabled] {
        display: none;
      }
    }

    gdm-circle-visualizer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }

    .footer {
      position: absolute;
      bottom: 10px; /* Small padding from the bottom */
      right: 10px; /* Small padding from the right */
      text-align: right; /* Align text to the right */
      font-size: 0.8em; /* Smaller font size */
      color: #555555; /* Slightly lighter grey for subtlety */
      font-family: sans-serif;
      z-index: 10; /* Ensure it's above the visualizer if needed */
    }

    /* Responsive adjustments for smaller screens */
    @media (max-width: 480px) {
      .controls {
        flex-direction: column; /* Stack buttons vertically */
        align-items: center; /* Center buttons in the column */
        gap: 12px; /* Adjust gap for vertical layout */
        bottom: 8vh; /* Reposition the column slightly higher */
      }

      /* Button sizes remain 48x48 which is good for touch */

      #status {
        bottom: 2vh; /* Position status text below stacked controls */
        font-size: 0.8em; /* Make font slightly smaller */
        padding: 0 10px; /* Ensure text doesn't touch edges */
        width: 100%; /* Ensure it spans width for text-align: center */
      }

      .footer {
        font-size: 0.7em; /* Make font slightly smaller */
        bottom: 5px;
        right: 5px;
      }
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    try {
      const response = await fetch('system-instructions.txt');
      if (!response.ok) {
        throw new Error(`Failed to load system instructions: ${response.statusText}`);
      }
      this.systemInstructionsContent = await response.text();
      this.updateStatus('System instructions loaded.');
    } catch (e) {
      console.error('Error loading system instructions:', e);
      this.updateError(`Failed to load system instructions: ${e.message}`);
    }

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY, // Updated API key environment variable
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    const sessionConfig: {
      responseModalities: Modality[];
      speechConfig: {
        voiceConfig: {prebuiltVoiceConfig: {voiceName: string}};
        languageCode?: string;
      };
      systemInstruction?: string;
    } = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'zephyr'}},
        },
      };

    if (this.systemInstructionsContent) {
      sessionConfig.systemInstruction = this.systemInstructionsContent;
    }

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Session Opened. Ready to chat.');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () =>{
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if(interrupted) {
              for(const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(`Session Error: ${e.message}`);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus(`Session Closed: ${e.reason || 'No reason provided'}`);
          },
        },
        config: sessionConfig,
      });
    } catch (e) {
      console.error('Failed to initialize session:', e);
      this.updateError(`Failed to initialize session: ${e.message}`);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }
    if (!this.session) {
        this.updateError('Session not initialized. Please wait or refresh.');
        return;
    }

    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1, 
        1, 
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.session) return;
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        try {
            this.session.sendRealtimeInput({media: createBlob(pcmData)});
        } catch (err) {
            console.error('Error sending audio data:', err);
            this.updateError(`Error sending audio: ${err.message}`);
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Speak now!');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateError(`Error starting recording: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext.destination)
      return;

    this.updateStatus('Stopping recording...');
    this.isRecording = false;

    if (this.scriptProcessorNode) {
        this.scriptProcessorNode.disconnect();
        this.scriptProcessorNode.onaudioprocess = null;
        this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private async reset() {
    this.updateStatus('Resetting session...');
    if (this.isRecording) {
        this.stopRecording();
    }
    for(const source of this.sources.values()) {
        try {
            source.stop();
        } catch(e) {
            console.warn('Error stopping an audio source during reset:', e);
        }
        this.sources.delete(source);
    }
    this.nextStartTime = 0;

    if (this.session) {
      try {
        await this.session.close();
      } catch (e) {
        console.error('Error closing session during reset:', e);
        this.updateError(`Error closing session: ${e.message}`);
      }
      this.session = null;
    }
    await this.initSession();
    this.updateStatus('Session reset. Ready for new conversation.');
  }

  render() {
    return html`
      <div>
        <gdm-circle-visualizer
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-circle-visualizer>
        <div class="controls">
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}
            aria-label="Start Recording">
            <svg
              viewBox="0 0 100 100"
              width="24px" 
              height="24px"
              fill="#c80000">
              <circle cx="50" cy="50" r="45" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}
            aria-label="Stop Recording">
            <svg
              viewBox="0 0 100 100"
              width="24px" 
              height="24px"
              fill="#333333" 
              xmlns="http://www.w3.org/2000/svg">
              <rect x="15" y="15" width="70" height="70" rx="10" />
            </svg>
          </button>
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}
            aria-label="Reset Session">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="28px" 
              viewBox="0 -960 960 960"
              width="28px" 
              fill="#333333">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
        </div>

        <div id="status" role="status" aria-live="polite">
          ${this.error ? `Error: ${this.error}` : this.status}
        </div>
        <div class="footer">
          created with ❤️ by sameer banchhor
        </div>
      </div>
    `;
  }
}
