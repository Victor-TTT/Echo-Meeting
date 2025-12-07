import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Disc, StopCircle, Play, Download, Trash2, BrainCircuit, Monitor, Info, Check, AlertCircle, Headphones, Cast, ExternalLink } from 'lucide-react';
import AudioVisualizer from './components/AudioVisualizer';
import { analyzeAudio } from './services/geminiService';
import { Recording, RecorderState } from './types';

const App: React.FC = () => {
  // State
  const [recorderState, setRecorderState] = useState<RecorderState>(RecorderState.IDLE);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [timer, setTimer] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  // Format timer
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Cleanup function
  const stopStreams = () => {
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (mixedStreamRef.current) {
      mixedStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setRecorderState(RecorderState.PREPARING);

    try {
      // Browser support check
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error("Your browser does not support screen audio recording. Please use Chrome, Edge, or Firefox.");
      }

      // Fix: Cast window to any to support webkitAudioContext in TypeScript
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const destination = audioCtx.createMediaStreamDestination();
      
      // Get System Audio (Teams/Others) via Display Media
      try {
        // Important: 'video: true' is often required to get the 'Share Audio' checkbox in the browser prompt
        const sysStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: true, 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            // @ts-ignore
            suppressLocalAudioPlayback: false
          } 
        });
        
        // We only need the audio track
        if (sysStream.getAudioTracks().length > 0) {
          systemStreamRef.current = sysStream;
          const sysSource = audioCtx.createMediaStreamSource(sysStream);
          sysSource.connect(destination);

          // If user stops sharing screen via browser UI, stop recording
          sysStream.getVideoTracks()[0].onended = () => {
            stopRecording();
          };
        } else {
          // Specific error for desktop app usage
          const error = "No system audio detected. To record Teams Desktop, you MUST select 'Entire Screen' tab and check 'Share system audio'.";
          
          // Clean up if they didn't share audio
          sysStream.getTracks().forEach(t => t.stop());
          
          throw new Error(error);
        }
      } catch (e: any) {
        console.warn("System audio selection cancelled or failed", e);
        
        if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
           // User cancelled popup
           setRecorderState(RecorderState.IDLE);
           return; 
        }

        if (e.message && e.message.includes("permissions policy")) {
           throw new Error("Browser Permission Blocked: This preview window does not allow screen recording. Please open this app in a new full browser tab/window to use it.");
        }

        if (e.message && e.message.includes("No system audio")) {
           throw e;
        }
        
        throw new Error("Could not start System Audio capture: " + e.message);
      }

      audioContextRef.current = audioCtx;
      mixedStreamRef.current = destination.stream;

      // Start MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';
        
      const recorder = new MediaRecorder(destination.stream, { mimeType });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const newRecording: Recording = {
          id: Date.now().toString(),
          blob,
          url,
          timestamp: Date.now(),
          duration: timer,
          name: `Meeting ${new Date().toLocaleString()}`,
        };
        
        setRecordings(prev => [newRecording, ...prev]);
        setRecorderState(RecorderState.IDLE);
        setTimer(0);
        stopStreams();
      };

      recorder.start(1000); // Collect chunks every second
      mediaRecorderRef.current = recorder;
      setRecorderState(RecorderState.RECORDING);

      // Start Timer
      setTimer(0);
      timerIntervalRef.current = window.setInterval(() => {
        setTimer(t => t + 1);
      }, 1000);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Failed to start recording");
      setRecorderState(RecorderState.IDLE);
      stopStreams();
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
  }, []);

  const handleDelete = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  const handleAnalyze = async (id: string) => {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;
    
    setProcessingIds(prev => new Set(prev).add(id));

    try {
      const { transcription, summary } = await analyzeAudio(recording.blob);
      
      setRecordings(prev => prev.map(r => {
        if (r.id === id) {
          return { ...r, transcription, summary };
        }
        return r;
      }));
    } catch (e) {
      alert("Failed to analyze audio. Please check your API Key.");
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 flex flex-col items-center">
      
      {/* Header */}
      <header className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-900/10">
            <Disc className="text-white w-6 h-6 animate-spin-slow" />
          </div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
            EchoMeeting
          </h1>
        </div>
        <div className="text-sm font-medium px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-500 shadow-sm">
          {process.env.API_KEY ? (
            <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500"></div> AI Ready</span>
          ) : (
             <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-500"></div> API Key Missing</span>
          )}
        </div>
      </header>

      {/* Main Recorder Card */}
      <main className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-xl relative overflow-hidden">
        
        {/* Glow Effects (Subtle for Light Mode) */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-blue-100/50 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-purple-100/50 rounded-full blur-3xl pointer-events-none"></div>

        {/* Visualizer */}
        <div className="mb-8 relative z-10">
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Live Frequency</span>
            <span className={`text-xl font-mono font-bold ${recorderState === RecorderState.RECORDING ? 'text-red-500' : 'text-slate-400'}`}>
              {formatTime(timer)}
            </span>
          </div>
          <AudioVisualizer stream={mixedStreamRef.current} isRecording={recorderState === RecorderState.RECORDING} />
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-6 relative z-10">
          
          {/* Error Message */}
          {errorMsg && (
            <div className="flex flex-col gap-2 text-red-600 bg-red-50 px-4 py-3 rounded-lg text-sm border border-red-200 max-w-lg text-left animate-in fade-in slide-in-from-top-1 w-full">
              <div className="flex items-start gap-2">
                 <AlertCircle size={16} className="shrink-0 mt-0.5" />
                 <div>{errorMsg}</div>
              </div>
              {errorMsg.includes("Browser Permission Blocked") && (
                <button 
                  onClick={() => window.open(window.location.href, '_blank')}
                  className="ml-6 flex items-center gap-2 text-xs bg-white border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded transition-colors w-fit shadow-sm"
                >
                  <ExternalLink size={12} /> Open in New Window
                </button>
              )}
            </div>
          )}

          {/* Main Action Button */}
          {recorderState === RecorderState.IDLE || recorderState === RecorderState.PREPARING ? (
            <button 
              onClick={startRecording}
              disabled={recorderState === RecorderState.PREPARING}
              className="group relative flex items-center justify-center w-20 h-20 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 shadow-lg shadow-slate-300/50 transition-all hover:scale-105 active:scale-95 disabled:opacity-70 disabled:scale-100"
            >
              {recorderState === RecorderState.PREPARING && (
                <div className="absolute inset-0 rounded-full border-4 border-slate-400/30 border-t-slate-600 animate-spin"></div>
              )}
              {recorderState !== RecorderState.PREPARING && (
                 <div className="absolute inset-0 rounded-full border-2 border-slate-400/20 animate-ping opacity-20 group-hover:opacity-40"></div>
              )}
              <Monitor size={32} fill="currentColor" className={recorderState === RecorderState.PREPARING ? 'opacity-0' : 'opacity-100'} />
            </button>
          ) : (
            <button 
              onClick={stopRecording}
              className="flex items-center justify-center w-20 h-20 rounded-full bg-slate-800 hover:bg-slate-900 text-white shadow-lg transition-all hover:scale-105 active:scale-95"
            >
              <StopCircle size={32} />
            </button>
          )}

          <div className="text-sm text-slate-500 font-medium tracking-wide uppercase">
            {recorderState === RecorderState.IDLE ? "Start Recording" : 
             recorderState === RecorderState.PREPARING ? "Select Screen & Share Audio..." : 
             "Recording in Progress"}
          </div>

        </div>
      </main>

      {/* Recordings List */}
      <section className="w-full max-w-2xl mt-8">
        <h2 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Disc size={18} /> Recent Recordings
        </h2>
        
        <div className="space-y-4">
          {recordings.length === 0 && (
            <div className="text-center py-12 border border-dashed border-slate-300 bg-white/50 rounded-xl text-slate-400">
              No recordings yet.
            </div>
          )}

          {recordings.map((rec) => (
            <div key={rec.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm transition-all hover:shadow-md">
              <div className="p-4 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                <div>
                  <h3 className="font-medium text-slate-800">{rec.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(rec.timestamp).toLocaleDateString()} • {formatTime(rec.duration)} • {(rec.blob.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <audio src={rec.url} controls className="h-8 w-32 md:w-48 opacity-70 hover:opacity-100 transition-opacity" />
                  
                  <a href={rec.url} download={`${rec.name}.webm`} className="p-2 text-slate-400 hover:text-blue-600 transition-colors" title="Download">
                    <Download size={20} />
                  </a>
                  
                  <button 
                    onClick={() => handleDelete(rec.id)}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors" 
                    title="Delete"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>

              {/* AI Analysis Section */}
              <div className="bg-slate-50 border-t border-slate-100 p-4">
                {!rec.transcription && !rec.summary ? (
                  <button 
                    onClick={() => handleAnalyze(rec.id)}
                    disabled={processingIds.has(rec.id)}
                    className="flex items-center gap-2 text-xs font-semibold text-purple-600 hover:text-purple-500 transition-colors disabled:opacity-50"
                  >
                    {processingIds.has(rec.id) ? (
                       <>
                         <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                         Generating Meeting Minutes...
                       </>
                    ) : (
                       <>
                         <BrainCircuit size={16} />
                         Generate AI Summary & Transcript
                       </>
                    )}
                  </button>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
                     {rec.summary && (
                        <div>
                          <h4 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <BrainCircuit size={14} /> AI Summary
                          </h4>
                          <div className="text-sm text-slate-700 bg-white p-3 rounded-lg border border-purple-200 whitespace-pre-wrap shadow-sm">
                            {rec.summary}
                          </div>
                        </div>
                     )}
                     {rec.transcription && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors flex items-center gap-2 uppercase tracking-wider">
                            <span className="group-open:rotate-90 transition-transform">▶</span> Full Transcript
                          </summary>
                          <div className="mt-3 text-sm text-slate-600 pl-4 border-l-2 border-slate-200 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">
                            {rec.transcription}
                          </div>
                        </details>
                     )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      
      <footer className="mt-12 text-center text-slate-400 text-xs">
        <p>EchoMeeting stores recordings locally in your browser memory. Reloading the page will clear them.</p>
      </footer>
    </div>
  );
};

export default App;