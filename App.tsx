
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { SYSTEM_INSTRUCTION, MODEL_NAME } from './constants';
import { ConnectionStatus, Message } from './types';
import { encode, decode, decodeAudioData } from './utils/audio';
import { Visualizer } from './components/Visualizer';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Audio Contexts and Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [currentInputText, setCurrentInputText] = useState('');
  const [currentOutputText, setCurrentOutputText] = useState('');

  const stopAudio = useCallback(() => {
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const cleanup = useCallback(() => {
    stopAudio();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
    setStatus(ConnectionStatus.IDLE);
  }, [stopAudio]);

  const startSession = async () => {
    try {
      setError(null);
      setStatus(ConnectionStatus.CONNECTING);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      // Setup Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcriptions
            if (message.serverContent?.inputTranscription) {
              setCurrentInputText(prev => prev + message.serverContent!.inputTranscription!.text);
            }
            if (message.serverContent?.outputTranscription) {
              setCurrentOutputText(prev => prev + message.serverContent!.outputTranscription!.text);
            }

            if (message.serverContent?.turnComplete) {
              setMessages(prev => [
                ...prev,
                { role: 'user', text: currentInputText, timestamp: new Date() },
                { role: 'ai', text: currentOutputText, timestamp: new Date() }
              ]);
              setCurrentInputText('');
              setCurrentOutputText('');
            }

            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              stopAudio();
            }
          },
          onerror: (e) => {
            console.error('Session Error:', e);
            setError('Connection failed. Please check your microphone and try again.');
            setStatus(ConnectionStatus.ERROR);
          },
          onclose: () => {
            cleanup();
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setError('Could not access microphone or connect to AI.');
      setStatus(ConnectionStatus.ERROR);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-2xl font-bold tracking-tighter">X</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">ProfX</h1>
            <p className="text-xs text-gray-400">Elite English Tutor & Language Partner</p>
          </div>
        </div>
        <div className="flex gap-2">
          {status === ConnectionStatus.CONNECTED && (
             <button
              onClick={() => setIsMuted(!isMuted)}
              className={`p-2 rounded-full transition-colors ${isMuted ? 'bg-red-500/20 text-red-500' : 'bg-gray-800 text-gray-400'}`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={status === ConnectionStatus.CONNECTED ? cleanup : startSession}
            disabled={status === ConnectionStatus.CONNECTING}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              status === ConnectionStatus.CONNECTED 
              ? 'bg-red-500 hover:bg-red-600 text-white' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {status === ConnectionStatus.CONNECTED ? 'End Session' : 'Start Lesson'}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col bg-gray-800/50 rounded-3xl border border-gray-700 shadow-2xl relative">
        {/* Transcription Display */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
          {messages.length === 0 && !currentInputText && !currentOutputText && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-50">
              <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mb-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold">Ready to learn?</h2>
              <p className="max-w-xs mx-auto text-sm">
                Click "Start Lesson" to begin your English conversation. ProfX can help with grammar, vocab, and roleplay!
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'ai' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl p-4 ${
                m.role === 'ai' 
                ? 'bg-gray-700 text-gray-100 rounded-tl-none border border-gray-600' 
                : 'bg-blue-600 text-white rounded-tr-none'
              }`}>
                <p className="text-sm">{m.text}</p>
              </div>
            </div>
          ))}

          {/* Real-time Streaming Transcriptions */}
          {currentInputText && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl p-4 bg-blue-600/40 text-white rounded-tr-none border border-blue-500/30">
                <p className="text-sm italic">{currentInputText}</p>
              </div>
            </div>
          )}
          {currentOutputText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl p-4 bg-gray-700/60 text-gray-300 rounded-tl-none border border-gray-600">
                <p className="text-sm animate-pulse">{currentOutputText}</p>
              </div>
            </div>
          )}
        </div>

        {/* Visualizer Footer */}
        <div className="h-32 border-t border-gray-700 bg-gray-900/40 backdrop-blur-md flex flex-col items-center justify-center p-4">
          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
          <div className="relative w-full flex items-center justify-center">
             {status === ConnectionStatus.CONNECTED && (
               <div className="pulse-ring bg-blue-500/20"></div>
             )}
             <Visualizer 
               isActive={status === ConnectionStatus.CONNECTED && !isMuted} 
               isProcessing={status === ConnectionStatus.CONNECTED}
             />
          </div>
          <p className="text-xs text-gray-500 mt-2 font-medium tracking-widest uppercase">
            {status === ConnectionStatus.CONNECTED ? (isMuted ? 'Microphone Muted' : 'Listening...') : 'Session Idle'}
          </p>
        </div>
      </main>

      {/* Quick Tips */}
      <footer className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Roleplay', icon: '🎭', tip: 'Try: "Can we roleplay a coffee shop scene?"' },
          { label: 'Bengali Support', icon: '🇧🇩', tip: 'If you struggle, speak Bengali. I will help.' },
          { label: 'Grammar', icon: '✍️', tip: 'I will correct you gently as we speak.' },
          { label: 'Vocabulary', icon: '📚', tip: 'Ask: "What is a better word for...?"' }
        ].map((item, idx) => (
          <div key={idx} className="p-3 bg-gray-800/30 border border-gray-700 rounded-xl hover:border-blue-500/50 transition-colors cursor-help group relative">
            <div className="flex items-center gap-2 mb-1">
              <span>{item.icon}</span>
              <span className="text-xs font-bold text-gray-300">{item.label}</span>
            </div>
            <div className="absolute bottom-full mb-2 hidden group-hover:block bg-gray-900 text-xs p-2 rounded border border-gray-700 w-48 shadow-xl z-50">
              {item.tip}
            </div>
          </div>
        ))}
      </footer>
    </div>
  );
};

export default App;
